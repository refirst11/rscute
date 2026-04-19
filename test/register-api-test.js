const { register } = require('../dist/register.js');

register();

require('./register-test-target.ts');
const message = 'register-test-target.js has been executed.';
console.log(message);
