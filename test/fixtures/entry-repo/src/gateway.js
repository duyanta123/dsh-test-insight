import express from "express";
import { checkPermission } from "./guard.js";

const app = express();
app.get("/resource", (request, response) => {
  if (!checkPermission(request.headers.authorization)) {
    response.status(403);
    return;
  }
  response.json({ ok: true });
});
export { app };
