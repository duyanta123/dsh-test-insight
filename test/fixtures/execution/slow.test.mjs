import { test } from "node:test";

// A registered async test keeps the runner waiting for the full duration on
// every Node line; a bare top-level timer lets newer runners exit early.
test("slow fixture stays busy", async () => {
  await new Promise((resolve) => setTimeout(resolve, 5000));
});
