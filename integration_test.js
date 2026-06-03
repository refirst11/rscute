const { execSync } = require('child_process');
console.log('Running rscute integration test suite...');
execSync('node -r ./dist/index.js --test test/rscute.test.ts', { stdio: 'inherit' });
