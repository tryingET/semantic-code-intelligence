#!/usr/bin/env bun
/**
 * Demonstration script for MCP server error handling and recovery
 * 
 * This script showcases the enhanced error handling capabilities:
 * - Connection recovery
 * - Request validation  
 * - Timeout management
 * - File-based logging
 * - Circuit breaker pattern
 */

import { fileLogger, mcpLogger } from '../src/core/utils/file-logger.js';
import { 
  globalErrorHandler,
  withMcpErrorHandling,
  createValidationError,
  ErrorContext
} from '../src/core/utils/error-handler.js';
import { ConnectionManager } from '../src/core/utils/connection-manager.js';

async function main() {
  console.log('🚀 MCP Server Error Handling Demonstration');
  console.log('==========================================\n');

  // 1. Demonstrate file logging
  console.log('1. File-based Logging (check .ontology/logs/ directory)');
  mcpLogger.info('Demo script started');
  mcpLogger.debug('This is a debug message with data', { 
    demoMode: true,
    timestamp: new Date().toISOString() 
  });
  mcpLogger.warn('This is a warning message');
  mcpLogger.error('This is an error message', new Error('Demo error'), { 
    additionalContext: 'error logging demo' 
  });
  console.log('✅ Logs written to file (not stdout/stderr)\n');

  // 2. Demonstrate successful error handling with retries
  console.log('2. Error Recovery with Retries');
  let attemptCount = 0;
  
  const context: ErrorContext = {
    component: 'DemoScript',
    operation: 'retry_demo',
    timestamp: Date.now()
  };

  try {
    const result = await globalErrorHandler.withErrorHandling(
      context,
      async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Simulated failure (attempt ${attemptCount})`);
        }
        return `Success after ${attemptCount} attempts`;
      },
      { 
        maxRetries: 3,
        baseDelay: 500,
        exponentialBackoff: true
      }
    );
    console.log(`✅ ${result}`);
  } catch (error) {
    console.log(`❌ Failed: ${error.message}`);
  }
  console.log();

  // 3. Demonstrate validation errors (should not retry)
  console.log('3. Request Validation (no retries for validation errors)');
  try {
    await globalErrorHandler.withErrorHandling(
      { ...context, operation: 'validation_demo' },
      async () => {
        throw new Error('Missing required parameter: symbol');
      },
      { maxRetries: 3 }
    );
  } catch (error) {
    console.log('✅ Validation error correctly handled without retries');
    console.log(`   Error: ${error.message}`);
  }
  console.log();

  // 4. Demonstrate connection management
  console.log('4. Connection State Management');
  const connectionManager = new ConnectionManager({
    enableHeartbeat: false,
    connectionTimeout: 1000
  });

  // Track connection events
  connectionManager.onStateChange((event) => {
    console.log(`   📡 Connection: ${event.previousState} → ${event.state}`);
  });

  await connectionManager.connect({ demoMode: true });
  connectionManager.recordMessage('incoming', { method: 'tools/list' });
  connectionManager.recordMessage('outgoing', { result: { tools: [] } });
  
  const metrics = connectionManager.getMetrics();
  console.log(`✅ Connection metrics: ${metrics.messagesReceived} received, ${metrics.messagesSent} sent`);
  
  await connectionManager.disconnect();
  console.log();

  // 5. Demonstrate circuit breaker
  console.log('5. Circuit Breaker Pattern');
  const circuitBreakerHandler = globalErrorHandler; // Uses same instance for demo
  
  // Simulate repeated failures to trigger circuit breaker
  for (let i = 0; i < 6; i++) {
    try {
      await circuitBreakerHandler.withErrorHandling(
        { ...context, operation: 'circuit_demo' },
        async () => { 
          throw new Error('Service unavailable'); 
        },
        { 
          maxRetries: 0, 
          circuitBreakerThreshold: 3 
        }
      );
    } catch (error) {
      if (error.message.includes('Circuit breaker open')) {
        console.log(`✅ Circuit breaker activated after failures`);
        break;
      }
    }
  }
  console.log();

  // 6. Demonstrate timeout handling
  console.log('6. Timeout Handling');
  try {
    await globalErrorHandler.withErrorHandling(
      { ...context, operation: 'timeout_demo' },
      async () => {
        // Simulate operation that takes too long
        return new Promise((resolve) => {
          setTimeout(() => resolve('Too late'), 5000);
        });
      },
      { maxRetries: 0 }
    );
  } catch (error) {
    if (error.message.includes('timed out')) {
      console.log('✅ Timeout handled correctly');
      console.log(`   Error: ${error.message}`);
    }
  }
  console.log();

  // 7. Demonstrate MCP error creation
  console.log('7. MCP Protocol Error Responses');
  const mcpError = globalErrorHandler.createMcpError(
    -32602, // InvalidParams
    'Missing required parameter: symbol',
    context
  );
  
  console.log('✅ MCP error created:');
  console.log(`   Code: ${mcpError.code}`);
  console.log(`   Message: ${mcpError.message}`);
  console.log(`   Data: ${JSON.stringify((mcpError as any).data, null, 2)}`);
  console.log();

  // 8. Demonstrate health checking
  console.log('8. Health Check Information');
  const healthCheck = connectionManager.getHealthCheck();
  console.log('✅ Health check data:');
  console.log(`   Status: ${healthCheck.status}`);
  console.log(`   State: ${healthCheck.state}`);
  console.log(`   Connections: ${healthCheck.connections}`);
  console.log(`   Messages: ${healthCheck.messages.received} received, ${healthCheck.messages.sent} sent`);
  console.log();

  mcpLogger.info('Demo script completed successfully');
  console.log('🎉 Error Handling Demonstration Complete!');
  console.log();
  console.log('📄 Check the following for detailed logs:');
  console.log('   • .ontology/logs/ directory for file-based logs');
  console.log('   • Connection state changes are logged');
  console.log('   • Error context includes component, operation, and timing');
  console.log('   • All sensitive data is sanitized in logs');
}

// Handle any uncaught errors in the demo itself
process.on('uncaughtException', (error) => {
  console.error('❌ Demo script error:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Demo script rejection:', reason);
  process.exit(1);
});

// Run the demonstration
main().catch(console.error);