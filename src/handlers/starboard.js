'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte verte « StarBoard » (photo en fond + dégradé sombre, gros score, barre)
// Envoyée à la place de l'embed StarBoard, comme la carte de level up.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx, getTheme } = require('./cardTheme');
const glass = require('./glassCard');
const compact = require('./compactCard');

// ── Polices (Poppins si présente dans src/assets/fonts, sinon police système) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
let BOLD = 'bold '; // préfixe de graisse quand Poppins n'est pas dispo (police système)
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'StarBoardBold');
    GlobalFonts.registerFromPath(r, 'StarBoardRegular');
    FONT = 'StarBoardRegular';
    FONT_BOLD = 'StarBoardBold';
    BOLD = '';
  }
} catch { /* police système */ }

const W = 1000;
const H = 420;

const C = {
  bg: '#031a0e',
  bg2: '#06301a',
  border: '#22e06b',
  glow: '#22e06b',
  text: '#eafff1',
  dim: '#4f9f70',
  accent: '#2cff7a',
  grid: 'rgba(34,224,107,0.05)'
};

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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

function drawStar(ctx, cx, cy, R) {
  const r = R * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.save();
  ctx.shadowColor = C.glow;
  ctx.shadowBlur = R * 0.8;
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.restore();
}

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.join(' ').length < words.join(' ').length) {
    let l = lines[lines.length - 1] || '';
    while (l.length && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1);
    lines[Math.max(0, lines.length - 1)] = l + '…';
  }
  return lines;
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

async function safeLoad(src) {
  if (!src) return null;
  try { return await loadImage(src); } catch { /* repli ci-dessous */ }
  if (typeof src === 'string' && /^https?:\/\//i.test(src) && typeof fetch === 'function') {
    try {
      const r = await fetch(src);
      if (r.ok) return await loadImage(Buffer.from(await r.arrayBuffer()));
    } catch { /* pas de photo */ }
  }
  return null;
}


