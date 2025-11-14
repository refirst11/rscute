const { executeCode } = require('../dist/execute.js');

const code = `
export default { a: 1 };
export const a = 2;
export function collect() {
 return 'function is collect';
};
`;

async function abs() {
  const { default: df, a, collect } = await executeCode(code);
  console.log(df.a);
  console.log(a);
  console.log(collect());
}

abs();
