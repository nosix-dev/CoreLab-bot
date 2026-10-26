'use strict';

// ───────────────────────────────────────────────────────────
// Cartes « néon » des logs vocaux (même style que la carte level up)
//  - join  : connecté en vocal      (vert)
//  - leave : déconnecté du vocal    (rouge)
//  - move  : changement de salon    (orange)
// Emojis (Unicode + custom Discord) dessinés dans l'image.
// ───────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
// lookCtx = style choisi dans /cartes-style ; si cardTheme.js est une ancienne version, on dessine quand même la carte
const lookCtx = require('../core/cardTheme').lookCtx || (ctx => ctx);
const {
  preloadEmojis,
  measureRich,
  drawRich,
  fitSize,
  truncateRich
} = require('../core/cardEmoji');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'VoiceCardBold');
    GlobalFonts.registerFromPath(r, 'VoiceCardRegular');
    FONT = 'VoiceCardRegular';
    FONT_BOLD = 'VoiceCardBold';
  }
} catch { /* police système */ }

const W = 1076;
const H = 420;

const THEMES = {
  join: { accent: '#2ecc71', light: '#78eba0', bg: '#050d09', halo: '#0c2a1b', pill: '#0f2a1c', title: '🟢 CONNECTÉ EN VOCAL' },
  leave: { accent: '#ff4d5e', light: '#ff9aa4', bg: '#0d0507', halo: '#2a0c12', pill: '#2a0f14', title: '🔴 DÉCONNECTÉ DU VOCAL' },
  move: { accent: '#ffb020', light: '#ffd480', bg: '#0d0a05', halo: '#2a1d0c', pill: '#2a1f0f', title: '🔀 CHANGEMENT DE SALON' }
};

const TEXT = '#f2f8f4';
const MUTED = '#9bc2aa';
const DIM = '#7ea68c';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function pill(ctx, x, y, label, ok, th) {
  const w = measureRich(ctx, label, FONT_BOLD, 17) + 34;
  roundRect(ctx, x, y, w, 36, 18);
  ctx.fillStyle = th.pill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ok ? '#2ecc71' : '#ff4d5e';
  ctx.stroke();
  drawRich(ctx, label, x + 17, y + 25, FONT_BOLD, 17, { color: ok ? '#78eba0' : '#ff9aa4' });
  return w;
}

// Texte d'un champ avec réduction automatique de la taille
function field(ctx, text, x, y, family, size, maxW, color, opts = {}) {
  const s = fitSize(ctx, text, family, size, maxW, 22);
  drawRich(ctx, text, x, y, family, s, { color, ...opts });
}

/**
 * @param {object} o
 * @param {'join'|'leave'|'move'} o.type
 * @param {string} [o.guildId]
 * @param {string} [o.guildName]    Nom du serveur (pied de carte)
 * @param {string} [o.time]         Heure affichée en haut à droite
 * @param {string} o.username       Pseudo affiché
 * @param {string} [o.tag]          Tag Discord
 * @param {string} [o.channelName]  Salon rejoint / quitté (join, leave)
 * @param {string} [o.fromChannel]  Salon quitté (move)
 * @param {string} [o.toChannel]    Salon rejoint (move)
 * @param {number} [o.members]      Membres présents (join, move) / restants (leave)
 * @param {boolean} [o.micMuted]
 * @param {boolean} [o.deafened]
 * @param {number} [o.durationMs]   Durée de la session (leave)
 * @param {string} [o.memberId]
 * @returns {Buffer} PNG
 */
