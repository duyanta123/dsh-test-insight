import { authenticate } from "./auth.js";

test("authenticates a token", () => {
  return authenticate("token");
});
