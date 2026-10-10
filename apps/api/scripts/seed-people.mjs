// Люди из «Первый пакет» без эталона лица. Фото не читаются, веса не качаются.
// Поля пропуска заполнены только у Гаджиева — они есть в docs/hackathon-plan.md.
// Остальным хватает ФИО из имени папки. Повторный запуск не затирает уже заведённых.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://prohodnaya:change-me@127.0.0.1:5432/prohodnaya";

const GADZHIEV = {
  full_name: "Гаджиев Магомед Ибрагимович",
  badge_number: "314",
  position: "арматурщик",
  company: "ООО «МонолитПодряд»",
  site_name: "ЖК Северный",
  issuer: "СтройГрад-Тест",
  valid_until: "2027-12-31",
};

async function packagePeopleDir() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const entries = await readdir(dir, { withFileTypes: true });
    const pack = entries.find((entry) => entry.isDirectory() && entry.name.includes("пакет"));
    if (pack) return path.join(dir, pack.name, "Персонал");
    dir = path.dirname(dir);
  }
  throw new Error("В репозитории нет каталога «Первый пакет/Персонал».");
}

async function namesFromPackage() {
  const staff = await packagePeopleDir();
  const entries = await readdir(staff, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.normalize("NFC")).sort();
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const names = await namesFromPackage();
  let inserted = 0;
  for (const fullName of names) {
    const exists = await client.query("SELECT 1 FROM people WHERE full_name = $1", [fullName]);
    if (exists.rowCount) continue;
    const extra = fullName === GADZHIEV.full_name ? GADZHIEV : { full_name: fullName };
    await client.query(
      `INSERT INTO people (full_name, badge_number, position, company, site_name, issuer, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        extra.full_name,
        extra.badge_number ?? null,
        extra.position ?? null,
        extra.company ?? null,
        extra.site_name ?? null,
        extra.issuer ?? null,
        extra.valid_until ?? null,
      ],
    );
    inserted += 1;
    console.log("заведён", fullName);
  }
  const total = await client.query("SELECT count(*)::int AS n FROM people");
  console.log(`вставлено ${inserted}, всего людей ${total.rows[0].n}, эталонов нет`);
} finally {
  await client.end();
}
