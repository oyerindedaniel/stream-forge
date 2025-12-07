import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

// Default to a placeholder if not set, to avoid startup crash during dev setup
const connectionString = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/streamforge';

const pool = new Pool({
    connectionString,
});

export const db = drizzle(pool, { schema });
