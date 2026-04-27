/**
 * Rule Sandbox Test
 * 
 * Demonstrates the capabilities of the rule sandbox including
 * timeout handling and crash isolation.
 */

import { RuleSandbox } from './rule-sandbox.service';
import { SandboxTimeoutError, SandboxCrashError } from './sandbox.errors';

async function runTests() {
  const sandbox = new RuleSandbox();
  console.log('--- Starting Sandbox Tests ---');

  // 1. Test Successful Execution
  console.log('\n[Test 1] Successful Execution');
  const successResult = await sandbox.execute(
    (ctx) => `Hello, ${ctx.name}!`,
    { name: 'Developer' }
  );
  console.log('Result:', JSON.stringify(successResult, null, 2));

  // 2. Test Timeout
  console.log('\n[Test 2] Timeout Handling');
  const timeoutResult = await sandbox.execute(
    async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return 'Should have timed out';
    },
    {},
    { timeoutMs: 500 }
  );
  console.log('Success:', timeoutResult.success);
  console.log('Error Code:', timeoutResult.error?.code);
  console.log('Error Message:', timeoutResult.error?.message);

  // 3. Test Crash Isolation
  console.log('\n[Test 3] Crash Isolation');
  const crashResult = await sandbox.execute(
    () => {
      throw new Error('Something went wrong inside the rule');
    },
    {}
  );
  console.log('Success:', crashResult.success);
  console.log('Error Code:', crashResult.error?.code);
  console.log('Error Message:', crashResult.error?.message);

  // 4. Test Async Success
  console.log('\n[Test 4] Async Success');
  const asyncResult = await sandbox.execute(
    async (ctx) => {
      const data = await Promise.resolve({ score: ctx.base * 2 });
      return data;
    },
    { base: 50 }
  );
  console.log('Result:', JSON.stringify(asyncResult, null, 2));

  console.log('\n--- Sandbox Tests Completed ---');
}

// In a real project, this would be a Jest test. 
// For now we provide it as a standalone demonstration script.
if (require.main === module) {
  runTests().catch(console.error);
}

export { runTests };
