import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pgPool } from "./client";

export async function runMigrations(): Promise<void> {
  const sql = await readFile(join(process.cwd(), "src", "db", "migrations.sql"), "utf8");
  await pgPool.query(sql);
}
