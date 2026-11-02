// Configuration for the Prisma CLI (generate, migrate, studio).
// npm workspace scripts run inside packages/db, so the root .env is two folders up.
// In Docker there is no .env file; variables come from docker-compose.yml instead.
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional so `prisma generate` also works without a database (e.g. Docker builds).
    url: process.env.DATABASE_URL,
  },
});
