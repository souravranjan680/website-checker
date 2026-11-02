import { execSync } from 'node:child_process';
import { getTestDatabaseUrl } from './test-env';

/** Brings the test database schema up to date with the committed migrations. */
export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
  });
}
