// Copies static files next to the compiled JavaScript to form a deployable site in dist/.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'js'))) {
  console.error('dist/js missing — run tsc first');
  process.exit(1);
}
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'index.html'), join(dist, 'index.html'));
for (const entry of ['styles.css', 'fonts', 'vendor']) {
  const target = join(dist, entry);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(root, 'public', entry), target, { recursive: true });
}
// GitHub Pages: serve files as-is (no Jekyll processing).
writeFileSync(join(dist, '.nojekyll'), '');
console.log('Static files copied to dist/');
