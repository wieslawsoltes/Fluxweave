import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(root, '_site');
const manifest = JSON.parse(await readFile(resolve(root, 'MANIFEST.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
    const file = resolve(root, name);
    const rel = relative(root, file);
    if (isAbsolute(name) || rel === '..' || rel.startsWith('../')) throw new Error(`Unsafe manifest path: ${name}`);
    const actual = createHash('sha256').update(await readFile(file)).digest('hex');
    if (actual !== expected) throw new Error(`Source integrity mismatch: ${name}`);
}
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const path of ['index.html', 'style.css', 'icon.svg', 'src', 'examples', 'LICENSE', '.nojekyll']) {
    await cp(resolve(root, path), resolve(site, path), { recursive: true });
}
let commit = process.env.SOURCE_COMMIT || 'local';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
await writeFile(resolve(site, 'version.json'), JSON.stringify({ application: 'Fluxweave', version: manifest.version, commit }, null, 2) + '\n');
console.log(`Verified ${Object.keys(manifest.files).length} source files and packaged Fluxweave (${commit}).`);
