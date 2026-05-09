const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '..', 'frontend', 'node_modules', 'playwright'));

const outDir = path.resolve(__dirname, '..', 'frontend', 'src', 'assets', 'images', 'nameplates');
fs.mkdirSync(outDir, { recursive: true });

const plates = [
  { id: 'obsidian-crown', a: '#050405', b: '#2b2115', c: '#f4c96c', d: '#7a5420', accent: '#ffe7a3', shape: 'crown', deco: 'crown' },
  { id: 'astral-veil', a: '#071323', b: '#153f62', c: '#b8f2ff', d: '#4b87c7', accent: '#ffffff', shape: 'ribbon', deco: 'star' },
  { id: 'ember-forge', a: '#180503', b: '#5b1608', c: '#ff8a2d', d: '#f5c05d', accent: '#ffe1a0', shape: 'blade', deco: 'flame' },
  { id: 'jade-serpent', a: '#04150e', b: '#0b4d35', c: '#71ffb5', d: '#c7b15a', accent: '#e8ffd8', shape: 'serpent', deco: 'scale' },
  { id: 'frost-runeblade', a: '#07131c', b: '#164463', c: '#d7f9ff', d: '#74bfe7', accent: '#ffffff', shape: 'crystal', deco: 'rune' },
  { id: 'sanguine-royal', a: '#120408', b: '#4f0719', c: '#ff4f73', d: '#e2b15f', accent: '#ffd7df', shape: 'crest', deco: 'gem' },
  { id: 'storm-vault', a: '#050919', b: '#12378f', c: '#67ccff', d: '#d8eaff', accent: '#ffffff', shape: 'vault', deco: 'lightning' },
  { id: 'solar-edict', a: '#201608', b: '#7f4d10', c: '#fff0a8', d: '#e3a838', accent: '#ffffff', shape: 'sun', deco: 'sun' },
  { id: 'void-amethyst', a: '#08040e', b: '#32145c', c: '#c18cff', d: '#6541d9', accent: '#f1dcff', shape: 'void', deco: 'orb' },
  { id: 'iron-warden', a: '#0d1012', b: '#33383e', c: '#c7d0d8', d: '#777f88', accent: '#f4f7fb', shape: 'armor', deco: 'rivets' },
  { id: 'oceanic-oracle', a: '#031317', b: '#07505d', c: '#60f3e8', d: '#2995b9', accent: '#d7fffb', shape: 'wave', deco: 'pearl' },
  { id: 'gilded-thorn', a: '#071106', b: '#384912', c: '#e7c85b', d: '#6ee08a', accent: '#fff1b5', shape: 'thorn', deco: 'thorn' },
  { id: 'lunar-sentinel', a: '#090d16', b: '#27324a', c: '#e4e9ff', d: '#8c94bf', accent: '#ffffff', shape: 'moon', deco: 'moon' },
  { id: 'crimson-engine', a: '#160606', b: '#591111', c: '#ff674d', d: '#c7954c', accent: '#ffd3bd', shape: 'machine', deco: 'gear' },
  { id: 'arcane-prism', a: '#071019', b: '#272b66', c: '#7ff9ff', d: '#ff8bf3', accent: '#fff8d8', shape: 'prism', deco: 'prism' },
  { id: 'necrosteel-relic', a: '#040807', b: '#15251e', c: '#7dfa94', d: '#4d5f55', accent: '#d7ffe0', shape: 'relic', deco: 'skull' },
  { id: 'sapphire-comet', a: '#050b22', b: '#103f9b', c: '#79adff', d: '#c9d9ff', accent: '#ffffff', shape: 'comet', deco: 'comet' },
  { id: 'radiant-halo', a: '#1c1306', b: '#67430c', c: '#fff4b6', d: '#f1b53d', accent: '#fffdf0', shape: 'halo', deco: 'halo' },
  { id: 'umbral-rose', a: '#0b0509', b: '#3b112a', c: '#ff8dcc', d: '#8b4069', accent: '#ffe0f2', shape: 'rose', deco: 'rose' },
  { id: 'chronomancer', a: '#120d08', b: '#4c341b', c: '#f0c979', d: '#6bbbd6', accent: '#fff2c9', shape: 'clock', deco: 'clock' },
];

