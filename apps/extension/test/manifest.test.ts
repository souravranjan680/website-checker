/**
 * The production extension must ask for nothing more than activeTab, scripting and
 * storage, and must not run anything on its own. Checks the BUILT manifest
 * (dist/manifest.json, built by "pretest"), not just the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, PRODUCTION_PERMISSIONS } from '../src/manifest';

const root = path.resolve(import.meta.dirname, '..');
const read = (dir: string) =>
  JSON.parse(readFileSync(path.join(root, dir, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;

describe('production manifest (dist/manifest.json)', () => {
  const manifest = read('dist');

  it('is Manifest V3 with exactly activeTab, scripting and storage', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect([...PRODUCTION_PERMISSIONS]).toEqual(['activeTab', 'scripting', 'storage']);
  });

  it('has no host access, nothing that runs on its own and nothing reachable from websites', () => {
    for (const key of [
      'host_permissions',
      'optional_permissions',
      'optional_host_permissions',
      'content_scripts',
      'background',
      'web_accessible_resources',
      'externally_connectable',
      'content_security_policy', // the strict MV3 default applies
      'key',
    ]) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });

  it('opens the popup from the toolbar button', () => {
    expect(manifest.action).toMatchObject({ default_popup: 'popup.html' });
  });

  it('ships no inline scripts in the popup (extension CSP)', () => {
    const html = readFileSync(path.join(root, 'dist', 'popup.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});

describe('test manifest (dist-test/manifest.json)', () => {
  it('differs from production only by local test host access and a fixed key', () => {
    const { host_permissions, key, ...rest } = read('dist-test');
    expect(host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(typeof key).toBe('string');
    expect(rest).toEqual(read('dist'));
  });

  it('the keyed build used to find the production extension differs only by its key', () => {
    const { key, ...rest } = read('dist-keyed');
    expect(typeof key).toBe('string');
    expect(rest).toEqual(read('dist'));
  });

  it('is only produced on request', () => {
    expect(buildManifest({ version: '1.0.0' })).not.toHaveProperty('host_permissions');
  });
});
