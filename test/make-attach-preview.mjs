import fs from "node:fs";
import path from "node:path";

// 基于 make-preview 生成的预览页，追加一段「自动粘贴两张图」的脚本，
// 供 headless 截图使用（无扩展上下文、无遮挡暂停渲染）。
const root = path.resolve(process.argv[2] || ".");
const src = path.join(root, "test", "sidepanel-preview.html");
const outFile = path.join(root, "test", "sidepanel-preview-attach.html");

const AUTO = `
<script>
(function () {
  function makeShot(label, from, to) {
    const c = document.createElement('canvas'); c.width = 160; c.height = 100;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 160, 100);
    grad.addColorStop(0, from); grad.addColorStop(1, to);
    g.fillStyle = grad; g.fillRect(0, 0, 160, 100);
    g.fillStyle = 'rgba(255,255,255,.94)'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.fillText(label, 80, 62);
    const bin = atob(c.toDataURL('image/png').split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], label + '.png', { type: 'image/png' });
  }
  setTimeout(function () {
    const dt = new DataTransfer();
    dt.items.add(makeShot('截图一', '#4d6bfe', '#8b5cf6'));
    dt.items.add(makeShot('截图二', '#16a34a', '#0ea5e9'));
    dt.items.add(makeShot('图表', '#f59e0b', '#ef4444'));
    document.getElementById('input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    document.getElementById('input').value = '这两张截图帮我看看';
  }, 600);
})();
</script>
`;

const html = fs.readFileSync(src, "utf8").replace("</body>", AUTO + "</body>");
fs.writeFileSync(outFile, html);
console.log(JSON.stringify({ outFile, bytes: html.length }, null, 1));
