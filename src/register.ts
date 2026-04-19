const { bundle } = require('./bundle.js');
const { Module } = require('module');

function register() {
  const requireExt = Module._extensions;
  const targetExtensions = ['.ts', '.tsx', '.cts'];

  targetExtensions.forEach(ext => {
    requireExt[ext] = function (module: any, filename: string) {
      if (filename.includes('node_modules')) {
        return requireExt['.js'](module, filename);
      }
      const code = bundle(filename);
      module._compile(code, filename);
    };
  });
}

module.exports = { register };
