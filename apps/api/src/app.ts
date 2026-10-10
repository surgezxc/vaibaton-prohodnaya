import { Hono } from "hono";
import { cors } from "hono/cors";
import type pg from "pg";
import { registerJournal } from "./journal.js";
import { registerAnalytics } from "./modules/analytics.js";
import { registerAssistant } from "./modules/assistant.js";
import { registerAttempts } from "./modules/attempts.js";
import { registerDevices } from "./modules/devices.js";
import { registerDirectory } from "./modules/directory.js";
import { registerLocations } from "./modules/locations.js";
import { registerMe } from "./modules/me.js";
import { registerPeople } from "./modules/people.js";
import { registerPlans } from "./modules/plans.js";
import { registerZones } from "./modules/zones.js";
import type { ApiApp } from "./types.js";

function corsOrigin(): string | string[] {
  const raw = (process.env.WEB_ORIGIN ?? "*").trim();
  if (raw === "" || raw === "*") return "*";
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.length === 0) return "*";
  return list.length === 1 ? list[0] : list;
}

export function createApp(pool: pg.Pool): ApiApp {
  const app: ApiApp = new Hono();
  app.use(
    "*",
    cors({
      origin: corsOrigin(),
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

  registerMe(app, pool);
  registerDirectory(app);
  registerPeople(app, pool);
  registerDevices(app, pool);
  registerAttempts(app, pool);
  registerLocations(app, pool);
  registerZones(app, pool);
  registerPlans(app, pool);
  registerAnalytics(app, pool);
  registerAssistant(app, pool);
  registerJournal(app, pool);
  return app;
}
