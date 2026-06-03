export const conflict = "dep2";
export function getConflict2() {
  const obj = { conflict: "inner-value" };
  const { conflict } = obj;
  return conflict;
}
export function getShorthandObject() {
  const conflict = "local-shorthand";
  return { conflict };
}
