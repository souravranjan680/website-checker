import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk file storage for screenshots (a Docker volume in production).
 * Keys look like "scans/<scanId>/pages/<pageId>-desktop.jpg". They are built from
 * database IDs only, never from user input, and are checked to stay inside the root.
 */
export interface FileStorage {
  root: string;
  put(key: string, data: Buffer): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function resolveKey(root: string, key: string): string {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Unsafe storage key: ${key}`);
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep))
    throw new Error(`Storage key escapes root: ${key}`);
  return full;
}

export function createLocalStorage(root: string): FileStorage {
  return {
    root,
    async put(key, data) {
      const full = resolveKey(root, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    },
    async removePrefix(prefix) {
      await rm(resolveKey(root, prefix), { recursive: true, force: true });
    },
  };
}
