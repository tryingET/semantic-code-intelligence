/**
 * StatusBarManager Unit Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { StatusBarManager } from '../../../ui/StatusBarManager';

suite('StatusBarManager Test Suite', () => {
    let statusBarManager: StatusBarManager;
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let mockStatusBarItem: any;
    let mockProgressBarItem: any;
    let mockStatsBarItem: any;
    
    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock status bar items
        mockStatusBarItem = {
            show: sandbox.spy(),
            hide: sandbox.spy(),
            dispose: sandbox.spy(),
            text: '',
            tooltip: '',
            command: '',
            backgroundColor: undefined
        };
        
        mockProgressBarItem = { ...mockStatusBarItem };
        mockStatsBarItem = { ...mockStatusBarItem };
        
        // Mock window.createStatusBarItem
        let callCount = 0;
        sandbox.stub(vscode.window, 'createStatusBarItem').callsFake(() => {
            callCount++;
            if (callCount === 1) return mockStatusBarItem;
            if (callCount === 2) return mockProgressBarItem;
            return mockStatsBarItem;
        });
        
        // Mock extension context
        context = {
            subscriptions: []
        } as any;
        
        statusBarManager = new StatusBarManager(context);
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    test('Should create three status bar items', () => {
        assert.strictEqual(context.subscriptions.length, 3);
    });
    
    test('Should show status bars when show() is called', () => {
        statusBarManager.show();
        
        assert.ok(mockStatusBarItem.show.called);
        assert.ok(mockStatsBarItem.show.called);
    });
    
    test('Should hide all status bars when hide() is called', () => {
        statusBarManager.hide();
        
        assert.ok(mockStatusBarItem.hide.called);
        assert.ok(mockProgressBarItem.hide.called);
        assert.ok(mockStatsBarItem.hide.called);
    });
    
    test('Should set active status correctly', () => {
        statusBarManager.setActive('Ready');
        
        assert.ok(mockStatusBarItem.text.includes('Ready'));
        assert.ok(mockStatusBarItem.text.includes('$(symbol-class)'));
        assert.strictEqual(mockStatusBarItem.backgroundColor, undefined);
    });
    
    test('Should set inactive status with warning color', () => {
        statusBarManager.setInactive();
        
        assert.ok(mockStatusBarItem.text.includes('Inactive'));
        assert.ok(mockStatusBarItem.backgroundColor);
    });
    
    test('Should set error status with error color', () => {
        statusBarManager.setError('Connection failed');
        
        assert.ok(mockStatusBarItem.text.includes('Connection failed'));
        assert.ok(mockStatusBarItem.text.includes('$(error)'));
        assert.ok(mockStatusBarItem.backgroundColor);
    });
    
    test('Should set warning status', () => {
        statusBarManager.setWarning('High memory usage');
        
        assert.ok(mockStatusBarItem.text.includes('High memory usage'));
        assert.ok(mockStatusBarItem.text.includes('$(warning)'));
    });
    
    test('Should show temporary messages', async () => {
        const originalText = mockStatusBarItem.text;
        statusBarManager.setMessage('Pattern learned', 100);
        
        assert.ok(mockStatusBarItem.text.includes('Pattern learned'));
        
        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Should revert to original text
        assert.notStrictEqual(mockStatusBarItem.text.includes('Pattern learned'), true);
    });
    
    test('Should show progress with percentage', () => {
        statusBarManager.setProgress('Analyzing', 50);
        
        assert.ok(mockProgressBarItem.text.includes('Analyzing'));
        assert.ok(mockProgressBarItem.text.includes('50%'));
        assert.ok(mockProgressBarItem.text.includes('█'));
        assert.ok(mockProgressBarItem.show.called);
    });
    
    test('Should show progress without percentage', () => {
        statusBarManager.setProgress('Loading');
        
        assert.ok(mockProgressBarItem.text.includes('Loading'));
        assert.ok(mockProgressBarItem.text.includes('$(sync~spin)'));
        assert.ok(mockProgressBarItem.show.called);
    });
    
    test('Should clear progress', () => {
        statusBarManager.setProgress('Loading');
        statusBarManager.clearProgress();
        
        assert.ok(mockProgressBarItem.hide.called);
        assert.strictEqual(mockProgressBarItem.text, '');
    });
    
    test('Should update statistics', () => {
        statusBarManager.setActive();
        statusBarManager.updateStats({
            concepts: 100,
            patterns: 50,
            lastOperation: 'rename',
            operationTime: 250
        });
        
        assert.ok(mockStatsBarItem.text.includes('100'));
        assert.ok(mockStatsBarItem.text.includes('50'));
        assert.ok(mockStatsBarItem.text.includes('rename'));
        assert.ok(mockStatsBarItem.text.includes('250ms'));
    });
    
    test('Should format statistics correctly', () => {
        statusBarManager.setActive();
        statusBarManager.updateStats({
            concepts: 42,
            patterns: 7,
            lastOperation: 'find-references',
            operationTime: 1234
        });
        
        assert.ok(mockStatsBarItem.text.includes('$(symbol-namespace) 42'));
        assert.ok(mockStatsBarItem.text.includes('$(symbol-method) 7'));
        assert.ok(mockStatsBarItem.text.includes('find-references'));
        assert.ok(mockStatsBarItem.text.includes('1234ms'));
    });
    
    test('Should hide stats when not active', () => {
        statusBarManager.setInactive();
        statusBarManager.updateStats({
            concepts: 100,
            patterns: 50
        });
        
        assert.ok(mockStatsBarItem.hide.called);
    });
    
    test('Should dispose all status bars', () => {
        statusBarManager.dispose();
        
        assert.ok(mockStatusBarItem.dispose.called);
        assert.ok(mockProgressBarItem.dispose.called);
        assert.ok(mockStatsBarItem.dispose.called);
    });
    
    test('Should handle undefined stats gracefully', () => {
        statusBarManager.setActive();
        
        assert.doesNotThrow(() => {
            statusBarManager.updateStats({});
        });
    });
});