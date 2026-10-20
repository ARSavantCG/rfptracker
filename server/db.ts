import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * LOCAL_PG=1 talks to a plain Postgres with the standard driver.
 *
 * For verification only: running the whole server against a throwaway local
 * database, so a feature can be exercised end to end — routes, migrations and
 * all — instead of reasoned about. The Neon driver speaks websockets and
 * cannot reach a local Postgres. Never set in a deployment; unset, nothing
 * below changes from how production has always connected.
 */
const useLocalPg = process.env.LOCAL_PG === '1';

export const pool: Pool = useLocalPg
  ? (new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) as unknown as Pool)
  : new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10
    });

export const db = (useLocalPg
  ? drizzlePg(pool as unknown as pg.Pool, { schema })
  : drizzle({ client: pool, schema })) as ReturnType<typeof drizzle<typeof schema>>;

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('Database pool error:', err);
});
