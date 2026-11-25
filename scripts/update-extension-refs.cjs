// 用 Node 以 UTF-8 安全地更新扩展静态资源引用与版本号（PowerShell 5.1 的 Get-Content
// 默认按 ANSI 解码 UTF-8，会写坏中文；本项目一律用这个脚本改这两个文件）。
// 用法：node scripts/update-extension-refs.cjs <version> [assetVersion]
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = process.argv[2];
const asset = process.argv[3] || version;
if (!version) {
  console.error('usage: node scripts/update-extension-refs.cjs <manifestVersion> [assetVersion]');
  process.exit(2);
}

const manifestPath = path.join(root, 'extension', 'manifest.json');
const manifest = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
const nextManifest = manifest.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
fs.writeFileSync(manifestPath, nextManifest, 'utf8');

const htmlPath = path.join(root, 'extension', 'sidepanel.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const nextHtml = html.replace(/sidepanel-[\d.]+\.(css|js)/g, `sidepanel-${asset}.$1`);
fs.writeFileSync(htmlPath, nextHtml, 'utf8');

console.log(JSON.stringify({
  manifestVersion: JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version,
  refs: [...nextHtml.matchAll(/sidepanel-[\d.]+\.(?:css|js)/g)].map((m) => m[0]),
  chineseIntact: /浏览器|扩展/.test(nextManifest) && /侧边栏|设置/.test(nextHtml),
}, null, 2));
