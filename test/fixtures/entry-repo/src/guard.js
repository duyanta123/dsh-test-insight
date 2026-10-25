export function checkPermission(token) {
  if (!token) {
    throw new Error("unauthorized");
  }
  return token.length > 3;
}
