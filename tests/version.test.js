import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('version is the same in every manifest', () => {
  const manifest = JSON.parse(read('manifest.json')).version;
  const npm = JSON.parse(read('package.json')).version;
  const cargo = read('helper/Cargo.toml').match(/^version = "([^"]+)"/m)[1];
  const lock = read('helper/Cargo.lock').match(/name = "titl"\nversion = "([^"]+)"/)[1];
  const changelog = read('CHANGELOG.md').match(/^## \[([^\]]+)\]/m)[1];
  assert.deepEqual({ npm, cargo, lock, changelog }, { npm: manifest, cargo: manifest, lock: manifest, changelog: manifest });
});
