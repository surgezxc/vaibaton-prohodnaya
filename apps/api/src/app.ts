import { Hono } from "hono";
import { cors } from "hono/cors";
import type pg from "pg";
import { registerJournal } from "./journal.js";
import { registerAnalytics } from "./modules/analytics.js";
import { registerAssistant } from "./modules/assistant.js";
import { registerAttempts } from "./modules/attempts.js";
import { registerDevices } from "./modules/devices.js";
import { registerLocations } from "./modules/locations.js";
import { registerPeople } from "./modules/people.js";
import { registerZones } from "./modules/zones.js";
import type { ApiApp } from "./types.js";

export function createApp(pool: pg.Pool): ApiApp {
  const app: ApiApp = new Hono();
  app.use(
    "*",
    cors({
      origin: process.env.WEB_ORIGIN ?? "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    }),
  );
  app.onError((error, c) => {
    console.error(error);
    return c.json(
      {
        reason: "Внутренняя ошибка сервера. Проход не засчитан.",
        reason_human: "Внутренняя ошибка сервера. Проход не засчитан.",
      },
      500,
    );
  });

  registerPeople(app, pool);
  registerDevices(app, pool);
  registerAttempts(app, pool);
  registerLocations(app, pool);
  registerZones(app, pool);
  registerAnalytics(app, pool);
  registerAssistant(app, pool);
  registerJournal(app, pool);
  return app;
}
