// .ontologyignore file support
import * as fs from 'fs';
import { minimatch } from 'minimatch';
import * as path from 'path';

export class IgnoreFileManager {
    private patterns: string[] = [];
    private defaultPatterns = [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '*.min.js',
        '*.min.css',
        '*.map',
        'coverage/**',
        '.nyc_output/**',
        '.cache/**',
        '.parcel-cache/**',
        '.next/**',
        '.nuxt/**',
        '.vuepress/**',
        '*.log',
        '*.pid',
        '*.seed',
        '.DS_Store',
        'Thumbs.db',
        '.env*',
        '.vscode/**',
        '.idea/**',
        '*.swp',
        '*.swo',
        '*.swn',
        '.ontology/**',
    ];

    constructor(workspaceRoot: string) {
        this.loadIgnoreFile(workspaceRoot);
    }

    private loadIgnoreFile(workspaceRoot: string): void {
        const ignoreFilePath = path.join(workspaceRoot, '.ontologyignore');

        // Start with default patterns
        this.patterns = [...this.defaultPatterns];

        if (!fs.existsSync(ignoreFilePath)) {
            // Create a default .ontologyignore file
            this.createDefaultIgnoreFile(ignoreFilePath);
            return;
        }

        try {
            const content = fs.readFileSync(ignoreFilePath, 'utf-8');
            const customPatterns = this.parseIgnoreFile(content);
            this.patterns = [...this.defaultPatterns, ...customPatterns];
        } catch (error) {
            console.error('Error reading .ontologyignore:', error);
        }
    }

    private parseIgnoreFile(content: string): string[] {
        return content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => {
                // Skip empty lines and comments
                return line && !line.startsWith('#');
            })
            .map((line) => {
                // Handle negation patterns (!)
                if (line.startsWith('!')) {
                    return line;
                }
                // Ensure glob patterns are properly formatted
                if (!line.includes('*') && !line.endsWith('/')) {
                    // If it's a file name without wildcards, match it anywhere
                    return `**/${line}`;
                }
                return line;
            });
    }

    private createDefaultIgnoreFile(filePath: string): void {
        const defaultContent = `# Ontology LSP Ignore File
# This file specifies patterns for files and directories that should be
# excluded from ontology analysis and indexing.

# Dependencies
node_modules/
bower_components/
jspm_packages/

# Build outputs
dist/
build/
out/
.next/
.nuxt/
.vuepress/dist/

# Compiled files
*.min.js
*.min.css
*.map

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Testing
coverage/
.nyc_output/
*.lcov

# Cache directories
.cache/
.parcel-cache/
.sass-cache/

# Environment files
.env
.env.*

# IDE files
.vscode/
.idea/
*.swp
*.swo
*.swn

# OS files
.DS_Store
Thumbs.db
desktop.ini

# Temporary files
*.tmp
*.temp
.tmp/
.temp/

# Version control
.git/
.svn/
.hg/

# Package manager files
package-lock.json
yarn.lock
pnpm-lock.yaml

# Documentation
docs/api/

# Custom patterns (add your own below)
# Example: test-data/
# Example: *.generated.ts
`;

        try {
            fs.writeFileSync(filePath, defaultContent, 'utf-8');
            console.log('Created default .ontologyignore file');
        } catch (error) {
            console.error('Error creating .ontologyignore file:', error);
        }
    }

    public shouldIgnore(filePath: string): boolean {
        const relativePath = path.relative(process.cwd(), filePath);

        for (const pattern of this.patterns) {
            if (pattern.startsWith('!')) {
                // Negation pattern - if it matches, don't ignore
                const negPattern = pattern.substring(1);
                if (minimatch(relativePath, negPattern)) {
                    return false;
                }
            } else {
                // Regular pattern - if it matches, ignore
                if (minimatch(relativePath, pattern)) {
                    return true;
                }
            }
        }

        return false;
    }

    public getPatterns(): string[] {
        return [...this.patterns];
    }

    public addPattern(pattern: string): void {
        if (!this.patterns.includes(pattern)) {
            this.patterns.push(pattern);
        }
    }

    public removePattern(pattern: string): void {
        const index = this.patterns.indexOf(pattern);
        if (index > -1) {
            this.patterns.splice(index, 1);
        }
    }

    public reload(workspaceRoot: string): void {
        this.patterns = [];
        this.loadIgnoreFile(workspaceRoot);
    }
}
