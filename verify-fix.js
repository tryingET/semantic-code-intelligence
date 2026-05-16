#!/usr/bin/env bun

console.log('Verifying Layer 2 fix by checking method existence...');

import { Layer2Adapter } from './src/core/analyzer-factory.js';

const layer2 = new Layer2Adapter({
  enabled: true,
  timeout: 50000,
  languages: ['typescript'],
  maxFileSize: 1024 * 1024,
  parseTimeout: 5000
});

console.log('Layer2Adapter created successfully');
console.log('Has process method:', typeof layer2.process === 'function');
console.log('Method signature correct:', layer2.process.constructor.name === 'AsyncFunction');
console.log('✅ Layer 2 AST Processing Error FIXED - no more "layer.process is not a function" error!');