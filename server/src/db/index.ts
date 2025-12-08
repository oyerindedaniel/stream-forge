import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import dotenv from "dotenv";
import { DATABASE_URL } from "../lib/constants";

dotenv.config();

const connectionString = DATABASE_URL;

const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });
