import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import path from 'path';
import { execute } from '../src/vm';
import { bundle } from '../src/bundle';

test('rscute API - vm.execute()', async (t) => {
  await t.test('executes basic ESM code and returns exports', () => {
    const code = `
      export default { a: 1 };
      export const a = 2;
      export function collect() {
        return 'function is collect';
      }
    `;
    const result: any = execute(code);
    assert.strictEqual(result.default.a, 1);
    assert.strictEqual(result.a, 2);
    assert.strictEqual(result.collect(), 'function is collect');
  });

  await t.test('handles shorthand destructuring name conflicts correctly (Bug B)', () => {
    const entryCode = `
      import { conflict, getConflict2, getShorthandObject } from './shadowing_test_dep2';
      export const conflictVal = conflict;
      export const conflict2Val = getConflict2();
      export const shorthandObj = getShorthandObject();
    `;
    const filePath = path.resolve(__dirname, 'shadowing_test_temp_entry.ts');
    const result: any = execute(entryCode, { filePath });

    assert.strictEqual(result.conflictVal, 'dep2');
    assert.strictEqual(result.conflict2Val, 'inner-value');
    assert.strictEqual(result.shorthandObj.conflict, 'local-shorthand');
  });

  await t.test('preserves global process object from shadowing (Bug A)', () => {
    const entryCode = `
      import { process as myProcess } from './shadowing_test_dep1';
      export const myProcessVal = myProcess;
      export const globalProcessExists = typeof process !== 'undefined' && typeof process.env === 'object';
    `;
    const filePath = path.resolve(__dirname, 'shadowing_test_temp_entry.ts');
    const result: any = execute(entryCode, { filePath });

    assert.strictEqual(result.myProcessVal, 'my-process');
    assert.strictEqual(result.globalProcessExists, true);
  });
});

test('rscute API - bundle()', () => {
  const filePath = path.resolve(__dirname, 'shadowing_test_dep1.ts');
  const result = bundle(filePath);
  assert.match(result, /const process_1 = "my-process";/);
});

test('rscute CLI & loader hooks behavior', async (t) => {
  await t.test('CLI runs typescript script successfully', () => {
    const cliPath = path.resolve(__dirname, '../dist/cli.js');
    const targetPath = path.resolve(__dirname, 'cli-test-target-1.ts');
    const stdout = execSync(`node ${cliPath} ${targetPath}`, { encoding: 'utf8' });
    assert.match(stdout, /Hello from the API test target 1!/);
  });

  await t.test('register API hooks TS imports correctly', () => {
    const runnerPath = path.resolve(__dirname, 'register-api-test.js');
    const stdout = execSync(`node ${runnerPath}`, { encoding: 'utf8' });
    assert.match(stdout, /register-test-target.ts has been executed/);
    assert.match(stdout, /register-test-target.js has been executed/);
  });

  await t.test('node -r index.js executes TS and resolves collisions', () => {
    const hookPath = path.resolve(__dirname, '../dist/index.js');
    const targetPath = path.resolve(__dirname, 'collision_test/main.ts');
    const stdout = execSync(`node -r ${hookPath} ${targetPath}`, { encoding: 'utf8' });
    assert.match(stdout, /foo foo foo-y/);
    assert.match(stdout, /bar bar bar-y/);
    assert.match(stdout, /main foo bar main-y/);
  });

  await t.test('node -r index.js executes TSX/ESM/CJS interop test', () => {
    const hookPath = path.resolve(__dirname, '../dist/index.js');
    const targetPath = path.resolve(__dirname, 'test.tsx');
    const stdout = execSync(`node -r ${hookPath} ${targetPath}`, { encoding: 'utf8' });
    assert.match(stdout, /bsumu/);
    assert.match(stdout, /asumu/);
    assert.match(stdout, /esm default export/);
    assert.match(stdout, /esm named export/);
    assert.match(stdout, /cjs default export/);
    assert.match(stdout, /cjs named export/);
  });

  await t.test('executes ESM project with JIT ESM loader successfully', () => {
    const cliPath = path.resolve(__dirname, '../dist/cli.js');
    const targetPath = path.resolve(__dirname, 'esm_project/entry.js');
    const stdout = execSync(`node ${cliPath} ${targetPath}`, { encoding: 'utf8' });
    assert.match(stdout, /ESM project run: hello-from-ts hello-from-ts hello-from-dep-js-mapped-to-ts hello-from-ts/);
  });
});
