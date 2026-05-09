const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '..', 'frontend', 'node_modules', 'playwright'));
const dir = path.resolve(__dirname, '..', 'frontend', 'src', 'assets', 'images', 'nameplates');
const files = fs.readdirSync(dir).filter((file) => file.endsWith('.png')).sort();
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1160, height: 920 }, deviceScaleFactor: 1 });
  const cards = files.map((file) => `<div class="card"><img src="${dataUrl(file)}"/><span>${file.replace('.png','')}</span></div>`).join('');
  await page.setContent(`<html><head><style>body{margin:0;background:#10130f;color:#ddd;font-family:Arial;padding:24px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.card{display:grid;gap:6px;padding:10px;border:1px solid #3f3823;border-radius:12px;background:#070907}.card img{width:100%;height:auto}.card span{font-size:12px;color:#d7b46a;text-transform:uppercase;letter-spacing:.08em}</style></head><body><div class="grid">${cards}</div></body></html>`);
  await page.screenshot({ path: path.resolve(__dirname, 'nameplates-contact-sheet.png'), fullPage: true });
  await browser.close();
})();
