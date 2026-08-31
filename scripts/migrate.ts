/**
 * Apply pending Drizzle migrations.
 *
 *     npm run db:migrate
 *
 * Run from CI on deploy, not from the app at boot — a serverless function that
 * migrates on cold start will race every other instance starting at the same
 * time.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });
const db = drizzle(pool);

migrate(db, { migrationsFolder: './lib/db/migrations' })
  .then(async () => {
    console.log('Migrations applied.');
    await pool.end();
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await pool.end();
    process.exit(1);
  });
