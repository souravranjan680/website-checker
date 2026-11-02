import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });

/** Connection string of the dedicated test database (never the real one). */
export function getTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env first.');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST must point to a different database than DATABASE_URL.');
  }
  return url;
}
