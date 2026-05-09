const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '..', 'frontend', 'node_modules', 'playwright'));
const css = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'app', 'shared', 'ui', 'player-name', 'player-name.component.scss'), 'utf8');
const dir = path.resolve(__dirname, '..', 'frontend', 'src', 'assets', 'images', 'nameplates');
const ids = ['obsidian-crown','astral-veil','ember-forge','jade-serpent','frost-runeblade','sanguine-royal','storm-vault','solar-edict','void-amethyst','iron-warden','oceanic-oracle','gilded-thorn','lunar-sentinel','crimson-engine','arcane-prism','necrosteel-relic','sapphire-comet','radiant-halo','umbral-rose','chronomancer'];
const img = (id) => `data:image/png;base64,${fs.readFileSync(path.join(dir, `${id}.png`)).toString('base64')}`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 760 }, deviceScaleFactor: 1 });
  const cards = ids.map((id, i) => `<div class="card"><span class="player-name-shell nameplate-${id} e${i + 1} size-md premium" style="--name-text-color:#fff0c2"><img class="nameplate-image" src="${img(id)}"><span class="player-name-label">Finetti</span></span></div>`).join('');
  await page.setContent(`<html><head><style>${css}body{margin:0;background:#11150f;padding:24px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{display:grid;place-items:center;min-height:68px;border:1px solid #3d3420;border-radius:12px;background:#050705}</style></head><body><div class="grid">${cards}</div></body></html>`);
  await page.screenshot({ path: path.resolve(__dirname, 'nameplates-sized-preview.png'), fullPage: true });
  await browser.close();
})();
