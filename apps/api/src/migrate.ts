import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { createPool } from "./db.js";

export async function migrate(pool: pg.Pool): Promise<void> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [name]);
    if (done.rowCount) continue;
    const sql = await readFile(path.join(dir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log("миграции применены");
  } finally {
    await pool.end();
  }
}
