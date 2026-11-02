import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env first.');
  if (url === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST must point to a different database than DATABASE_URL.');
  }
  return url;
}
