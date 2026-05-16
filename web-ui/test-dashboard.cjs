#!/usr/bin/env node

// Simple test to verify dashboard API connectivity
const http = require('http');
const url = require('url');

console.log('🧪 Testing Ontology-LSP Dashboard API Connectivity\n');

function makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
        const options = url.parse(`http://localhost:7000${endpoint}`);
        
        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => reject(new Error('Timeout')));
    });
}

async function testEndpoints() {
    const tests = [
        { name: 'Health Check', endpoint: '/health' },
        { name: 'Stats', endpoint: '/api/v1/stats' },
        { name: 'Monitoring', endpoint: '/api/v1/monitoring' }
    ];
    
    for (const test of tests) {
        try {
            console.log(`Testing ${test.name} (${test.endpoint})...`);
            const result = await makeRequest(test.endpoint);
            console.log('✅ Success:', typeof result === 'object' ? 
                `${Object.keys(result).length} keys` : 
                result.substring(0, 100) + (result.length > 100 ? '...' : ''));
                
            if (test.endpoint === '/api/v1/monitoring' && result.data) {
                console.log('  📊 Monitoring data structure:');
                console.log(`    - System Health: ${result.data.systemHealth?.status}`);
                console.log(`    - Performance: ${result.data.performance?.totalRequests} requests`);
                console.log(`    - Cache: ${result.data.cache?.hitRate * 100}% hit rate`);
                console.log(`    - Layers: ${Object.keys(result.data.layers || {}).length} layers`);
                console.log(`    - Learning: ${result.data.learning?.patternsLearned} patterns`);
            }
        } catch (error) {
            console.log('❌ Failed:', error.message);
        }
        console.log('');
    }
}

console.log('Dashboard file location:');
console.log(`file://${__dirname}/dist/index.html\n`);

testEndpoints();