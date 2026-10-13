import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public/decision');
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'asset-manifest.json'), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
for (const asset of manifest.files) {
  const dest = path.join(dir, asset.path);
  let valid = false;
  try { const bytes = await fs.readFile(dest); valid = bytes.length === asset.bytes && sha(bytes) === asset.sha256; } catch {}
  if (valid) { console.log('Verified', asset.path); continue; }
  const url = asset.path.endsWith('.litertlm') ? manifest.model.url :
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-decision@1.1.0/${asset.path.replace(/^assets\//, '')}`;
  console.log('Downloading pinned public asset', url);
  const response = await fetch(url);
  if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw Error(`Integrity mismatch: ${asset.path}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
}
