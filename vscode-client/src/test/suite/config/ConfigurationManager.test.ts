/**
 * ConfigurationManager Unit Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigurationManager } from '../../../config/ConfigurationManager';

suite('ConfigurationManager Test Suite', () => {
    let configManager: ConfigurationManager;
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    
    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock extension context
        context = {
            subscriptions: [],
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: sandbox.stub().returns([])
            },
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: sandbox.stub().returns([])
            }
        } as any;
        
        configManager = new ConfigurationManager(context);
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    test('Should initialize with default configuration', async () => {
        await configManager.initialize();
        
        assert.strictEqual(configManager.get('enable'), true);
        assert.strictEqual(configManager.get('fuzzyMatching.enabled'), true);
        assert.strictEqual(configManager.get('patternLearning.enabled'), true);
    });
    
    test('Should cache configuration values', () => {
        const value1 = configManager.get('enable');
        const value2 = configManager.get('enable');
        
        assert.strictEqual(value1, value2);
        // Should only access config once due to caching
    });
    
    test('Should validate numeric ranges', async () => {
        await configManager.initialize();
        
        // Test threshold validation
        await configManager.set('fuzzyMatching.threshold', 1.5);
        const threshold = configManager.get<number>('fuzzyMatching.threshold');
        assert.ok(threshold >= 0 && threshold <= 1, 'Threshold should be clamped to valid range');
        
        // Test depth validation
        await configManager.set('propagation.maxDepth', 15);
        const depth = configManager.get<number>('propagation.maxDepth');
        assert.ok(depth >= 1 && depth <= 10, 'Depth should be clamped to valid range');
    });
    
    test('Should notify listeners on configuration change', (done) => {
        let notified = false;
        
        configManager.onDidChange('enable', (value) => {
            notified = true;
            assert.strictEqual(value, false);
            done();
        });
        
        configManager.set('enable', false);
    });
    
    test('Should migrate old configuration keys', async () => {
        // Setup old config
        const config = vscode.workspace.getConfiguration('ontologyLSP');
        sandbox.stub(config, 'has').returns(true);
        sandbox.stub(config, 'get').returns(true);
        const updateStub = sandbox.stub(config, 'update');
        
        await configManager.initialize();
        
        // Should have called update to migrate
        assert.ok(updateStub.called);
    });
    
    test('Should return all configuration as object', () => {
        const allConfig = configManager.getAll();
        
        assert.ok(allConfig.enable !== undefined);
        assert.ok(allConfig.fuzzyMatching);
        assert.ok(allConfig.patternLearning);
        assert.ok(allConfig.propagation);
        assert.ok(allConfig.performance);
        assert.ok(allConfig.ui);
        assert.ok(allConfig.telemetry);
        assert.ok(allConfig.experimental);
    });
    
    test('Should handle configuration errors gracefully', async () => {
        // Simulate config error
        sandbox.stub(vscode.workspace, 'getConfiguration').throws(new Error('Config error'));
        
        // Should not throw
        assert.doesNotThrow(() => {
            new ConfigurationManager(context);
        });
    });
    
    test('Should dispose listeners properly', () => {
        const disposable = configManager.onDidChange('test', () => {});
        assert.ok(disposable);
        
        // Should not throw
        disposable.dispose();
    });
});