// 防止再次写出带 BOM 的 JSON/JS：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会加 BOM，
// 而 DSH 的 bundle 加载器用 JSON.parse 读 package.json，BOM 会让插件被判定为 "missing"
// 并静默丢弃（2026-11-25 真实事故：插件消失、宿主连不上、只剩旧桥在跑）。
// 运行：node scripts/check-encoding.cjs [repoRoot]
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const skipDirs = new Set(['node_modules', '.git', 'dist', 'test-results']);
const exts = /\.(json|js|mjs|cjs|md|yml|yaml|ps1|ts|tsx)$/;
const bad = [];

function walk(dir, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) walk(full, depth - 1);
      continue;
    }
    if (!exts.test(entry.name)) continue;
    const buf = fs.readFileSync(full);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bad.push(path.relative(root, full));
    }
  }
}

walk(root, 4);

if (bad.length) {
  console.error('BOM found (DSH bundle loading would fail):');
  for (const file of bad) console.error('  ' + file);
  process.exit(1);
}
console.log('encoding check: ok (no BOM)');
