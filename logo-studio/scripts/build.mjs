// Gera dist/public com JS/CSS minificados, sem comentários e sem source maps.
// Em produção o servidor serve apenas dist/public; o código do servidor nunca é exposto.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'dist/public');

await fs.rm(path.join(root, 'dist'), { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

const js = await esbuild.build({
  entryPoints: [path.join(src, 'app.js')],
  bundle: false,
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  target: ['es2020'],
  write: false,
});
const jsCode = js.outputFiles[0].contents;
const jsName = `app.${hash(jsCode)}.js`;
await fs.writeFile(path.join(out, jsName), jsCode);

const css = await esbuild.build({
  entryPoints: [path.join(src, 'styles.css')],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  write: false,
});
const cssCode = css.outputFiles[0].contents;
const cssName = `styles.${hash(cssCode)}.css`;
await fs.writeFile(path.join(out, cssName), cssCode);

let html = await fs.readFile(path.join(src, 'index.html'), 'utf8');
html = html
  .replace('href="styles.css"', `href="${cssName}"`)
  .replace('src="app.js"', `src="${jsName}"`)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .replace(/\s{2,}/g, ' ')
  .trim();
await fs.writeFile(path.join(out, 'index.html'), html);

for (const file of await fs.readdir(src)) {
  if (!['index.html', 'app.js', 'styles.css'].includes(file)) {
    await fs.cp(path.join(src, file), path.join(out, file), { recursive: true });
  }
}

console.log(`build ok -> dist/public (${jsName}, ${cssName})`);