const shapes = {
  crown: 'M42 82 L78 42 L254 42 L272 24 L320 42 L368 24 L386 42 L562 42 L598 82 L562 120 L78 120 Z',
  ribbon: 'M52 80 L92 38 L548 38 L588 80 L548 122 L92 122 Z',
  blade: 'M34 80 L108 34 L534 34 L612 80 L534 126 L108 126 Z',
  serpent: 'M56 80 C82 32 168 44 214 48 L512 48 C560 48 596 58 604 80 C596 102 560 112 512 112 L214 112 C168 116 82 128 56 80 Z',
  crystal: 'M78 32 L562 32 L614 80 L562 128 L78 128 L26 80 Z',
  crest: 'M56 80 L96 36 L544 36 L584 80 L544 124 L96 124 Z',
  vault: 'M66 44 Q320 18 574 44 L604 80 L574 116 Q320 142 66 116 L36 80 Z',
  sun: 'M64 80 L104 34 L536 34 L576 80 L536 126 L104 126 Z',
  void: 'M70 38 L570 38 L606 80 L570 122 L70 122 L34 80 Z',
  armor: 'M48 80 L88 36 L552 36 L592 80 L552 124 L88 124 Z',
  wave: 'M58 86 C112 24 242 48 320 45 C398 42 526 24 582 86 L548 121 C428 103 222 141 92 121 Z',
  thorn: 'M46 80 L91 38 L549 38 L594 80 L549 122 L91 122 Z',
  moon: 'M64 80 L102 42 L538 42 L576 80 L538 118 L102 118 Z',
  machine: 'M42 80 L84 40 H556 L598 80 L556 120 H84 Z',
  prism: 'M76 35 H564 L606 80 L564 125 H76 L34 80 Z',
  relic: 'M70 44 H570 L604 80 L570 116 H70 L36 80 Z',
  comet: 'M46 80 C100 34 203 42 310 42 H548 L606 80 L548 118 H310 C203 118 100 126 46 80 Z',
  halo: 'M58 80 L96 36 H544 L582 80 L544 124 H96 Z',
  rose: 'M62 80 L98 40 H542 L578 80 L542 120 H98 Z',
  clock: 'M50 80 L94 38 H546 L590 80 L546 122 H94 Z',
};

