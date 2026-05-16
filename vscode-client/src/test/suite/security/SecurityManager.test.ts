/**
 * SecurityManager Unit Tests
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { SecurityManager } from '../../../security/SecurityManager';
import { ConfigurationManager } from '../../../config/ConfigurationManager';

suite('SecurityManager Test Suite', () => {
    let securityManager: SecurityManager;
    let configManager: ConfigurationManager;
    let sandbox: sinon.SinonSandbox;
    
    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock config manager
        configManager = {
            get: sandbox.stub().returns(false),
            context: {
                globalState: {
                    get: sandbox.stub(),
                    update: sandbox.stub()
                }
            }
        } as any;
        
        securityManager = new SecurityManager(configManager);
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    test('Should filter API keys from code', () => {
        const code = `
            const apiKey = "sk-1234567890abcdef";
            const api_key = "abc123xyz";
            headers: { 'Authorization': 'Bearer token123' }
        `;
        
        const filtered = securityManager.filterSensitivePatterns(code);
        
        assert.ok(!filtered.includes('sk-1234567890abcdef'));
        assert.ok(!filtered.includes('abc123xyz'));
        assert.ok(!filtered.includes('token123'));
        assert.ok(filtered.includes('REDACTED'));
    });
    
    test('Should filter passwords from code', () => {
        const code = `
            password: "supersecret123",
            const passwd = 'mypassword';
            pwd: "test123"
        `;
        
        const filtered = securityManager.filterSensitivePatterns(code);
        
        assert.ok(!filtered.includes('supersecret123'));
        assert.ok(!filtered.includes('mypassword'));
        assert.ok(!filtered.includes('test123'));
    });
    
    test('Should filter private keys', () => {
        const code = `
            -----BEGIN RSA PRIVATE KEY-----
            MIIEowIBAAKCAQEA...
            -----END RSA PRIVATE KEY-----
        `;
        
        const filtered = securityManager.filterSensitivePatterns(code);
        
        assert.ok(!filtered.includes('BEGIN RSA PRIVATE KEY'));
    });
    
    test('Should filter database connection strings', () => {
        const code = `
            const url = "mongodb://user:pass@localhost:27017/db";
            postgres://admin:secret@db.example.com:5432/mydb
        `;
        
        const filtered = securityManager.filterSensitivePatterns(code);
        
        assert.ok(!filtered.includes('user:pass'));
        assert.ok(!filtered.includes('admin:secret'));
    });
    
    test('Should filter JWT tokens', () => {
        const code = `
            const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        `;
        
        const filtered = securityManager.filterSensitivePatterns(code);
        
        assert.ok(!filtered.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    });
    
    test('Should exclude sensitive files', () => {
        const sensitiveFiles = [
            { fsPath: '/project/.env' },
            { fsPath: '/project/.env.local' },
            { fsPath: '/project/secrets.json' },
            { fsPath: '/project/private.key' },
            { fsPath: '/home/user/.ssh/id_rsa' }
        ];
        
        for (const uri of sensitiveFiles) {
            assert.ok(
                securityManager.shouldExcludeFile(uri as any),
                `Should exclude ${uri.fsPath}`
            );
        }
    });
    
    test('Should not exclude normal files', () => {
        const normalFiles = [
            { fsPath: '/project/index.ts' },
            { fsPath: '/project/package.json' },
            { fsPath: '/project/README.md' }
        ];
        
        for (const uri of normalFiles) {
            assert.ok(
                !securityManager.shouldExcludeFile(uri as any),
                `Should not exclude ${uri.fsPath}`
            );
        }
    });
    
    test('Should check if pattern is safe to share', () => {
        const safePattern = {
            name: 'getter-setter',
            confidence: 0.9,
            usageCount: 5,
            code: 'function getName() { return this.name; }'
        };
        
        assert.ok(securityManager.isPatternSafeToShare(safePattern));
    });
    
    test('Should reject unsafe patterns', () => {
        const unsafePattern = {
            name: 'api-call',
            confidence: 0.9,
            usageCount: 5,
            code: 'apiKey: "sk-secret123"'
        };
        
        assert.ok(!securityManager.isPatternSafeToShare(unsafePattern));
    });
    
    test('Should reject low confidence patterns', () => {
        const lowConfidencePattern = {
            name: 'test',
            confidence: 0.5,
            usageCount: 2,
            code: 'test code'
        };
        
        assert.ok(!securityManager.isPatternSafeToShare(lowConfidencePattern));
    });
    
    test('Should encrypt and decrypt data', async () => {
        await securityManager.initialize();
        
        const originalData = 'sensitive information';
        const encrypted = securityManager.encrypt(originalData);
        
        assert.notStrictEqual(encrypted, originalData);
        assert.ok(encrypted.includes(':'));
        
        const decrypted = securityManager.decrypt(encrypted);
        assert.strictEqual(decrypted, originalData);
    });
    
    test('Should validate trusted connections', () => {
        assert.ok(securityManager.validateConnection('localhost', 7000));
        assert.ok(securityManager.validateConnection('127.0.0.1', 7000));
        assert.ok(securityManager.validateConnection('::1', 7000));
    });
    
    test('Should reject untrusted connections', () => {
        assert.ok(!securityManager.validateConnection('evil.com', 7000));
        assert.ok(!securityManager.validateConnection('192.168.1.100', 7000));
    });
    
    test('Should determine security level', async () => {
        await securityManager.initialize();
        
        const level = securityManager.getSecurityLevel();
        assert.ok(['low', 'medium', 'high'].includes(level));
    });
    
    test('Should generate audit logs', () => {
        const consoleSpy = sandbox.spy(console, 'log');
        
        securityManager.auditLog('test_event', { detail: 'test' });
        
        assert.ok(consoleSpy.called);
        const logCall = consoleSpy.firstCall.args.join(' ');
        assert.ok(logCall.includes('[AUDIT]'));
        assert.ok(logCall.includes('test_event'));
    });
    
    test('Should handle initialization errors gracefully', async () => {
        // Force an error in initialization
        (configManager as any).context.globalState.get = sandbox.stub().throws(new Error('Init error'));
        
        // Should not throw
        await assert.doesNotReject(async () => {
            await securityManager.initialize();
        });
    });
});