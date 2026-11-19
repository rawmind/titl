import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
delete manifest.key;

const stage = mkdtempSync(join(tmpdir(), 'titl-'));
try {
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const path of ['src', 'icons', 'LICENSE']) cpSync(join(root, path), join(stage, path), { recursive: true });
  rmSync(join(stage, 'icons/icon.svg'));
  rmSync(join(stage, 'icons/icon-small.svg'));

  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const zip = join(dist, `titl-${manifest.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qrX', zip, '.', '-x', '.*'], { cwd: stage });
  console.log(zip);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
