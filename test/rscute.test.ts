import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import path from 'path';

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
