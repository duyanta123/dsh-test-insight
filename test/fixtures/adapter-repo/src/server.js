import { authenticate } from "./auth.js";

export function serve(token) {
  return authenticate(token);
}
