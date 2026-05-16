#!/usr/bin/env node

// Simple test to verify dashboard API connectivity
const fetch = require('http').get;
const url = require('url');

console.log('🧪 Testing Ontology-LSP Dashboard API Connectivity\n');

function makeRequest(endpoint) {
    return new Promise((resolve, reject) => {
        const options = url.parse(`http://localhost:7000${endpoint}`);
        
        const req = require('http').get(options, (res) => {
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
        } catch (error) {
            console.log('❌ Failed:', error.message);
        }
        console.log('');
    }
}

testEndpoints();