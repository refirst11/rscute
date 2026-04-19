const { execSync } = require('child_process');

const tests = [
  'node -r ./dist/index.js ./test/test.tsx',
  'node ./dist/cli.js test/cli-test-target-1.ts',
  'node test/register-api-test.js',
  'node test/execute-api-test.js',
  'node -r ./dist/index.js ./test/collision_test/main.ts',
];

const labels = ['node-r', 'cli', 'register', 'vm', 'collision'];

for (let i = 0; i < tests.length; i++) {
  console.log(`\n=== ${labels[i]} ===`);
  execSync(tests[i], { stdio: 'inherit' });
}
