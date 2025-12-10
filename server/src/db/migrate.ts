import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as path from "path";
import { DATABASE_URL } from "../lib/constants";

async function runMigrations() {
  console.log("[Migrate] Starting database migrations...");
  console.log("[Migrate] Database URL:", DATABASE_URL?.substring(0, 5) + "...");

  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    console.log("[Migrate] ✅ Migrations completed successfully!");
  } catch (error) {
    console.error("[Migrate] ❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