function generateVoiceCard(o) {
  const th = THEMES[o.type] || THEMES.join;
  const canvas = createCanvas(W, H);
  // Couleurs fixes : vert = connexion, rouge = déconnexion, orange = changement de salon
  // (le thème de couleur du serveur ne s'applique pas aux cartes vocales ; seul le style choisi dans /cartes-style s'applique)
  const ctx = lookCtx(canvas.getContext('2d'), o.guildId);
  const pad = 60;

  // Fond + halo
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700);
  bg.addColorStop(0, th.halo);
  bg.addColorStop(1, th.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Cadre néon
  ctx.shadowColor = th.accent;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 4;
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textBaseline = 'alphabetic';

  // Titre, heure, pseudo
  drawRich(ctx, th.title, pad, 80, FONT_BOLD, 22, { color: th.light });
  if (o.time) drawRich(ctx, o.time, W - pad, 80, FONT, 17, { color: DIM, align: 'right' });
  const user = truncateRich(o.username, 24);
  const sub = o.tag && o.tag !== o.username ? `${user}  ·  ${o.tag}` : truncateRich(o.username, 30);
  field(ctx, sub, pad, 112, FONT, 21, 620, MUTED);

  const members = Number.isFinite(o.members) ? o.members : 0;
  let rightLabel = 'MEMBRES PRÉSENTS';

  if (o.type === 'join' || o.type === 'leave') {
    drawRich(ctx, o.type === 'join' ? 'SALON REJOINT' : 'SALON QUITTÉ', pad, 188, FONT_BOLD, 16, { color: MUTED });
    field(ctx, truncateRich(o.channelName, 28), pad, 236, FONT_BOLD, 40, 580, TEXT);

    if (o.type === 'join') {
      let x = pad;
      x += pill(ctx, x, 270, o.micMuted ? 'Micro coupé' : 'Micro actif', !o.micMuted, th) + 14;
      pill(ctx, x, 270, o.deafened ? 'Casque coupé' : 'Casque actif', !o.deafened, th);
    } else {
      rightLabel = 'MEMBRES RESTANTS';
      drawRich(ctx, 'DURÉE EN VOCAL', pad, 294, FONT_BOLD, 16, { color: MUTED });
      drawRich(ctx, formatDuration(o.durationMs), pad, 336, FONT_BOLD, 36, { color: th.light });
    }
  } else {
    // move : de → vers
    drawRich(ctx, 'DE', pad, 188, FONT_BOLD, 16, { color: MUTED });
    field(ctx, truncateRich(o.fromChannel, 22), pad, 228, FONT_BOLD, 34, 560, TEXT);

    drawRich(ctx, '↓', pad, 280, FONT_BOLD, 38, { color: th.accent });

    drawRich(ctx, 'VERS', pad, 316, FONT_BOLD, 16, { color: MUTED });
    field(ctx, truncateRich(o.toChannel, 22), pad, 356, FONT_BOLD, 34, 560, th.light);
  }

  // Gros nombre de membres (à droite)
  const nx = W - 230;
  drawRich(ctx, rightLabel, nx, 150, FONT_BOLD, 19, { color: MUTED, align: 'center' });
  ctx.shadowColor = th.accent;
  ctx.shadowBlur = 40;
  drawRich(ctx, String(members), nx, 285, FONT_BOLD, 140, { color: th.accent, align: 'center' });
  ctx.shadowBlur = 0;

  // Pied de carte : serveur à gauche, ID du membre à droite
  let rightW = 0;
  if (o.memberId) {
    rightW = drawRich(ctx, `ID ${o.memberId}`, W - pad, H - 42, FONT, 15, { color: DIM, align: 'right' });
  }
  if (o.guildName) {
    const t = truncateRich(o.guildName, 30);
    field(ctx, t, pad, H - 42, FONT, 15, W - 2 * pad - rightW - 30, DIM);
  }

  return canvas.toBuffer('image/png');
}

// Version recommandée : charge d'abord les emojis (pseudo, salons, serveur) puis dessine
async function generateVoiceCardAsync(o) {
  try {
    await preloadEmojis([
      th_title(o.type), o.username, o.tag, o.channelName, o.fromChannel, o.toChannel, o.guildName
    ]);
  } catch { /* on dessine sans les emojis manquants */ }
  return generateVoiceCard(o);
}

function th_title(type) {
  return (THEMES[type] || THEMES.join).title;
}

module.exports = { generateVoiceCard, generateVoiceCardAsync, formatDuration };