function decoration(p) {
  const common = `<line x1="132" y1="80" x2="508" y2="80" stroke="url(#edge)" stroke-width="2" opacity=".75"/><circle cx="320" cy="80" r="6" fill="${p.accent}" opacity=".92" filter="url(#glow)"/>`;
  const map = {
    crown: `<path d="M286 50 L304 30 L320 50 L336 30 L354 50" fill="none" stroke="${p.c}" stroke-width="4" stroke-linecap="round"/><path d="M104 58 H250 M390 58 H536" stroke="${p.d}" stroke-width="3" opacity=".8"/>`,
    star: `<path d="M320 46 L330 72 L358 80 L330 88 L320 114 L310 88 L282 80 L310 72 Z" fill="${p.c}" opacity=".55" filter="url(#glow)"/><path d="M116 54 C190 28 232 58 290 52 M350 108 C414 132 464 100 526 106" stroke="${p.accent}" stroke-width="2" fill="none" opacity=".7"/>`,
    flame: `<path d="M310 105 C284 78 318 66 309 44 C346 66 370 83 330 112 Z" fill="${p.c}" opacity=".52" filter="url(#glow)"/><path d="M102 80 H245 M395 80 H538" stroke="${p.c}" stroke-width="4" opacity=".75"/>`,
    scale: `<g opacity=".38">${Array.from({length:10},(_,i)=>`<path d="M${155+i*34} 54 q17 18 34 0" fill="none" stroke="${i%2?p.c:p.d}" stroke-width="2"/>`).join('')}</g><path d="M116 80 C170 56 208 60 256 80 C208 100 170 104 116 80 Z" fill="${p.d}" opacity=".42"/>`,
    rune: `<g stroke="${p.c}" stroke-width="3" opacity=".76">${[170,230,410,470].map(x=>`<path d="M${x} 58 v44 M${x-10} 70 l20 -12 M${x-8} 90 l16 12"/>`).join('')}</g>`,
    gem: `<polygon points="320,42 350,80 320,118 290,80" fill="${p.c}" opacity=".58" filter="url(#glow)"/><circle cx="116" cy="80" r="8" fill="${p.d}"/><circle cx="524" cy="80" r="8" fill="${p.d}"/>`,
    lightning: `<path d="M274 42 L238 86 H284 L256 120 L364 66 H318 L350 42 Z" fill="${p.c}" opacity=".48" filter="url(#glow)"/><path d="M112 106 L204 54 M436 106 L528 54" stroke="${p.accent}" stroke-width="2" opacity=".65"/>`,
    sun: `<circle cx="320" cy="80" r="30" fill="${p.c}" opacity=".35" filter="url(#glow)"/><g stroke="${p.accent}" stroke-width="3" opacity=".62">${Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return `<line x1="${320+Math.cos(a)*42}" y1="${80+Math.sin(a)*18}" x2="${320+Math.cos(a)*64}" y2="${80+Math.sin(a)*28}"/>`}).join('')}</g>`,
    orb: `<ellipse cx="320" cy="80" rx="42" ry="24" fill="${p.c}" opacity=".28" filter="url(#glow)"/><path d="M138 56 C240 26 410 134 506 54" stroke="${p.c}" stroke-width="2" fill="none" opacity=".65"/>`,
    rivets: `<g fill="${p.c}" opacity=".75">${[104,150,490,536].map(x=>`<circle cx="${x}" cy="80" r="7"/>`).join('')}</g><path d="M286 48 H354 V112 H286 Z" fill="none" stroke="${p.d}" stroke-width="3" opacity=".55"/>`,
    pearl: `<circle cx="320" cy="80" r="18" fill="${p.accent}" opacity=".66" filter="url(#glow)"/><path d="M96 92 C180 48 236 112 320 80 C404 48 460 112 544 68" stroke="${p.c}" stroke-width="3" fill="none" opacity=".72"/>`,
    thorn: `<path d="M96 92 C180 42 218 118 304 68 C398 18 438 124 548 60" stroke="${p.d}" stroke-width="4" fill="none" opacity=".68"/><g fill="${p.c}" opacity=".6"><path d="M220 68 l24 -32 l-4 40 Z"/><path d="M424 92 l-24 32 l4 -40 Z"/></g>`,
    moon: `<path d="M336 48 C300 60 300 104 336 116 C286 112 266 92 266 80 C266 68 286 48 336 48 Z" fill="${p.c}" opacity=".48" filter="url(#glow)"/><circle cx="130" cy="62" r="3" fill="${p.accent}"/><circle cx="510" cy="98" r="3" fill="${p.accent}"/>`,
    gear: `<g transform="translate(320 80)" fill="none" stroke="${p.c}" stroke-width="4" opacity=".65"><circle r="24"/><circle r="10"/>${Array.from({length:8},(_,i)=>`<line x1="0" y1="-36" x2="0" y2="-26" transform="rotate(${i*45})"/>`).join('')}</g>`,
    prism: `<polygon points="320,38 370,80 320,122 270,80" fill="${p.c}" opacity=".22"/><path d="M270 80 H370 M320 38 V122" stroke="${p.accent}" stroke-width="2" opacity=".75"/><path d="M105 105 C170 50 215 106 280 52 M360 108 C425 52 470 110 535 56" stroke="${p.d}" stroke-width="3" fill="none" opacity=".7"/>`,
    skull: `<path d="M304 72 C304 48 336 48 336 72 V94 C336 108 304 108 304 94 Z" fill="${p.c}" opacity=".35" filter="url(#glow)"/><circle cx="314" cy="78" r="4" fill="${p.a}"/><circle cx="326" cy="78" r="4" fill="${p.a}"/>`,
    comet: `<path d="M180 100 C250 20 392 50 472 62 C378 72 260 90 180 100 Z" fill="${p.c}" opacity=".30" filter="url(#glow)"/><circle cx="464" cy="62" r="16" fill="${p.accent}" opacity=".75"/>`,
    halo: `<ellipse cx="320" cy="80" rx="74" ry="28" fill="none" stroke="${p.c}" stroke-width="6" opacity=".52" filter="url(#glow)"/><path d="M130 80 H244 M396 80 H510" stroke="${p.accent}" stroke-width="2" opacity=".82"/>`,
    rose: `<path d="M320 54 C350 54 350 106 320 106 C290 106 290 54 320 54 Z" fill="${p.c}" opacity=".33" filter="url(#glow)"/><path d="M320 80 C292 50 250 60 236 96 M320 80 C348 50 390 60 404 96" stroke="${p.d}" stroke-width="3" fill="none" opacity=".7"/>`,
    clock: `<circle cx="320" cy="80" r="30" fill="none" stroke="${p.c}" stroke-width="4" opacity=".55"/><path d="M320 80 L320 60 M320 80 L340 90" stroke="${p.accent}" stroke-width="3"/><g stroke="${p.d}" stroke-width="2" opacity=".7">${[0,30,60,90,120,150].map(a=>`<line x1="102" y1="80" x2="170" y2="80" transform="rotate(${a} 320 80)"/>`).join('')}</g>`,
    scale: '',
  };
  return common + (map[p.deco] || '');
}

