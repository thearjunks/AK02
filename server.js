import express from "express";
import { handleRequest } from "./server.mjs";

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const app = express();

app.use(handleRequest);

app.listen(port, host, () => {
  console.log(`STC dashboard listening on ${host}:${port}`);
});
