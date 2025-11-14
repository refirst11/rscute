const { executeCode } = require('../dist/execute.js');

const code = `
export default { a: 1 };
export const a = 2;
`;

async function abs() {
  const { a, default: toml } = await executeCode(code);
  console.log(toml.a);
  console.log(a);
}

abs();
