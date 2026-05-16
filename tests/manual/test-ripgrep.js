const { execSync } = require('node:child_process');

// Test basic ripgrep command
const pattern = 'function';
const args = ['"function"', '--glob "!node_modules/**"', '--glob "!dist/**"', '--max-depth 5', '-l', '.'];

const command = `rg ${args.join(' ')}`;
console.log('Command:', command);

try {
    const start = Date.now();
    const output = execSync(command, {
        encoding: 'utf8',
        timeout: 2000,
    });
    const elapsed = Date.now() - start;
    const lines = output.trim().split('\n').filter(Boolean);
    console.log(`Found ${lines.length} files in ${elapsed}ms`);
    console.log('First 5 results:', lines.slice(0, 5));
} catch (error) {
    console.error('Error:', error.message);
}
