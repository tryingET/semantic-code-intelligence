import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Set test environment variables
        process.env.VSCODE_TEST = '1';
        process.env.NODE_ENV = 'test';
        
        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Launchargs for the VS Code instance
            launchArgs: [
                '--disable-extensions', // Disable other extensions
                '--disable-web-security',
                // Add a workspace folder for testing
                path.resolve(__dirname, '../../../test-workspace')
            ],
            // Pass environment variables to the test process
            extensionTestsEnv: {
                ...process.env,
                VSCODE_TEST: '1',
                NODE_ENV: 'test'
            }
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();