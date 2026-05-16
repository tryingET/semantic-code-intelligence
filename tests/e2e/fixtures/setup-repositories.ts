import { type ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TestRepository } from './repository-configs';

export interface RepositorySetupResult {
    success: boolean;
    path?: string;
    error?: string;
    cloneTime?: number;
    fileCount?: number;
}

export class RepositoryManager {
    private baseDir: string;
    private clonedRepos = new Map<string, string>();

    constructor(baseDir: string) {
        this.baseDir = resolve(baseDir);
    }

    async setupRepository(repo: TestRepository): Promise<RepositorySetupResult> {
        console.log(`🔄 Setting up repository: ${repo.name}`);

        if (repo.skipClone && repo.localPath) {
            return this.setupLocalRepository(repo);
        }

        return this.cloneRepository(repo);
    }

    private async setupLocalRepository(repo: TestRepository): Promise<RepositorySetupResult> {
        const localPath = resolve(repo.localPath!);

        try {
            // Check if local path exists
            await fs.access(localPath);

            // Count files to verify it's valid
            const fileCount = await this.countFilesRecursively(localPath, ['.ts', '.js', '.tsx', '.jsx', '.vue']);

            if (fileCount === 0) {
                return {
                    success: false,
                    error: `No source files found in local path: ${localPath}`,
                };
            }

            this.clonedRepos.set(repo.name, localPath);

            console.log(`✅ Local repository setup: ${repo.name} (${fileCount} files)`);

            return {
                success: true,
                path: localPath,
                fileCount,
            };
        } catch (error) {
            return {
                success: false,
                error: `Local repository not accessible: ${error}`,
            };
        }
    }

