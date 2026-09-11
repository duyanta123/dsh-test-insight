import { serve } from "./server.js";

test("serves authenticated requests", () => {
  return serve("token");
});
