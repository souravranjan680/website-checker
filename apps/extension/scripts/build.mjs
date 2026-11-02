// Builds the extension into dist/ (production), dist-test/ (--test) or
// dist-keyed/ (--keyed: the production manifest plus a key, so a test can find the
// production extension by its ID; no other difference).
//   1. popup (Vite + React + Tailwind)
//   2. page-runner.js: the in-page checks (axe-core + @whc/dom-checks), one IIFE file
//   3. manifest.json (src/manifest.ts) and icons
// The test build differs ONLY in the manifest: access to http://127.0.0.1 (Playwright
// cannot click the toolbar icon) and a fixed key so tests know the extension ID.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { buildManifest } from '../src/manifest.ts';
import { makeIcon } from './icons.mjs';

const root = path.resolve(import.meta.dirname, '..');
const test = process.argv.includes('--test');
const keyed = process.argv.includes('--keyed');
const outDir = path.join(root, test ? 'dist-test' : keyed ? 'dist-keyed' : 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

process.env.EXTENSION_OUT_DIR = outDir;
await vite({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });

await esbuild({
  entryPoints: [path.join(root, 'src/page/runner.ts')],
  outfile: path.join(outDir, 'page-runner.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  // Keeps axe-core's license notice (MPL-2.0) in the shipped file.
  legalComments: 'eof',
  logLevel: 'warning',
});

mkdirSync(path.join(outDir, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(path.join(outDir, 'icons', `icon-${size}.png`), makeIcon(size));
}

let testKey;
if (test || keyed) {
  // Chrome derives the extension ID from this public key: first 16 bytes of its
  // SHA-256, written with the letters a-p.
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  testKey = der.toString('base64');
  const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
  writeFileSync(path.join(outDir, 'extension-id.txt'), id);
}
const manifest = buildManifest({
  version,
  ...(test ? { testHostPermissions: ['http://127.0.0.1/*'] } : {}),
  ...(testKey ? { testKey } : {}),
});
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `extension ${test ? '(TEST build) ' : keyed ? '(production + test key) ' : ''}written to ${path.relative(process.cwd(), outDir)}`,
);