// ── Style « verre fumé » (défaut) : la photo est en fond plein, le verre dépoli par-dessus ──
function glassStarboard(o, photo) {
  const score = Math.max(0, o.score | 0);
  const th = Math.max(score, o.threshold | 0, 1);
  const author = String(o.author || 'Inconnu');
  const content = o.content ? String(o.content) : '';
  const footer = o.footer || 'ScaraBot · StarBoard';
  const accent = getTheme(o.guildId).accent;
  const mono = glass.isMono(accent);
  const hi = mono ? '#ffffff' : accent;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond : toujours le fond de la couleur choisie (la photo n'est que dans le bloc de verre)
  const theme = getTheme(o.guildId);
  const back = glass.glassBackdrop(W, H, accent, false, theme);
  const blur = back; // aucun flou : le verre garde le fond net

  // Panneau de verre pleine largeur ; la photo est affichée DANS le panneau (à droite)
  const px = 6, py = 6, ph = H - 12, pw = W - 12;
  glass.glassPanel(ctx, back, blur, px, py, pw, ph, 30, { tint: glass.tintFor(theme, photo ? 0.5 : 0.55) });

  // Largeur de la colonne texte (à gauche de la photo)
  const PH_PAD = 20;
  const fh = ph - PH_PAD * 2, PH_W = fh; // carré dédié à la photo publiée
  const fx = px + pw - PH_PAD - PH_W, fy = py + PH_PAD;
  const textW = photo ? fx - (px + 44) - 28 : 860;
  if (photo) {
    // Ombre douce + photo arrondie dans le verre
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    glass.roundRect(ctx, fx, fy, PH_W, fh, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.restore();
    ctx.save();
    glass.roundRect(ctx, fx, fy, PH_W, fh, 20);
    ctx.clip();
    // Carré : uniquement la photo publiée (recadrée pour remplir)
    drawCover(ctx, photo, fx, fy, PH_W, fh);
    ctx.restore();
    // Liseré de verre autour de la photo
    glass.roundRect(ctx, fx + 1, fy + 1, PH_W - 2, fh - 2, 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const L = px + 44;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `${BOLD}20px ${FONT_BOLD}`;
  ctx.fillText('STARBOARD', L, 90);

  ctx.fillStyle = '#ffffff';
  ctx.font = `${BOLD}32px ${FONT_BOLD}`;
  ctx.fillText(author.slice(0, 22), L, 134);

  // Gros score + étoile
  ctx.font = `${BOLD}118px ${FONT_BOLD}`;
  const tw = ctx.measureText(String(score)).width;
  ctx.fillText(String(score), L, 262);
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = hi;
  drawStarPath(ctx, L + tw + 118 * 0.42, 262 - 118 * 0.36, 118 * 0.28);
  ctx.fill();
  ctx.restore();

  // Message : 1 ligne avec photo, 2 lignes sans photo
  const maxLines = photo ? 1 : 2;
  const barY = photo ? 336 : 344;
  if (content) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `19px ${FONT}`;
    wrap(ctx, content, textW, maxLines).forEach((l, i) => ctx.fillText(l, L, 302 + i * 26));
  }

  // Barre de progression en verre + pied
  glass.glassBar(ctx, L, barY, photo ? textW : 420, 14, score / th);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `15px ${FONT}`;
  ctx.fillText(`${score} / ${th} étoiles · ${footer}`, L, barY + 36);

  return canvas.toBuffer('image/png');
}

function drawStarPath(ctx, cx, cy, R) {
  const r = R * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * @param {object} o
 * @param {string} o.author        Pseudo de l'auteur du message
 * @param {number} o.score         Nombre d'étoiles
 * @param {number} [o.threshold]   Seuil du StarBoard
 * @param {string} [o.content]     Texte du message (affiché sur 1 ligne, ou 2 sans photo)
 * @param {string|Buffer} [o.imageUrl]  Photo du message (URL ou Buffer)
 * @param {string} [o.footer]
 * @returns {Promise<Buffer>} PNG
 */
async function generateStarboardCard(o) {
  if (compact.isCompact(o.guildId)) {
    const photo = await safeLoad(o.imageUrl);
    return compact.renderCompact(compact.starboardSpec({ ...o, photo }));
  }
  const score = Math.max(0, o.score | 0);
  const th = Math.max(score, o.threshold | 0, 1);
  const author = String(o.author || 'Inconnu');
  const content = o.content ? String(o.content) : '';
  const footer = o.footer || 'ScaraBot · StarBoard';
  const photo = await safeLoad(o.imageUrl);
  if (getTheme(o.guildId).look === 'fume') return glassStarboard(o, photo);

  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), o.guildId);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Fond + grille
  const x = 24, y = 24, w = W - 48, h = H - 48;
  ctx.save();
  roundRect(ctx, x, y, w, h, 24);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, C.bg);
  g.addColorStop(1, C.bg2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  if (photo) {
    drawCover(ctx, photo, x, y, w, h);
    const ov = ctx.createLinearGradient(x, 0, x + w, 0);
    ov.addColorStop(0, hexA(C.bg, 0.97));
    ov.addColorStop(0.5, hexA(C.bg, 0.75));
    ov.addColorStop(1, hexA(C.bg, 0.1));
    ctx.fillStyle = ov;
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let gx = x; gx < x + w; gx += 28) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
    for (let gy = y; gy < y + h; gy += 28) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  }
  ctx.restore();

  // Cadre néon
  ctx.save();
  ctx.shadowColor = C.glow;
  ctx.shadowBlur = 22;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 24);
  ctx.stroke();
  ctx.restore();

  const L = 66;
  ctx.fillStyle = C.accent;
  ctx.font = `${BOLD}22px ${FONT_BOLD}`;
  ctx.fillText('STARBOARD', L, 90);

  ctx.fillStyle = C.text;
  ctx.font = `${BOLD}30px ${FONT_BOLD}`;
  ctx.fillText(author.slice(0, 22), L, 132);

  // Gros score + étoile
  ctx.font = `${BOLD}118px ${FONT_BOLD}`;
  const tw = ctx.measureText(String(score)).width;
  ctx.save();
  ctx.shadowColor = C.glow;
  ctx.shadowBlur = 24;
  ctx.fillStyle = C.accent;
  ctx.fillText(String(score), L, 262);
  ctx.restore();
  drawStar(ctx, L + tw + 118 * 0.42, 262 - 118 * 0.36, 118 * 0.28);

  // Message : 1 ligne avec photo, 2 lignes (plus large) sans photo
  const maxLines = photo ? 1 : 2;
  const barY = photo ? 336 : 344;
  if (content) {
    ctx.fillStyle = C.text;
    ctx.font = `19px ${FONT}`;
    wrap(ctx, content, photo ? 460 : 860, maxLines).forEach((l, i) => ctx.fillText(l, L, 302 + i * 26));
  }

  // Barre de progression + pied
  const barW = 420;
  ctx.save();
  ctx.fillStyle = hexA(C.dim, 0.3);
  roundRect(ctx, L, barY, barW, 12, 6);
  ctx.fill();
  ctx.shadowColor = C.glow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = C.accent;
  roundRect(ctx, L, barY, Math.max(12, Math.min(barW, barW * (score / th))), 12, 6);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = C.dim;
  ctx.font = `15px ${FONT}`;
  ctx.fillText(`${score} / ${th} étoiles · ${footer}`, L, barY + 36);

  return canvas.toBuffer('image/png');
}

module.exports = { generateStarboardCard };
