import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(70612002)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (!rowCount) {
      await client.query(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    }
  }
  await client.query(`ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON schema_migrations FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON schema_migrations FROM authenticated; END IF;
END $$;`);
  await client.query("COMMIT");
  console.log("Migrations applied.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