    private async cloneRepository(repo: TestRepository): Promise<RepositorySetupResult> {
        const repoDir = join(this.baseDir, repo.name);

        try {
            // Clean up existing directory
            await fs.rm(repoDir, { recursive: true, force: true });

            console.log(`📥 Cloning ${repo.url}...`);
            const startTime = performance.now();

            await this.executeGitClone(repo.url, repoDir, repo.branch);

            const cloneTime = performance.now() - startTime;
            console.log(`⏱️  Clone completed in ${Math.round(cloneTime)}ms`);

            // Verify clone succeeded
            const fileCount = await this.countFilesRecursively(repoDir, ['.ts', '.js', '.tsx', '.jsx', '.vue']);

            if (fileCount === 0) {
                throw new Error('No source files found after clone');
            }

            // Check if file count is reasonable
            const variance = repo.expectedFiles * 0.7; // Allow 70% variance
            if (fileCount < repo.expectedFiles - variance) {
                console.warn(`⚠️ File count lower than expected: ${fileCount} vs ${repo.expectedFiles}`);
            }

            this.clonedRepos.set(repo.name, repoDir);

            console.log(`✅ Repository cloned: ${repo.name} (${fileCount} files)`);

            return {
                success: true,
                path: repoDir,
                cloneTime,
                fileCount,
            };
        } catch (error) {
            console.error(`❌ Failed to clone ${repo.name}:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async executeGitClone(url: string, targetPath: string, branch?: string): Promise<void> {
        const args = ['clone'];

        if (branch) {
            args.push('--branch', branch);
        }

        // Shallow clone for faster setup
        args.push('--depth', '1');

        // Add URL and target
        args.push(url, targetPath);

        return new Promise((resolve, reject) => {
            const git = spawn('git', args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            git.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            git.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            git.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Git clone failed (exit ${code}): ${stderr || stdout}`));
                }
            });

            git.on('error', (error) => {
                reject(new Error(`Git spawn failed: ${error.message}`));
            });
        });
    }

    async countFilesRecursively(dir: string, extensions: string[]): Promise<number> {
        let count = 0;

        const visit = async (path: string, depth = 0) => {
            // Prevent infinite recursion
            if (depth > 10) return;

            try {
                const stat = await fs.stat(path);

                if (stat.isDirectory()) {
                    const basename = path.split('/').pop() || '';

                    // Skip common directories that don't contain source files
                    if (this.shouldSkipDirectory(basename)) {
                        return;
                    }

                    const entries = await fs.readdir(path);
                    await Promise.all(entries.map((entry) => visit(join(path, entry), depth + 1)));
                } else {
                    const hasExtension = extensions.some((ext) => path.toLowerCase().endsWith(ext));
                    if (hasExtension) {
                        count++;
                    }
                }
            } catch (error) {
                // Skip files/directories we can't read
            }
        };

        await visit(dir);
        return count;
    }

    private shouldSkipDirectory(dirname: string): boolean {
        const skipPatterns = [
            'node_modules',
            '.git',
            '.next',
            'dist',
            'build',
            'coverage',
            '.nyc_output',
            'tmp',
            'temp',
            '.cache',
            'logs',
            '.vscode',
            '.idea',
            '__pycache__',
            '.pytest_cache',
            'vendor',
        ];

        return skipPatterns.includes(dirname) || dirname.startsWith('.');
    }

    async findSampleFiles(repoName: string, extensions: string[], maxFiles = 50): Promise<string[]> {
        const repoPath = this.clonedRepos.get(repoName);
        if (!repoPath) {
            throw new Error(`Repository ${repoName} not found`);
        }

        const files: string[] = [];

        const visit = async (path: string, depth = 0) => {
            if (depth > 5 || files.length >= maxFiles) return;

            try {
                const stat = await fs.stat(path);

                if (stat.isDirectory()) {
                    const basename = path.split('/').pop() || '';
                    if (this.shouldSkipDirectory(basename)) return;

                    const entries = await fs.readdir(path);
                    // Shuffle entries to get diverse sample
                    const shuffled = entries.sort(() => Math.random() - 0.5);

                    for (const entry of shuffled.slice(0, 20)) {
                        if (files.length >= maxFiles) break;
                        await visit(join(path, entry), depth + 1);
                    }
                } else {
                    const hasExtension = extensions.some((ext) => path.toLowerCase().endsWith(ext));
                    if (hasExtension && files.length < maxFiles) {
                        files.push(path);
                    }
                }
            } catch (error) {
                // Skip files we can't read
            }
        };

        await visit(repoPath);
        return files;
    }

    async validateRepository(repo: TestRepository): Promise<boolean> {
        const repoPath = this.clonedRepos.get(repo.name);
        if (!repoPath) return false;

        try {
            // Check if we can read at least one test file
            for (const testCase of repo.testCases.findDefinition) {
                const filePath = join(repoPath, testCase.file);
                try {
                    await fs.access(filePath);
                    return true;
                } catch {
                    // Try next file
                }
            }

            // If no specific test files exist, check if we have any files of the right type
            const extensions = repo.language === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'];
            const files = await this.findSampleFiles(repo.name, extensions, 1);
            return files.length > 0;
        } catch (error) {
            console.warn(`⚠️ Repository validation failed for ${repo.name}:`, error);
            return false;
        }
    }

    getRepositoryPath(repoName: string): string | undefined {
        return this.clonedRepos.get(repoName);
    }

    async cleanup(): Promise<void> {
        console.log('🧹 Cleaning up repositories...');

        for (const [name, path] of this.clonedRepos) {
            try {
                // Only clean up cloned repos, not local ones
                if (!path.includes('test-workspace')) {
                    await fs.rm(path, { recursive: true, force: true });
                    console.log(`🗑️  Removed ${name}`);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to cleanup ${name}:`, error);
            }
        }

        this.clonedRepos.clear();

        // Clean up base directory if empty
        try {
            await fs.rmdir(this.baseDir);
        } catch {
            // Directory not empty or doesn't exist, that's OK
        }
    }

    async setupAllRepositories(repos: TestRepository[]): Promise<Map<string, RepositorySetupResult>> {
        const results = new Map<string, RepositorySetupResult>();

        console.log(`🚀 Setting up ${repos.length} repositories...`);

        // Setup repositories in parallel for faster execution
        const setupPromises = repos.map(async (repo) => {
            const result = await this.setupRepository(repo);
            results.set(repo.name, result);
            return { repo, result };
        });

        const setupResults = await Promise.all(setupPromises);

        // Log summary
        const successful = setupResults.filter((r) => r.result.success).length;
        const failed = setupResults.length - successful;

        console.log(`📊 Repository setup complete: ${successful} successful, ${failed} failed`);

        if (failed > 0) {
            console.log('❌ Failed repositories:');
            setupResults
                .filter((r) => !r.result.success)
                .forEach((r) => console.log(`  - ${r.repo.name}: ${r.result.error}`));
        }

        return results;
    }

    getSetupSummary(): { total: number; successful: string[]; failed: string[] } {
        const successful: string[] = [];
        const failed: string[] = [];

        for (const [name, path] of this.clonedRepos) {
            if (path) {
                successful.push(name);
            } else {
                failed.push(name);
            }
        }

        return {
            total: successful.length + failed.length,
            successful,
            failed,
        };
    }
}
