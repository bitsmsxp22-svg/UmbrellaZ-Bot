// Remove de node_modules tudo o que o servidor compilado (dist/) não usa em tempo de execução.
// Uso: node scripts/podar-dependencias.cjs <pasta-do-pacote> <arquivo-com-os-pacotes-raiz>
const fs = require('fs'); const path = require('path');
const [root, rootsFile] = process.argv.slice(2);
const nm = path.join(root, 'node_modules');
const keep = new Set();
function resolvePkg(name, fromDir) {
  let dir = fromDir;
  while (true) {
    const p = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(p)) return path.dirname(p);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function visit(name, fromDir) {
  const dir = resolvePkg(name, fromDir);
  if (!dir || keep.has(dir)) return;
  keep.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) visit(dep, dir);
}
for (const r of fs.readFileSync(rootsFile, 'utf8').split('\n').filter(Boolean)) visit(r, root);
// Pacotes de topo (e escopos) que não estão no conjunto são removidos.
let removed = 0;
for (const entry of fs.readdirSync(nm)) {
  if (entry.startsWith('.')) continue;
  const full = path.join(nm, entry);
  if (entry.startsWith('@')) {
    for (const sub of fs.readdirSync(full)) {
      const d = path.join(full, sub);
      if (![...keep].some((k) => k === d || k.startsWith(d + path.sep))) { fs.rmSync(d, { recursive: true, force: true }); removed++; }
    }
    if (fs.readdirSync(full).length === 0) fs.rmSync(full, { recursive: true });
  } else if (![...keep].some((k) => k === full || k.startsWith(full + path.sep))) { fs.rmSync(full, { recursive: true, force: true }); removed++; }
}
console.log(`mantidos: ${keep.size} pacotes | removidos: ${removed}`);
