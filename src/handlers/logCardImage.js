'use strict';

// ───────────────────────────────────────────────────────────
// Moteur de cartes pour les logs. 4 styles au choix (/cartes-style → « Style des logs ») :
//   neon (historique, même look que level up / vocal), sobre, clair, compact.
//
// await generateLogCardAsync({            // recommandé : télécharge les emojis avant de dessiner
//   guildId, theme, title, time, sub,
//   blocks:  [{ label, value, dot?, accent? }],   // infos (pile à gauche si bigValue, sinon grille 2 colonnes)
//   bigLabel, bigValue,                           // gros nombre à droite (optionnel)
//   quotes:  [{ label, text, dim?, maxLines? }],  // zones de texte (contenu d'un message, raison…)
//   pills:   [{ text, tone: 'accent'|'ok'|'bad' }],
//   footerLeft, footerRight
// }) -> Buffer PNG   (la hauteur s'adapte au contenu)
//
// generateLogCard(spec) reste disponible en synchrone (les emojis déjà en cache sont dessinés).
// ───────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx, getTheme } = require('../core/cardTheme');
const glass = require('../core/glassCard');
const {
  tokenize,
  preloadEmojis,
  measureRich,
  drawRich,
  fitSize,
  splitUnits,
  truncateRich
} = require('../core/cardEmoji');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'LogCardBold');
    GlobalFonts.registerFromPath(r, 'LogCardRegular');
    FONT = 'LogCardRegular';
    FONT_BOLD = 'LogCardBold';
  }
} catch { /* police système */ }

const W = 1076;
const PAD = 60;
const BLOCK_H = 84;

// Tailles de texte (px)
const S = {
  title: 22,
  time: 17,
  sub: 21,
  label: 16,
  value: 30,
  bigLabel: 19,
  big: 130,
  quote: 21,
  quoteLine: 29,
  pill: 17,
  footer: 15
};

const THEMES = {
  green: { accent: '#2ecc71', light: '#78eba0', bg: '#050d09', halo: '#0c2a1b', pill: '#0f2a1c', box: '#0f1f15' },
  red: { accent: '#ff4d5e', light: '#ff9aa4', bg: '#0d0507', halo: '#2a0c12', pill: '#2a0f14', box: '#1d0d11' },
  orange: { accent: '#ffb020', light: '#ffd480', bg: '#0d0a05', halo: '#2a1d0c', pill: '#2a1f0f', box: '#1f180d' },
  amber: { accent: '#ff7a45', light: '#ffb08f', bg: '#0d0705', halo: '#2a140c', pill: '#2a160f', box: '#1f120c' },
  violet: { accent: '#a78bfa', light: '#cbbcff', bg: '#0a0712', halo: '#1d1436', pill: '#1d1536', box: '#161026' },
  cyan: { accent: '#22d3ee', light: '#8be8f6', bg: '#050d0f', halo: '#0c2630', pill: '#0f2630', box: '#0d1c22' },
  danger: { accent: '#ff2e4d', light: '#ff8aa0', bg: '#14070a', halo: '#33080f', pill: '#33101a', box: '#240c12' }
};

const TEXT = '#f2f8f4';
const MUTED = '#9bc2aa';
const DIM = '#7ea68c';

