import express from "express";
import { handleRequest, loadSavedData } from "./server.mjs";

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const app = express();

app.use(handleRequest);

async function start() {
  await loadSavedData();
  app.listen(port, host, () => {
    console.log(`STC dashboard listening on ${host}:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
