'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte verte « néon » de montée de niveau (envoyée à la place de l'embed XP)
// Affiche : gros niveau, XP gagné (message ou vocal), XP total + barre de progression
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx, getTheme } = require('../core/cardTheme');
const glass = require('../core/glassCard');

// ── Polices (Poppins si présente, sinon police système) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'LevelUpBold');
    GlobalFonts.registerFromPath(r, 'LevelUpRegular');
    FONT = 'LevelUpRegular';
    FONT_BOLD = 'LevelUpBold';
  }
} catch { /* police système */ }

const W = 1076;
const H = 490;

const C = {
  bg: '#0a1a12',
  card: '#0e2218',
  border: '#1e4630',
  pill: '#122c1e',
  pillBorder: '#204c34',
  green: '#2ecc71',
  greenLight: '#78eba0',
  gold: '#ffd65a',
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

function fmt(n) {
  return Math.floor(n).toLocaleString('fr-FR');
}

// Réduit la police jusqu'à ce que le texte tienne dans maxW
function fitText(ctx, text, font, size, maxW) {
  let s = size;
  ctx.font = `${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 14) {
    s -= 2;
    ctx.font = `${s}px ${font}`;
  }
  return text;
}

/**
 * @param {object} o
 * @param {string} [o.guildId]  serveur (thème des cartes)
 * @param {string} o.username   Pseudo du membre
 * @param {string} [o.badge]    'Founder' | 'Premium' | ''
 * @param {number} o.level      Nouveau niveau
 * @param {number} o.totalXp    XP total
 * @param {number} o.gainedXp   XP gagné (message ou vocal)
 * @param {string} [o.source]   'message' (défaut) | 'voice'
 * @param {number} o.currentXp  XP dans le niveau actuel
 * @param {number} o.neededXp   XP nécessaire pour passer au niveau suivant
 * @returns {Buffer} PNG
 */
// ── Style « verre fumé » (choisi dans /cartes-style) ──
function generateGlassLevelUp(o) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const gTheme = getTheme(o.guildId);
  const accent = gTheme.accent;
  const ratio = o.neededXp > 0 ? Math.max(0, Math.min(1, o.currentXp / o.neededXp)) : 0;
  const back = glass.glassBackdrop(W, H, accent, false, gTheme);
  const blur = glass.blurred(back, W, H);
  glass.glassPanel(ctx, back, blur, 12, 12, W - 24, H - 24, 44);

  const pad = 62;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `22px ${FONT_BOLD}`;
  ctx.fillText('LEVEL UP', pad, 120);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, o.username, FONT_BOLD, 58, 500);
  ctx.fillText(o.username, pad, 190);
  if (o.badge) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `22px ${FONT}`;
    ctx.fillText(o.badge, pad, 226);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `24px ${FONT}`;
  ctx.fillText(`${fmt(o.totalXp)} XP au total`, pad, 276);

  glass.glassBar(ctx, pad, 328, 580, 26, ratio);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `20px ${FONT}`;
  ctx.fillText(`${fmt(o.currentXp)} / ${fmt(o.neededXp)} XP  ·  niveau suivant : ${o.level + 1}`, pad, 394);

  // pastille de niveau (verre dans le verre)
  const px = 744, py = 100, pw = 242, ph = 290;
  glass.glassPanel(ctx, back, blur, px, py, pw, ph, 34, { tint: 'rgba(255,255,255,0.08)' });
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `22px ${FONT_BOLD}`;
  ctx.fillText('NIVEAU', px + pw / 2, py + 54);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, String(o.level), FONT_BOLD, 130, pw - 30);
  ctx.fillText(String(o.level), px + pw / 2, py + 184);
  ctx.fillStyle = glass.isMono(accent) ? '#ffffff' : '#86efac';
  ctx.font = `24px ${FONT_BOLD}`;
  ctx.fillText(`+${fmt(o.gainedXp)} XP`, px + pw / 2, py + 232);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `16px ${FONT}`;
  ctx.fillText(o.source === 'voice' ? 'en vocal' : 'en message', px + pw / 2, py + 262);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

function generateLevelUpCard(o) {
  if (getTheme(o.guildId).look === 'fume') return generateGlassLevelUp(o);
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), o.guildId);
  const pad = 60;
  const ratio = o.neededXp > 0 ? Math.max(0, Math.min(1, o.currentXp / o.neededXp)) : 0;

  // Fond sombre + halo vert
  ctx.fillStyle = '#050d09';
  ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700);
  bg.addColorStop(0, '#0c2a1b');
  bg.addColorStop(1, '#050d09');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Cadre néon
  ctx.shadowColor = C.green;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = C.green;
  ctx.lineWidth = 4;
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Titre + pseudo
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.greenLight;
  ctx.font = `22px ${FONT_BOLD}`;
  ctx.fillText('LEVEL UP', pad, 82);
  const sub = o.badge ? `${o.username}  ·  ${o.badge}` : o.username;
  ctx.fillStyle = C.muted;
  fitText(ctx, sub, FONT, 22, 460);
  ctx.fillText(sub, pad, 114);

  // XP gagné (à gauche) + provenance : vocal ou message
  const sourceText = o.source === 'voice' ? 'XP gagnés en vocal' : 'XP gagnés en message';
  ctx.fillStyle = C.muted;
  ctx.font = `18px ${FONT_BOLD}`;
  ctx.fillText('XP GAGNÉ', pad, 214);
  ctx.fillStyle = C.greenLight;
  ctx.font = `60px ${FONT_BOLD}`;
  ctx.fillText(`+${fmt(o.gainedXp)} XP`, pad, 284);
  ctx.fillStyle = C.dim;
  ctx.font = `20px ${FONT}`;
  ctx.fillText(sourceText, pad + 2, 316);

  // Gros niveau lumineux (centre-droite)
  const nx = W / 2 + 190;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.muted;
  ctx.font = `20px ${FONT_BOLD}`;
  ctx.fillText('NIVEAU', nx, 130);
  ctx.shadowColor = C.green;
  ctx.shadowBlur = 40;
  ctx.fillStyle = C.green;
  ctx.font = `170px ${FONT_BOLD}`;
  ctx.fillText(String(o.level), nx, 284);
  ctx.shadowBlur = 0;

  // XP total (sous le niveau)
  ctx.fillStyle = C.muted;
  ctx.font = `18px ${FONT_BOLD}`;
  ctx.fillText('XP TOTAL', nx, 326);
  ctx.fillStyle = C.text;
  fitText(ctx, `${fmt(o.totalXp)} XP`, FONT_BOLD, 38, 360);
  ctx.fillText(`${fmt(o.totalXp)} XP`, nx, 366);

  // Barre de progression néon
  const barX = pad, barY = 404, barW = W - 2 * pad, barH = 22;
  roundRect(ctx, barX, barY, barW, barH, 11);
  ctx.fillStyle = '#0f2a1c';
  ctx.fill();
  ctx.shadowColor = C.green;
  ctx.shadowBlur = 18;
  roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, 11);
  ctx.fillStyle = C.green;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'left';
  ctx.fillStyle = C.muted;
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`${fmt(o.currentXp)} / ${fmt(o.neededXp)} XP`, pad, 452);
  ctx.textAlign = 'right';
  ctx.fillText('Prochain niveau : ' + (o.level + 1), W - pad, 452);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { generateLevelUpCard };