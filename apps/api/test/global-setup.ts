import { execSync } from 'node:child_process';
import path from 'node:path';
import { testDatabaseUrl } from './test-env';

/** Applies the committed migrations to the test database (never the dev database). */
export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../../../packages/db'),
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