// Normalise les espaces (les emojis sont conservés : ils sont dessinés comme des images)
function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function cut(text, n) {
  return truncateRich(text, n);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Retour à la ligne automatique (max `maxLines` lignes, ellipse si trop long)
function wrap(ctx, text, maxW, maxLines, family, size) {
  const m = s => measureRich(ctx, s, family, size);
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  const push = () => { lines.push(line); line = ''; };
  for (let w of words) {
    // mot plus large que la ligne : on le découpe (sans casser un emoji)
    while (m(w) > maxW) {
      const units = splitUnits(w);
      let i = units.length;
      while (i > 1 && m(units.slice(0, i).join('')) > maxW) i--;
      if (line) push();
      lines.push(units.slice(0, i).join(''));
      w = units.slice(i).join('');
      if (!w) break;
    }
    if (!w) continue;
    const test = line ? `${line} ${w}` : w;
    if (m(test) > maxW && line) {
      push();
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const units = splitUnits(kept[maxLines - 1]);
    while (units.length > 1 && m(units.join('') + '…') > maxW) units.pop();
    kept[maxLines - 1] = units.join('') + '…';
    return kept;
  }
  return lines.length ? lines : [''];
}

// "il y a" lisible : 3 jours, 1 mois 12 jours, 2 ans
function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const j = Math.floor(ms / 86400000);
  if (j < 1) {
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min`;
    return `${h} h`;
  }
  if (j < 31) return `${j} jour${j > 1 ? 's' : ''}`;
  if (j < 365) {
    const m = Math.floor(j / 30);
    const r = j - m * 30;
    return `${m} mois` + (r > 0 ? ` ${r} j` : '');
  }
  const a = Math.floor(j / 365);
  return `${a} an${a > 1 ? 's' : ''}`;
}

function drawBlock(ctx, b, x, y, maxW) {
  drawRich(ctx, clean(b.label).toUpperCase(), x, y + 18, FONT_BOLD, S.label, { color: MUTED });
  let tx = x;
  if (b.dot) {
    ctx.fillStyle = b.dot;
    ctx.beginPath();
    ctx.arc(x + 10, y + 50, 9, 0, Math.PI * 2);
    ctx.fill();
    tx = x + 28;
  }
  const value = cut(b.value, 60);
  const size = fitSize(ctx, value, FONT_BOLD, S.value, maxW - (tx - x), 22);
  drawRich(ctx, value, tx, y + 60, FONT_BOLD, size, { color: b.accent ? b.accent : TEXT });
  return y + BLOCK_H;
}

function content(ctx, th, s) {
  ctx.textBaseline = 'alphabetic';

  // Titre, heure, sous-titre
  drawRich(ctx, clean(s.title).toUpperCase(), PAD, 80, FONT_BOLD, S.title, { color: th.light });
  if (s.time) {
    drawRich(ctx, clean(s.time), W - PAD, 80, FONT, S.time, { color: DIM, align: 'right' });
  }
  if (s.sub) {
    const sub = cut(s.sub, 50);
    const size = fitSize(ctx, sub, FONT, S.sub, W - 2 * PAD, 20);
    drawRich(ctx, sub, PAD, 112, FONT, size, { color: MUTED });
  }

  const blocks = s.blocks || [];
  const hasBig = s.bigValue !== undefined && s.bigValue !== null && s.bigValue !== '';
  let y = s.sub ? 148 : 120;

  if (hasBig) {
    for (const b of blocks) y = drawBlock(ctx, b, PAD, y, 580);
    // Gros nombre à droite
    const nx = W - 230;
    drawRich(ctx, clean(s.bigLabel || '').toUpperCase(), nx, 150, FONT_BOLD, S.bigLabel, { color: MUTED, align: 'center' });
    ctx.shadowColor = th.accent;
    ctx.shadowBlur = 40;
    const big = String(s.bigValue);
    const bigSize = fitSize(ctx, big, FONT_BOLD, S.big, 340, 40);
    drawRich(ctx, big, nx, 150 + 14 + bigSize * 0.9, FONT_BOLD, bigSize, { color: th.accent, align: 'center' });
    ctx.shadowBlur = 0;
    y = Math.max(y, 150 + 30 + S.big);
  } else if (blocks.length) {
    const colW = (W - 2 * PAD) / 2;
    blocks.forEach((b, i) => {
      drawBlock(ctx, b, PAD + (i % 2) * colW, y + Math.floor(i / 2) * BLOCK_H, colW - 24);
    });
    y += Math.ceil(blocks.length / 2) * BLOCK_H;
  }

  // Zones de texte (contenu, avant/après, raison…)
  const boxW = W - 2 * PAD;
  for (const q of s.quotes || []) {
    y += 4;
    drawRich(ctx, clean(q.label).toUpperCase(), PAD, y + 18, FONT_BOLD, S.label, { color: MUTED });
    const lines = wrap(ctx, q.text || '—', boxW - 44, q.maxLines || 4, FONT, S.quote);
    const bh = lines.length * S.quoteLine + 20;
    const by = y + 28;
    roundRect(ctx, PAD, by, boxW, bh, 12);
    ctx.fillStyle = th.box;
    ctx.fill();
    ctx.fillStyle = q.dim ? DIM : th.accent;
    ctx.fillRect(PAD, by + 8, 5, bh - 16);
    lines.forEach((l, i) => {
      drawRich(ctx, l, PAD + 22, by + 29 + i * S.quoteLine, FONT, S.quote, { color: q.dim ? '#a3bfae' : TEXT });
    });
    y = by + bh + 14;
  }

  // Pastilles
  if (s.pills && s.pills.length) {
    y += 6;
    let x = PAD;
    for (const p of s.pills) {
      const col = p.tone === 'ok' ? '#2ecc71' : p.tone === 'bad' ? '#ff4d5e' : th.accent;
      const txt = cut(p.text, 30);
      const w = measureRich(ctx, txt, FONT_BOLD, S.pill) + 34;
      if (x + w > W - PAD && x > PAD) { x = PAD; y += 46; }
      roundRect(ctx, x, y, w, 36, 18);
      ctx.fillStyle = th.pill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col;
      ctx.stroke();
      drawRich(ctx, txt, x + 17, y + 25, FONT_BOLD, S.pill, { color: col });
      x += w + 12;
    }
    y += 50;
  }
  return y;
}

function footer(ctx, s, H) {
  const baseline = H - 42;
  let rightW = 0;
  if (s.footerRight) {
    const t = cut(s.footerRight, 40);
    const size = fitSize(ctx, t, FONT, S.footer, 380, 16);
    rightW = drawRich(ctx, t, W - PAD, baseline, FONT, size, { color: DIM, align: 'right' });
  }
  if (s.footerLeft) {
    const t = cut(s.footerLeft, 60);
    const maxW = W - 2 * PAD - rightW - 30;
    const size = fitSize(ctx, t, FONT, S.footer, maxW, 14);
    drawRich(ctx, t, PAD, baseline, FONT, size, { color: DIM });
  }
}

function generateNeonCard(spec) {
  const th = THEMES[spec.theme] || THEMES.green;

  // Passe 1 : mesure de la hauteur nécessaire
  const probe = createCanvas(W, 3000);
  const yEnd = content(probe.getContext('2d'), th, spec);
  const H = Math.max(280, Math.ceil(yEnd + 72));

  // Passe 2 : rendu final
  const canvas = createCanvas(W, H);
  // Seule la carte verte suit le thème de couleur du serveur
  const ctx = spec.theme === 'green' ? themedCtx(canvas.getContext('2d'), spec.guildId) : canvas.getContext('2d');

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700);
  bg.addColorStop(0, th.halo);
  bg.addColorStop(1, th.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.shadowColor = th.accent;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 4;
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.stroke();
  ctx.shadowBlur = 0;

  content(ctx, th, spec);
  footer(ctx, spec, H);
  return canvas.toBuffer('image/png');
}

// ───────────────────────────────────────────────────────────
// Styles alternatifs : sobre / clair / compact
// Mêmes données (spec) que le style néon, autre mise en page.
// ───────────────────────────────────────────────────────────
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => { const x = hexRgb(a); const y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };

const PAL = {
  sobre: { bg: '#1a1b1e', border: '#2e3035', text: '#f2f3f5', muted: '#8b8d93', dim: '#6d6f76', box: '#232428', line: '#2e3035', ring: '#5a5c63', dark: true },
  clair: { bg: '#eef1f4', border: '#d5dbe2', text: '#1b2430', muted: '#76808c', dim: '#8a94a0', box: '#ffffff', line: '#d5dbe2', ring: '#b8c1cc', dark: false },
  fume: { bg: 'transparent', border: 'rgba(255,255,255,0.3)', text: '#ffffff', muted: 'rgba(255,255,255,0.65)', dim: 'rgba(255,255,255,0.5)', box: 'rgba(0,0,0,0.28)', line: 'rgba(255,255,255,0.16)', ring: 'rgba(255,255,255,0.45)', dark: true },
  compact: { bg: '#111214', border: '#26282c', text: '#f2f3f5', muted: '#8b8d93', dim: '#6d6f76', box: '#1a1b1e', line: '#26282c', ring: '#5a5c63', dark: true }
};

function drawBlockStyled(ctx, pal, b, x, y, maxW) {
  drawRich(ctx, clean(b.label), x, y + 18, FONT, S.label, { color: pal.muted });
  let tx = x;
  if (b.dot) {
    ctx.fillStyle = b.dot;
    ctx.beginPath();
    ctx.arc(x + 10, y + 50, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.ring;
    ctx.stroke();
    tx = x + 28;
  }
  const value = cut(b.value, 60);
  const size = fitSize(ctx, value, FONT_BOLD, S.value, maxW - (tx - x), 22);
  drawRich(ctx, value, tx, y + 60, FONT_BOLD, size, { color: b.accent ? b.accent : pal.text });
  return y + BLOCK_H;
}

// zones de texte + pastilles (communes aux 3 styles)
function drawQuotesPills(ctx, th, pal, ink, s, px, y, inner, rightEdge = W - px) {
  for (const q of s.quotes || []) {
    y += 4;
    drawRich(ctx, clean(q.label), px, y + 18, FONT, S.label, { color: pal.muted });
    const lines = wrap(ctx, q.text || '—', inner - 44, q.maxLines || 4, FONT, S.quote);
    const bh = lines.length * S.quoteLine + 20;
    const by = y + 28;
    roundRect(ctx, px, by, inner, bh, 12);
    ctx.fillStyle = pal.box;
    ctx.fill();
    ctx.fillStyle = q.dim ? pal.dim : ink;
    ctx.fillRect(px, by + 8, 5, bh - 16);
    lines.forEach((l, i) => {
      drawRich(ctx, l, px + 22, by + 29 + i * S.quoteLine, FONT, S.quote, { color: q.dim ? pal.muted : pal.text });
    });
    y = by + bh + 14;
  }

  if (s.pills && s.pills.length) {
    y += 6;
    let x = px;
    for (const p of s.pills) {
      const base = p.tone === 'ok' ? '#2ecc71' : p.tone === 'bad' ? '#ff4d5e' : th.accent;
      const col = pal.dark ? base : mixHex(base, '#000000', 0.35);
      const txt = cut(p.text, 30);
      const w = measureRich(ctx, txt, FONT_BOLD, S.pill) + 34;
      if (x + w > rightEdge && x > px) { x = px; y += 46; }
      roundRect(ctx, x, y, w, 36, 18);
      ctx.fillStyle = pal.dark ? rgba(base, 0.14) : mixHex(base, '#ffffff', 0.88);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col;
      ctx.stroke();
      drawRich(ctx, txt, x + 17, y + 25, FONT_BOLD, S.pill, { color: col });
      x += w + 12;
    }
    y += 50;
  }
  return y;
}

// Styles « sobre » et « clair » : titre, infos en grille, gros nombre optionnel
function contentCard(ctx, th, pal, ink, s, style) {
  ctx.textBaseline = 'alphabetic';
  const px = style === 'sobre' ? 56 : 48;
  const inner = W - 2 * px;
  const title = clean(s.title);
  let y;

  if (style === 'clair') {
    ctx.fillStyle = mixHex(th.accent, '#ffffff', 0.86);
    ctx.fillRect(0, 0, W, 92);
    drawRich(ctx, title, px, 58, FONT_BOLD, 28, { color: ink });
    if (s.time) drawRich(ctx, clean(s.time), W - px, 58, FONT, S.time, { color: mixHex(th.accent, '#000000', 0.25), align: 'right' });
    if (s.sub) {
      const sub = cut(s.sub, 50);
      drawRich(ctx, sub, px, 134, FONT, fitSize(ctx, sub, FONT, S.sub, inner, 20), { color: pal.muted });
    }
    y = s.sub ? 170 : 124;
  } else {
    drawRich(ctx, title, px, 70, FONT_BOLD, 28, { color: pal.text });
    if (s.time) drawRich(ctx, clean(s.time), W - px, 70, FONT, S.time, { color: pal.dim, align: 'right' });
    if (s.sub) {
      const sub = cut(s.sub, 50);
      drawRich(ctx, sub, px, 106, FONT, fitSize(ctx, sub, FONT, S.sub, inner, 20), { color: pal.muted });
    }
    y = s.sub ? 144 : 112;
  }

  const blocks = s.blocks || [];
  const hasBig = s.bigValue !== undefined && s.bigValue !== null && s.bigValue !== '';
  const top = y;

  if (hasBig) {
    for (const b of blocks) y = drawBlockStyled(ctx, pal, b, px, y, 560);
    const nx = W - px - 150;
    drawRich(ctx, clean(s.bigLabel || ''), nx, top + 18, FONT, S.label, { color: pal.muted, align: 'center' });
    const big = String(s.bigValue);
    const bigSize = fitSize(ctx, big, FONT_BOLD, 100, 300, 40);
    const bigY = top + 32 + bigSize * 0.9;
    drawRich(ctx, big, nx, bigY, FONT_BOLD, bigSize, { color: ink, align: 'center' });
    y = Math.max(y, bigY + 16);
  } else if (blocks.length) {
    const colW = inner / 2;
    blocks.forEach((b, i) => {
      drawBlockStyled(ctx, pal, b, px + (i % 2) * colW, y + Math.floor(i / 2) * BLOCK_H, colW - 24);
    });
    y += Math.ceil(blocks.length / 2) * BLOCK_H;
  }

  return drawQuotesPills(ctx, th, pal, ink, s, px, y, inner);
}

// Style « compact » : tuile d'icône + titre + infos sur une ligne qui se replie
function contentCompact(ctx, th, pal, ink, s) {
  ctx.textBaseline = 'alphabetic';
  const X = 28;
  const TILE = 84;
  const X0 = X + TILE + 24;
  const R = W - 32;

  roundRect(ctx, X, X, TILE, TILE, 18);
  ctx.fillStyle = mixHex(th.accent, '#111214', 0.78);
  ctx.fill();

  const toks = tokenize(clean(s.title));
  let rest = clean(s.title);
  if (toks[0] && toks[0].t === 'emoji') {
    drawRich(ctx, toks[0].raw, X + TILE / 2, X + TILE / 2 + 14, FONT_BOLD, 44, { align: 'center' });
    rest = clean(toks.slice(1).map(t => (t.t === 'emoji' ? t.raw : t.v)).join(''));
  }

  const tSize = fitSize(ctx, rest, FONT_BOLD, 28, R - X0 - (s.time ? 100 : 0), 18);
  drawRich(ctx, rest, X0, 62, FONT_BOLD, tSize, { color: pal.text });
  if (s.time) drawRich(ctx, clean(s.time), R, 62, FONT, S.time, { color: pal.dim, align: 'right' });

  let y = 98;
  if (s.sub) {
    const sub = cut(s.sub, 60);
    drawRich(ctx, sub, X0, y, FONT, fitSize(ctx, sub, FONT, 20, R - X0, 17), { color: pal.muted });
    y += 36;
  }

  const items = [...(s.blocks || [])];
  if (s.bigValue !== undefined && s.bigValue !== null && s.bigValue !== '') {
    items.push({ label: s.bigLabel || '', value: String(s.bigValue), accent: ink });
  }
  // Mode « grille » (panneaux de config, classements) : lignes alignées, libellé à gauche / valeur à droite
  if (s.grid) {
    const cols = Math.max(1, s.grid | 0);
    const GAPX = 28, RH = 58, PADI = 18, FS = 24;
    const colW = (W - 2 * X - GAPX * (cols - 1)) / cols;
    const top = X + TILE + 22;
    items.forEach((b, i) => {
      const cx = X + (i % cols) * (colW + GAPX);
      const cy = top + Math.floor(i / cols) * RH;
      const mid = cy + (RH - 8) / 2 + 8;
      roundRect(ctx, cx, cy, colW, RH - 8, 12);
      ctx.fillStyle = pal.box;
      ctx.fill();
      const val = cut(String(b.value ?? ''), s.valueMax || 40);
      const vSize = fitSize(ctx, val, FONT_BOLD, FS, colW * 0.55, 15);
      let rightEdge = cx + colW - PADI;
      const wv = drawRich(ctx, val, rightEdge, mid, FONT_BOLD, vSize, { color: b.accent ? b.accent : pal.text, align: 'right' });
      rightEdge -= wv;
      if (b.dot) {
        ctx.fillStyle = b.dot;
        ctx.beginPath();
        ctx.arc(rightEdge - 18, mid - 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = pal.ring;
        ctx.stroke();
        rightEdge -= 30;
      }
      const lab = clean(b.label);
      const lSize = fitSize(ctx, lab, FONT, FS - 2, rightEdge - (cx + PADI) - 14, 14);
      drawRich(ctx, lab, cx + PADI, mid, FONT, lSize, { color: pal.muted });
    });
    const rows = Math.ceil(items.length / cols);
    y = top + rows * RH - 8 - 10;   // la suite (bottom = y + 10) part sous la dernière ligne
    items.length = 0;                // plus rien à dessiner en ligne
  }

  let x = X0;
  for (const b of items) {
    const lab = clean(b.label);
    const val = cut(b.value, s.valueMax || 40);
    const wl = lab ? measureRich(ctx, `${lab} `, FONT, 19) : 0;
    const dotW = b.dot ? 24 : 0;
    const wv = measureRich(ctx, val, FONT_BOLD, 19);
    if (x + wl + dotW + wv > R && x > X0) { x = X0; y += 34; }
    if (lab) drawRich(ctx, lab, x, y, FONT, 19, { color: pal.muted });
    x += wl;
    if (b.dot) {
      ctx.fillStyle = b.dot;
      ctx.beginPath();
      ctx.arc(x + 9, y - 7, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.ring;
      ctx.stroke();
      x += dotW;
    }
    drawRich(ctx, val, x, y, FONT_BOLD, 19, { color: b.accent ? b.accent : pal.text });
    x += wv + 30;
  }

  // Barre de progression optionnelle (niveau, StarBoard…)
  if (typeof s.progress === 'number') {
    y += 26;
    const bw = R - X0;
    roundRect(ctx, X0, y, bw, 10, 5);
    ctx.fillStyle = pal.line;
    ctx.fill();
    roundRect(ctx, X0, y, Math.max(10, bw * Math.max(0, Math.min(1, s.progress))), 10, 5);
    ctx.fillStyle = ink;
    ctx.fill();
    y += 10;
  }

  const bottom = Math.max(X + TILE, y + 10);
  return drawQuotesPills(ctx, th, pal, ink, s, X, bottom + 6, W - 2 * X);
}

function footerStyled(ctx, pal, s, H, px, compact) {
  const baseline = compact ? H - 22 : H - 32;
  if (!compact) {
    ctx.fillStyle = pal.line;
    ctx.fillRect(px, H - 66, W - 2 * px, 2);
  }
  let rightW = 0;
  if (s.footerRight) {
    const t = cut(s.footerRight, 40);
    const size = fitSize(ctx, t, FONT, S.footer, 380, 16);
    rightW = drawRich(ctx, t, W - px, baseline, FONT, size, { color: pal.dim, align: 'right' });
  }
  if (s.footerLeft) {
    const t = cut(s.footerLeft, 60);
    const maxW = W - 2 * px - rightW - 30;
    const size = fitSize(ctx, t, FONT, S.footer, maxW, 14);
    drawRich(ctx, t, px, baseline, FONT, size, { color: pal.dim });
  }
}

function generateStyledCard(style, spec) {
  const th = THEMES[spec.theme] || THEMES.green;
  const pal = PAL[style];
  const compact = style === 'compact';
  // sur fond clair, l'accent est assombri pour rester lisible
  const ink = pal.dark ? th.accent : mixHex(th.accent, '#000000', 0.4);
  const run = c => (compact ? contentCompact(c, th, pal, ink, spec) : contentCard(c, th, pal, ink, spec, style));
  const px = compact ? 28 : (style === 'sobre' ? 56 : 48);

  // Passe 1 : mesure de la hauteur
  const probe = createCanvas(W, 3000);
  const yEnd = run(probe.getContext('2d'));
  const H = Math.max(compact ? 140 : 240, Math.ceil(yEnd + (compact ? 50 : 78)));

  // Passe 2 : rendu final (seule la carte « green » suit la couleur du serveur)
  const canvas = createCanvas(W, H);
  const ctx = spec.theme === 'green' ? themedCtx(canvas.getContext('2d'), spec.guildId) : canvas.getContext('2d');
  const radius = compact ? 18 : 22;

  ctx.save();
  roundRect(ctx, 1, 1, W - 2, H - 2, radius);
  ctx.clip();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  if (style === 'sobre') {
    ctx.fillStyle = th.accent;
    ctx.fillRect(0, 0, 8, H);
  }
  run(ctx);
  footerStyled(ctx, pal, spec, H, px, compact);
  ctx.restore();

  roundRect(ctx, 1, 1, W - 2, H - 2, radius);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.border;
  ctx.stroke();
  return canvas.toBuffer('image/png');
}


// ───────────────────────────────────────────────────────────
// Style « gris glacier » (défaut) : colonne latérale ardoise (icône, titre, heure, pied)
// + zone d'infos claire à droite (grille, gros nombre, citations, pastilles).
// ───────────────────────────────────────────────────────────
const SPLIT_COL = 300;
const SPLIT_PAD = 40;

function generateSplitCard(spec) {
  const th = THEMES[spec.theme] || THEMES.green;
  const pal = PAL.clair;
  const slate = '#475569';
  const colColor = slate;
  const ink = slate;
  const rx = SPLIT_COL + SPLIT_PAD;               // début de la zone d'infos
  const rRight = W - SPLIT_PAD;
  const inner = rRight - rx;

  const run = ctx => {
    ctx.textBaseline = 'alphabetic';
    let y = 44;
    if (spec.sub) {
      const sub = cut(spec.sub, 60);
      drawRich(ctx, sub, rx, y + 14, FONT, fitSize(ctx, sub, FONT, S.sub, inner, 17), { color: pal.muted });
      y += 46;
    }
    const blocks = spec.blocks || [];
    const hasBig = spec.bigValue !== undefined && spec.bigValue !== null && spec.bigValue !== '';
    const top = y;
    if (hasBig) {
      for (const b of blocks) y = drawBlockStyled(ctx, pal, b, rx, y, inner - 230);
      const nx = rRight - 100;
      drawRich(ctx, clean(spec.bigLabel || ''), nx, top + 18, FONT, S.label, { color: pal.muted, align: 'center' });
      const big = String(spec.bigValue);
      const bigSize = fitSize(ctx, big, FONT_BOLD, 96, 200, 36);
      const bigY = top + 32 + bigSize * 0.9;
      drawRich(ctx, big, nx, bigY, FONT_BOLD, bigSize, { color: ink, align: 'center' });
      y = Math.max(y, bigY + 16);
    } else if (blocks.length) {
      const colW = inner / 2;
      blocks.forEach((b, i) => {
        drawBlockStyled(ctx, pal, b, rx + (i % 2) * colW, y + Math.floor(i / 2) * BLOCK_H, colW - 20);
      });
      y += Math.ceil(blocks.length / 2) * BLOCK_H;
    }
    return drawQuotesPills(ctx, th, pal, ink, spec, rx, y, inner, rRight);
  };

  const probe = createCanvas(W, 3000);
  const yEnd = run(probe.getContext('2d'));
  const H = Math.max(260, Math.ceil(yEnd + 72));

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d'); // pas de recoloration : le gris glacier est la palette de ce style
  const radius = 22;

  ctx.save();
  roundRect(ctx, 1, 1, W - 2, H - 2, radius);
  ctx.clip();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = colColor;
  ctx.fillRect(0, 0, SPLIT_COL, H);
  // fine barre de couleur = type de log (vert, rouge, orange…)
  ctx.fillStyle = spec.theme === 'green' ? '#94a3b8' : th.accent;
  ctx.fillRect(SPLIT_COL - 6, 0, 6, H);

  // colonne : tuile d'icône, titre, heure, pied
  const cx = 34, cw = SPLIT_COL - 2 * cx;
  roundRect(ctx, cx, 34, 72, 72, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  const toks = tokenize(clean(spec.title));
  let rest = clean(spec.title);
  if (toks[0] && toks[0].t === 'emoji') {
    drawRich(ctx, toks[0].raw, cx + 36, 34 + 36 + 13, FONT_BOLD, 38, { align: 'center' });
    rest = clean(toks.slice(1).map(t => (t.t === 'emoji' ? t.raw : t.v)).join(''));
  }
  const tLines = wrap(ctx, rest, cw, 4, FONT_BOLD, 30);
  tLines.forEach((l, i) => drawRich(ctx, l, cx, 150 + i * 38, FONT_BOLD, 30, { color: '#ffffff' }));
  if (spec.time) {
    drawRich(ctx, clean(spec.time), cx, H - 66, FONT, 19, { color: 'rgba(255,255,255,0.88)' });
  }
  if (spec.footerRight) {
    const t = cut(spec.footerRight, 30);
    drawRich(ctx, t, cx, H - 36, FONT, fitSize(ctx, t, FONT, 15, cw, 12), { color: 'rgba(255,255,255,0.62)' });
  }

  run(ctx);
  if (spec.footerLeft) {
    ctx.fillStyle = pal.line;
    ctx.fillRect(rx, H - 62, inner, 2);
    const t = cut(spec.footerLeft, 70);
    drawRich(ctx, t, rx, H - 30, FONT, fitSize(ctx, t, FONT, S.footer, inner, 12), { color: pal.dim });
  }
  ctx.restore();

  roundRect(ctx, 1, 1, W - 2, H - 2, radius);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.border;
  ctx.stroke();
  return canvas.toBuffer('image/png');
}


// Style « verre fumé » : fond sombre + panneau de verre dépoli, mise en page « sobre »
function generateGlassCard(spec) {
  const gt = getTheme(spec.guildId);
  const base = THEMES[spec.theme] || THEMES.green;
  // Seule la carte « green » suit la couleur du serveur (blanc en monochrome) ; les autres gardent leur teinte
  const accent = spec.theme === 'green' ? (glass.isMono(gt.accent) ? '#ffffff' : gt.accent) : base.accent;
  const th = { ...base, accent };
  const pal = PAL.fume;
  const M = 6;
  const px = 56;
  const run = c => contentCard(c, th, pal, accent, spec, 'sobre');

  const probe = createCanvas(W, 3000);
  const yEnd = run(probe.getContext('2d'));
  const H = Math.max(240, Math.ceil(yEnd + 78)) + M;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const back = glass.glassBackdrop(W, H, gt.accent, false, gt);
  const blur = glass.blurred(back, W, H);
  glass.glassPanel(ctx, back, blur, M, M, W - 2 * M, H - 2 * M, 28, { tint: glass.tintFor(gt, 0.55) });

  run(ctx);
  footerStyled(ctx, pal, spec, H - M, px, false);
  return canvas.toBuffer('image/png');
}

// Point d'entrée : choisit le style du serveur (ou spec.logStyle pour forcer un aperçu)
function generateLogCard(spec) {
  const style = spec.logStyle || getTheme(spec.guildId).look;
  if (style === 'fume') return generateGlassCard(spec);
  if (style === 'clair') return generateSplitCard(spec);
  if (style && style !== 'neon' && PAL[style]) return generateStyledCard(style, spec);
  return generateNeonCard(spec);
}

// Version recommandée : charge d'abord les emojis (Unicode + custom) présents dans la carte
async function generateLogCardAsync(spec) {
  const strings = [
    spec.title, spec.sub, spec.bigLabel, spec.bigValue, spec.footerLeft, spec.footerRight,
    ...(spec.blocks || []).flatMap(b => [b.label, b.value]),
    ...(spec.quotes || []).flatMap(q => [q.label, q.text]),
    ...(spec.pills || []).map(p => p.text)
  ].map(v => (v === undefined || v === null ? v : String(v)));
  try { await preloadEmojis(strings); } catch { /* on dessine sans les emojis manquants */ }
  return generateLogCard(spec);
}

module.exports = { generateLogCard, generateLogCardAsync, formatAge };