function svg(p) {
  const shape = shapes[p.shape] || shapes.ribbon;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160">
  <defs>
    <linearGradient id="body" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${p.b}"/><stop offset=".48" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient>
    <linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="transparent"/><stop offset=".18" stop-color="${p.d}"/><stop offset=".5" stop-color="${p.c}"/><stop offset=".82" stop-color="${p.d}"/><stop offset="1" stop-color="transparent"/></linearGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="${p.c}" stop-opacity=".35"/><stop offset=".52" stop-color="${p.d}" stop-opacity=".16"/><stop offset="1" stop-color="${p.a}" stop-opacity="0"/></radialGradient>
    <filter id="shadow" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".55"/><feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${p.c}" flood-opacity=".38"/></filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="clip"><path d="${shape}"/></clipPath>
  </defs>
  <path d="${shape}" fill="url(#body)" stroke="${p.c}" stroke-width="2.6" filter="url(#shadow)"/>
  <g clip-path="url(#clip)">
    <rect x="34" y="28" width="572" height="104" fill="url(#core)"/>
    <path d="M72 50 C160 16 226 62 320 44 C414 26 492 20 568 54" stroke="#fff" stroke-width="2" opacity=".16" fill="none"/>
    <path d="M72 112 C170 136 250 102 320 118 C390 134 480 124 568 102" stroke="#000" stroke-width="4" opacity=".28" fill="none"/>
    ${decoration(p)}
    <rect x="60" y="44" width="520" height="72" fill="none" stroke="url(#edge)" stroke-width="1.4" opacity=".72"/>
    <rect x="82" y="61" width="476" height="38" fill="#000" opacity=".16"/>
    <path d="M92 50 H548 M92 110 H548" stroke="url(#edge)" stroke-width="2" opacity=".78"/>
  </g>
  <path d="${shape}" fill="none" stroke="#fff" stroke-width="1" opacity=".18"/>
</svg>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 160 }, deviceScaleFactor: 1 });
  for (const plate of plates) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(plate)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(outDir, `${plate.id}.png`), omitBackground: true });
  }
  await browser.close();
  console.log(`Generated ${plates.length} nameplates in ${outDir}`);
})();
