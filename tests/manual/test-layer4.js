// Quick test to verify Layer 4 registration works

async function testLayer4Registration() {
    try {
        console.log('Creating test context...');

        // Create test configuration
        const config = {
            workspaceRoot: '/tmp/test',
            layers: {
                layer1: { enabled: false, timeout: 50 },
                layer2: { enabled: false, timeout: 100 },
                layer3: { enabled: false, timeout: 50 },
                layer4: { enabled: true, timeout: 50 }, // Only enable Layer 4
                layer5: { enabled: false, timeout: 100 },
            },
            cache: {
                enabled: true,
                strategy: 'memory',
                memory: {
                    maxSize: 1024 * 1024,
                    ttl: 300,
                },
            },
            database: {
                path: ':memory:',
                maxConnections: 10,
            },
            performance: {
                targetResponseTime: 100,
                maxConcurrentRequests: 50,
                healthCheckInterval: 30000,
            },
            monitoring: {
                enabled: false,
                metricsInterval: 60000,
                logLevel: 'error',
                tracing: {
                    enabled: false,
                    sampleRate: 0,
                },
            },
        };

        // Import required classes
        const { LayerManager } = await import('./src/core/layer-manager.js');
        const { SharedServices } = await import('./src/core/services/index.js');
        const { registerRealLayers } = await import('./tests/test-helpers.js');

        // Create services
        const sharedServices = new SharedServices(config);
        await sharedServices.initialize();

        // Create layer manager
        const layerManager = new LayerManager(config, sharedServices.eventBus);
        await layerManager.initialize();

        // Register real layers
        await registerRealLayers(layerManager, config);

        // Check if Layer 4 is registered
        const layer4 = layerManager.getLayer('layer4');
        if (layer4) {
            console.log('✅ Layer 4 successfully registered:', layer4.name);
            console.log('✅ Layer 4 target latency:', layer4.targetLatency + 'ms');
            console.log('✅ Layer 4 healthy:', layer4.isHealthy());

            const diagnostics = layerManager.getDiagnostics();
            console.log('✅ Registered layers:', diagnostics.registeredLayers);
            console.log('✅ Layer count:', diagnostics.layerCount);

            return true;
        } else {
            console.log('❌ Layer 4 not found in layer manager');
            return false;
        }
    } catch (error) {
        console.error('❌ Test failed:', error);
        return false;
    }
}

// Run the test
testLayer4Registration().then((success) => {
    process.exit(success ? 0 : 1);
});
