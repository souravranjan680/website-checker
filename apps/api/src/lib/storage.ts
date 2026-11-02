import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ReadStream } from 'node:fs';

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

/** The folder containing the root package.json with "workspaces". */
export function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && readFileSync(pkg, 'utf8').includes('"workspaces"')) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Read access to screenshot files written by the scanner (same folder / Docker volume).
 * Keys come from the database, never from the request, and must stay inside the root.
 */
export async function openStoredFile(
  root: string,
  key: string,
): Promise<{ stream: ReadStream; size: number } | null> {
  if (!SAFE_KEY.test(key) || key.includes('..')) return null;
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    const info = await stat(full);
    return { stream: createReadStream(full), size: info.size };
  } catch {
    return null;
  }
}
