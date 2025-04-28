#!/usr/bin/env node
const { execute } = require('./execute.js');

if (process.argv[2]) {
  execute(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
