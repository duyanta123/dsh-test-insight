export function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareNullableText(left, right) {
  return compareText(left || "", right || "");
}
