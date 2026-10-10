import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const pool = createPool();
await migrate(pool);
const app = createApp(pool);
const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`api слушает ${hostname}:${port}`);
});
