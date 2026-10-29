'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte verte des statistiques du bot (commande !stats)
// Même style que la carte de montée de niveau : serveurs + membres
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'StatsBold');
    GlobalFonts.registerFromPath(r, 'StatsRegular');
    FONT = 'StatsRegular';
    FONT_BOLD = 'StatsBold';
  }
} catch { /* police système */ }

const W = 1076;
const H = 330;

const C = {
  bg: '#0a1a12',
  card: '#0e2218',
  border: '#1e4630',
  pill: '#122c1e',
  pillBorder: '#204c34',
  green: '#2ecc71',
  greenLight: '#78eba0',
  text: '#ebf5ee',
  muted: '#82aa91',
  dim: '#648c73'
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const fmt = n => Math.floor(n).toLocaleString('fr-FR');

function fitText(ctx, text, font, size, maxW) {
  let s = size;
  ctx.font = `${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 14) {
    s -= 2;
    ctx.font = `${s}px ${font}`;
  }
}

/**
 * @param {object} o
 * @param {string} [o.guildId]  serveur (thème des cartes)
 * @param {string} o.botName   Nom du bot
 * @param {number} o.servers   Nombre de serveurs
 * @param {number} o.members   Total de membres
 * @returns {Buffer} PNG
 */
function generateStatsCard(o) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(o.guildId)) {
    return cc.renderCompactSync({
      guildId: o.guildId, theme: 'green', title: '📊 Statistiques', sub: o.botName,
      blocks: [
        { label: 'Serveurs', value: Number(o.servers || 0).toLocaleString('fr-FR') },
        { label: 'Membres', value: Number(o.members || 0).toLocaleString('fr-FR') }
      ],
      pills: [{ text: 'EN LIGNE', tone: 'ok' }]
    });
  }
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), o.guildId);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 12, 12, W - 24, H - 24, 24);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.border;
  ctx.stroke();

  // Pastille check
  const cx = 78, cy = 84, r = 34;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy);
  ctx.lineTo(cx - 4, cy + 14);
  ctx.lineTo(cx + 18, cy - 14);
  ctx.stroke();

  // Titre + nom du bot
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = `34px ${FONT_BOLD}`;
  ctx.fillText('Statistiques', 134, 82);
  ctx.fillStyle = C.muted;
  fitText(ctx, o.botName, FONT, 22, 520);
  ctx.fillText(o.botName, 136, 114);

  // Badge "EN LIGNE"
  const badgeText = 'EN LIGNE';
  ctx.font = `20px ${FONT_BOLD}`;
  const bw = ctx.measureText(badgeText).width + 64;
  const bx = W - 44 - bw, by = 56, bh = 44;
  roundRect(ctx, bx, by, bw, bh, 22);
  ctx.fillStyle = '#14462a';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.green;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + 24, by + bh / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  ctx.fillStyle = C.greenLight;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, bx + 42, by + bh / 2 + 1);
  ctx.textBaseline = 'alphabetic';

  // 2 pastilles : Serveurs / Membres
  const pad = 44, gap = 20;
  const pw = Math.floor((W - 2 * pad - gap) / 2);
  const py = 156, ph = 140;
  const stats = [
    ['SERVEURS', fmt(o.servers), C.text],
    ['MEMBRES', fmt(o.members), C.greenLight]
  ];
  stats.forEach(([label, value, color], i) => {
    const x = pad + i * (pw + gap);
    roundRect(ctx, x, py, pw, ph, 18);
    ctx.fillStyle = C.pill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.pillBorder;
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = `20px ${FONT}`;
    ctx.fillText(label, x + 26, py + 42);
    ctx.fillStyle = color;
    fitText(ctx, value, FONT_BOLD, 56, pw - 52);
    ctx.fillText(value, x + 26, py + 108);
  });

  return canvas.toBuffer('image/png');
}

module.exports = { generateStatsCard };
