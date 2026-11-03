'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Graphiques (PNG) pour /server-stats et /user-stats.
// Toujours en sombre (anthracite), comme les cartes de logs.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'ActChartBold');
    GlobalFonts.registerFromPath(r, 'ActChartRegular');
    FONT = 'ActChartRegular';
    FONT_BOLD = 'ActChartBold';
  }
} catch { /* police système */ }

const W = 1000;
const H = 440;
const PLOT = { l: 84, r: W - 44, t: 100, b: H - 72 };

// Palette « anthracite » : exactement celle des cartes de logs (toujours sombre, quel que soit /card-style)
const C = {
  bg: '#1c1f26',
  card: '#1c1f26',
  border: '#2a2e37',
  grid: '#2a2e37',
  area: '#1d2f4f',
  green: '#3b82f6',      // barres / courbe (accent bleu des logs)
  greenLight: '#93c5fd',
  gold: '#f5c542',
  text: '#f3f4f6',
  muted: '#9ca3af',
  dim: '#6b7280'
};

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Retire les émojis (non rendus par la police du canvas) et raccourcit le texte
function propre(text, fallback = '?') {
  const s = String(text ?? '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .trim();
  return s || fallback;
}

function fit(ctx, text, maxW) {
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// Maximum « rond » de l'axe Y (5 graduations)
function niceMax(v) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

const fmtN = n => Math.round(n).toLocaleString('fr-FR');

function frame(guildId, caption, sub) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 12, 12, W - 24, H - 24, 24);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.border;
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `26px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, caption, W - 300), 44, 64);
  if (sub) {
    ctx.fillStyle = C.muted;
    ctx.font = `19px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(sub, W - 44, 64);
    ctx.textAlign = 'left';
  }
  return { canvas, ctx };
}

function drawGrid(ctx, max) {
  ctx.lineWidth = 1;
  ctx.font = `15px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const y = PLOT.b - ((PLOT.b - PLOT.t) * i) / 5;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(PLOT.l, y);
    ctx.lineTo(PLOT.r, y);
    ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.fillText(fmtN((max * i) / 5), PLOT.l - 12, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawEmpty(ctx) {
  ctx.fillStyle = C.muted;
  ctx.font = `22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Aucune donnée pour le moment', (PLOT.l + PLOT.r) / 2, (PLOT.t + PLOT.b) / 2 - 6);
  ctx.font = `16px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText('Les statistiques se remplissent au fil des messages.', (PLOT.l + PLOT.r) / 2, (PLOT.t + PLOT.b) / 2 + 22);
  ctx.textAlign = 'left';
}

function drawXLabels(ctx, labels, slot, every, size = 15) {
  ctx.fillStyle = C.muted;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    ctx.fillText(label, PLOT.l + slot * i + slot / 2, PLOT.b + 28);
  });
  ctx.textAlign = 'left';
}

// ── Courbe avec aire (messages par jour) ────────────────────────────────
function lineChart({ guildId, caption, sub, labels, values }) {
  const { canvas, ctx } = frame(guildId, caption, sub);
  const maxV = Math.max(...values, 0);
  const max = niceMax(maxV);
  drawGrid(ctx, max);

  const n = values.length;
  const slot = (PLOT.r - PLOT.l) / n;
  const px = i => PLOT.l + slot * i + slot / 2;
  const py = v => PLOT.b - ((PLOT.b - PLOT.t) * v) / max;

  if (maxV === 0) {
    drawXLabels(ctx, labels, slot, Math.ceil(n / 10));
    drawEmpty(ctx);
    return canvas.toBuffer('image/png');
  }

  ctx.beginPath();
  ctx.moveTo(px(0), PLOT.b);
  values.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(px(n - 1), PLOT.b);
  ctx.closePath();
  ctx.fillStyle = C.area;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.green;
  ctx.stroke();

  const showValues = n <= 14;
  values.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(px(i), py(v), 5, 0, Math.PI * 2);
    ctx.fillStyle = C.greenLight;
    ctx.fill();
    if (showValues && v > 0) {
      ctx.fillStyle = C.text;
      ctx.font = `15px ${FONT_BOLD}`;
      ctx.textAlign = 'center';
      ctx.fillText(fmtN(v), px(i), py(v) - 14);
      ctx.textAlign = 'left';
    }
  });

  drawXLabels(ctx, labels, slot, Math.ceil(n / 10));
  return canvas.toBuffer('image/png');
}

// ── Barres verticales (messages par jour / activité horaire) ────────────
function barChart({ guildId, caption, sub, labels, values, highlight = -1, labelEvery = null, valueLabels = true, labelSize = 15 }) {
  const { canvas, ctx } = frame(guildId, caption, sub);
  const maxV = Math.max(...values, 0);
  const max = niceMax(maxV);
  drawGrid(ctx, max);

  const n = values.length;
  const slot = (PLOT.r - PLOT.l) / n;
  const bw = Math.min(72, slot * 0.62);
  drawXLabels(ctx, labels, slot, labelEvery || Math.ceil(n / 15), labelSize);

  if (maxV === 0) {
    drawEmpty(ctx);
    return canvas.toBuffer('image/png');
  }

  values.forEach((v, i) => {
    if (v <= 0) return;
    const h = ((PLOT.b - PLOT.t) * v) / max;
    const x = PLOT.l + slot * i + (slot - bw) / 2;
    roundRect(ctx, x, PLOT.b - h, bw, h, 6);
    ctx.fillStyle = i === highlight ? C.gold : C.green;
    ctx.fill();
    if (valueLabels && n <= 16) {
      ctx.fillStyle = C.text;
      ctx.font = `15px ${FONT_BOLD}`;
      ctx.textAlign = 'center';
      ctx.fillText(fmtN(v), x + bw / 2, PLOT.b - h - 10);
      ctx.textAlign = 'left';
    }
  });
  return canvas.toBuffer('image/png');
}

// ── Barres horizontales (top membres / salons) ──────────────────────────
function hbarChart({ guildId, caption, sub, items }) {
  const { canvas, ctx } = frame(guildId, caption, sub);
  const rows = items.slice(0, 8);

  if (!rows.length || rows.every(r => r.value <= 0)) {
    drawEmpty(ctx);
    return canvas.toBuffer('image/png');
  }

  const top = 96;
  const bottom = H - 44;
  const rowH = Math.min(46, (bottom - top) / rows.length);
  const labelX = 44;
  const barX = 290;
  const barMaxW = W - 44 - 96 - barX;
  const maxV = Math.max(...rows.map(r => r.value));

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    const cy = y + rowH / 2;
    const bh = Math.min(28, rowH - 12);

    ctx.fillStyle = C.text;
    ctx.font = `18px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, propre(row.label), barX - labelX - 18), labelX, cy);

    const w = Math.max(8, (barMaxW * row.value) / maxV);
    roundRect(ctx, barX, cy - bh / 2, w, bh, 8);
    ctx.fillStyle = i === 0 ? C.gold : C.green;
    ctx.fill();

    ctx.fillStyle = C.text;
    ctx.font = `17px ${FONT_BOLD}`;
    ctx.fillText(fmtN(row.value), barX + w + 12, cy);
    ctx.textBaseline = 'alphabetic';
  });
  return canvas.toBuffer('image/png');
}

module.exports = { lineChart, barChart, hbarChart, propre };