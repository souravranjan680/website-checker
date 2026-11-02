// After `npx shadcn add <component>`: point components at our own cn() helper
// (src/lib/utils.ts) instead of the "cn" npm package the CLI adds.
// Written in Node (not PowerShell) so file encodings stay plain UTF-8.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BOM = String.fromCharCode(0xfeff);
const root = path.resolve(import.meta.dirname, '../src');
let fixed = 0;

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(tsx?|jsx?)$/.test(name)) {
      const original = readFileSync(file, 'utf8');
      const text = original.startsWith(BOM) ? original.slice(1) : original;
      const next = text.replace(/import \{ cn \} from ["']cn["']/g, 'import { cn } from "@/lib/utils"');
      if (next !== original) {
        writeFileSync(file, next, 'utf8');
        fixed += 1;
      }
    }
  }
};

walk(root);
console.log(`Fixed ${fixed} file(s). Now run: npm uninstall cn -w @whc/web`);
