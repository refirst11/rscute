const { run } = require('../dist/cli.js');

const targets = ['./test/cli-test-target-1.ts', './test/cli-test-target-2.ts'];

run(targets, { mode: 'parallel' });
