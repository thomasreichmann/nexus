/**
 * Manual test script for stack trace source mapping.
 *
 * Run with: pnpm tsx apps/web/server/lib/logger/__dev__/test-stacktrace.ts
 *
 * This script verifies that:
 * 1. Stack traces show TypeScript source locations
 * 2. Code frames are displayed with syntax highlighting
 * 3. Frame collapsing works correctly
 */

// Force development mode for testing
// @ts-expect-error - NODE_ENV is read-only in types but writable at runtime
process.env.NODE_ENV = 'development';

// Import the patch installer
import '../patches/install';

function innerFunction(): never {
    throw new Error('Test error for stack trace verification');
}

function outerFunction(): void {
    innerFunction();
}

async function asyncFunction(): Promise<void> {
    await Promise.resolve();
    outerFunction();
}

console.log('='.repeat(60));
console.log('Stack Trace Source Mapping Test');
console.log('='.repeat(60));
console.log();

// Test synchronous error
console.log('1. Synchronous error:');
console.log('-'.repeat(40));
try {
    outerFunction();
} catch (e) {
    console.log((e as Error).stack);
}
console.log();

// Test async error
console.log('2. Async error:');
console.log('-'.repeat(40));
asyncFunction().catch((e) => {
    console.log((e as Error).stack);
});
