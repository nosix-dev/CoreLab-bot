'use strict';

// ───────────────────────────────────────────────────────────
// Roue /poke-wheel — bande façon « ouverture de caisse »
// Une image par étape de l'animation : 9 cartes alignées, ligne dorée au centre,
// le cadre prend la couleur de la rareté de la carte au centre.
//
// await generateReelFrame({
//   strip,            // [{ name, emoji, color: '#rrggbb' }]  (tirages défilant sur la bande)
//   center,           // index de la carte au centre
//   title,            // ex. '🎡 LA ROUE TOURNE...'
//   user,             // pseudo affiché en haut à droite
//   final             // true : dernière image (carte gagnante agrandie, halo)
//   guildId           // serveur (style de cartes choisi dans /card-style)
// }) -> Buffer PNG
// ───────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { preloadEmojis, drawRich, fitSize, truncateRich } = require('../core/cardEmoji');
// lookCtx = style choisi dans /card-style (verre fumé…) ; couleurs de rareté conservées
const lookCtx = require('../core/cardTheme').lookCtx || (ctx => ctx);

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'WheelBold');
    GlobalFonts.registerFromPath(r, 'WheelRegular');
    FONT = 'WheelRegular';
    FONT_BOLD = 'WheelBold';
  }
} catch { /* police système */ }

const W = 1076;
const H = 300;
const TILES = 9;       // cartes visibles
const TW = 130;        // largeur d'une carte
const GAP = 10;
const TOP = 112;
const TH = 150;
const BG = '#07060d';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTile(ctx, t, cx, opts = {}) {
  const scale = opts.scale || 1;
  const w = TW * scale;
  const h = TH * scale;
  const x = cx - w / 2;
  const y = TOP + (TH - h) / 2;
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.glow) {
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 38;
  }
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#10131f';
  ctx.fill();
  ctx.shadowBlur = 0;
  // dégradé de rareté
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, `${t.color}55`);
  g.addColorStop(1, `${t.color}00`);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  if (opts.glow) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = t.color;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
  }
  // barre de rareté en bas
  ctx.fillStyle = t.color;
  ctx.fillRect(x + 10, y + h - 9, w - 20, 5);
  // emoji + nom
  drawRich(ctx, t.emoji || '🃏', cx, y + h * 0.56, FONT, Math.round(52 * scale), { align: 'center' });
  const name = truncateRich(String(t.name).replace(/^Carte\s+/i, ''), 16);
  const size = fitSize(ctx, name, FONT_BOLD, Math.round(15 * scale), w - 14, 10);
  drawRich(ctx, name, cx, y + h - 20, FONT_BOLD, size, { align: 'center', color: '#e6ecfa' });
  ctx.globalAlpha = 1;
}

async function generateReelFrame({ strip, center, title, user, final = false, guildId }) {
  try { await preloadEmojis([title, ...strip.map(t => t.emoji), '🃏']); } catch { /* sans emojis manquants */ }

  const canvas = createCanvas(W, H);
  const ctx = lookCtx(canvas.getContext('2d'), guildId);
  const mid = strip[center];
  const accent = mid?.color || '#4285f4';

  // Fond + halo + cadre néon (couleur = rareté de la carte au centre)
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 650);
  bg.addColorStop(0, `${accent}33`);
  bg.addColorStop(1, BG);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textBaseline = 'alphabetic';
  drawRich(ctx, title, 60, 80, FONT_BOLD, 26, { color: '#f2f4ff' });
  if (user) {
    drawRich(ctx, truncateRich(user, 22), W - 60, 80, FONT, 19, { color: '#8d93ad', align: 'right' });
  }

  // Bande de cartes (dessinée sur un calque à part, puis estompée sur les bords)
  const cx = W / 2;
  const half = Math.floor(TILES / 2);
  const layer = createCanvas(W, H);
  const lctx = layer.getContext('2d');
  lctx.textBaseline = 'alphabetic';
  for (let d = -half; d <= half; d++) {
    const t = strip[center + d];
    if (!t || d === 0) continue; // la carte du centre est dessinée à part, par-dessus
    drawTile(lctx, t, cx + d * (TW + GAP), { alpha: final ? 0.45 : 1 });
  }
  // Fondu sur les bords (efface progressivement le calque, sans toucher au fond)
  lctx.globalCompositeOperation = 'destination-out';
  for (const [x0, x1, a0, a1] of [[20, 300, 1, 0], [W - 300, W - 20, 0, 1]]) {
    const g = lctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, `rgba(0,0,0,${a0})`);
    g.addColorStop(1, `rgba(0,0,0,${a1})`);
    lctx.fillStyle = g;
    lctx.fillRect(x0, 0, x1 - x0, H);
  }
  lctx.clearRect(0, 0, 20, H);
  lctx.clearRect(W - 20, 0, 20, H);
  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer, 0, 0);

  // Carte du centre (gagnante sur la dernière image)
  if (mid) drawTile(ctx, mid, cx, { scale: final ? 1.18 : 1, glow: final });

  // Ligne dorée
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(cx - 2, TOP - 20, 4, TH + 40);
  ctx.beginPath();
  ctx.moveTo(cx - 12, TOP - 22);
  ctx.lineTo(cx + 12, TOP - 22);
  ctx.lineTo(cx, TOP - 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 12, TOP + TH + 22);
  ctx.lineTo(cx + 12, TOP + TH + 22);
  ctx.lineTo(cx, TOP + TH + 6);
  ctx.fill();
  ctx.shadowBlur = 0;

  return canvas.toBuffer('image/png');
}

module.exports = { generateReelFrame, TILES };