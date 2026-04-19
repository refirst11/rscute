const { execute } = require('../dist/vm.js');

const code = `
export default { a: 1 };
export const a = 2;
export function collect() {
 return 'function is collect';
};
`;

async function abs() {
  const { default: df, a, collect } = execute(code);
  console.log(df.a);
  console.log(a);
  console.log(collect());
}

abs();
