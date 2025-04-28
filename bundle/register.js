const { execute } = require('./execute.js');
const { Module } = require('module');

function register() {
  const requireExt = Module._extensions;
  const targetExtensions = ['.ts', '.tsx', '.cts'];

  targetExtensions.forEach(ext => {
    const originalHandler = requireExt[ext];

    requireExt[ext] = function (module, filename) {
      if (filename.includes('node_modules')) {
        return requireExt['.js'](module, filename);
      }

      try {
        module.exports = execute(filename);
      } catch (error) {
        console.error(`Error loading ${filename}`, error);
        if (originalHandler) {
          return originalHandler(module, filename);
        }
        throw error;
      }
    };
  });
}

module.exports = { register };
