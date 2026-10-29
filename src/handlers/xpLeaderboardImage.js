'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Image du classement XP pour /leaderboard — style "carte sombre" à 2 colonnes
// (Top XP / Top niveaux), identique au modèle du classement VTC.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

// ── Polices : JetBrains Mono / Poppins si présentes dans src/assets/fonts, sinon police mono système ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let MONO_BOLD = 'monospace';
let MONO = 'monospace';
let SANS = 'sans-serif';
try {
  const mb = path.join(FONT_DIR, 'JetBrainsMono-Bold.ttf');
  const mr = path.join(FONT_DIR, 'JetBrainsMono-Regular.ttf');
  if (fs.existsSync(mb) && fs.existsSync(mr)) {
    GlobalFonts.registerFromPath(mb, 'XpMonoBold');
    GlobalFonts.registerFromPath(mr, 'XpMonoRegular');
    MONO_BOLD = 'XpMonoBold';
    MONO = 'XpMonoRegular';
  }
  const pr = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(pr)) {
    GlobalFonts.registerFromPath(pr, 'XpSans');
    SANS = 'XpSans';
  }
} catch { /* polices système */ }

const C = {
  bg: '#0d1210',
  card: '#101714',
  cardBorder: '#1c2822',
  row: '#121a16',
  rowBorder: '#1b2620',
  green: '#2ee59d',
  greenDim: '#1f9e6e',
  text: '#e8efeb',
  muted: '#6f8279',
  gold: '#f4c542',
  silver: '#c9d1d9',
  bronze: '#d08a4e'
};
const PODIUM = [C.gold, C.silver, C.bronze];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function fmt(n) {
  return Math.floor(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
}

// Retire emojis / caractères exotiques que la police ne sait pas afficher
function cleanName(name) {
  const cleaned = String(name || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _\-.\[\]()!|'&@#+]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Membre';
}

function drawCheck(ctx, cx, cy, r) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.green; ctx.fill();
  ctx.strokeStyle = '#08130e'; ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.46, cy - r * 0.3);
  ctx.stroke();
}

function drawColumn(ctx, { x, y, w, title, rows, rowH, rowGap }) {
  ctx.fillStyle = C.muted;
  ctx.font = `700 15px ${MONO_BOLD}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, x, y);

  const top = y + 18;
  rows.forEach((r, i) => {
    const ry = top + i * (rowH + rowGap);
    const first = i === 0;

    roundRect(ctx, x, ry, w, rowH, 10);
    ctx.fillStyle = first ? 'rgba(46,229,157,0.08)' : C.row;
    ctx.fill();
    ctx.strokeStyle = first ? C.greenDim : C.rowBorder;
    ctx.lineWidth = first ? 2 : 1;
    ctx.stroke();

    const cy = ry + rowH / 2;

    // Rang : pastille pour le podium, "#4" pour le reste
    if (i < 3) {
      ctx.beginPath(); ctx.arc(x + 26, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = PODIUM[i]; ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = `700 14px ${MONO_BOLD}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + 26, cy + 5);
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `13px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(`#${i + 1}`, x + 26, cy + 5);
    }

    // Valeur à droite
    ctx.textAlign = 'right';
    ctx.font = `700 16px ${MONO_BOLD}`;
    ctx.fillStyle = C.green;
    const rightEdge = x + w - 16;
    ctx.fillText(r.value, rightEdge, cy + 6);
    const vW = ctx.measureText(r.value).width;

    // Nom
    ctx.textAlign = 'left';
    ctx.font = `15px ${SANS}`;
    ctx.fillStyle = C.text;
    const nameX = x + 52;
    ctx.fillText(fit(ctx, cleanName(r.name), rightEdge - vW - 14 - nameX), nameX, cy + 5);
  });
}

/**
 * @param {Object} opts
 * @param {string} opts.guildName
 * @param {Array<{name:string, level:number, xp:number}>} opts.entries  triées par XP décroissant
 * @param {number} [opts.totalMembers]  nombre total de membres classés
 * @returns {Promise<Buffer>} PNG
 */
async function generateXpLeaderboardImage({ guildName, entries, totalMembers, guildId }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    const top = entries.slice(0, 10);
    const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const totalXp = entries.reduce((s, e) => s + e.xp, 0);
    return cc.renderCompact({
      guildId, theme: 'green', title: '🏆 Classement',
      sub: `${mois} · ${fmt(totalXp)} XP · ${totalMembers ?? entries.length} actifs`,
      grid: 1, valueMax: 32,
      blocks: top.length
        ? top.map((e, i) => ({ label: `${i + 1}. ${cleanName(e.name)}`, value: `${fmt(e.xp)} XP · Niv. ${e.level}` }))
        : [{ label: '', value: 'Aucun score pour le moment' }],
      footerLeft: `Source : CoreLab · ${cleanName(guildName)}`
    });
  }
  const byXp = entries.slice(0, 10);
  const byLevel = entries.slice().sort((a, b) => (b.level - a.level) || (b.xp - a.xp)).slice(0, 10);
  const n = Math.max(byXp.length, 1);

  const W = 960, PAD = 36, GAP = 22, ROW_H = 40, ROW_GAP = 8, HEAD = 112, FOOT = 52;
  const colW = (W - PAD * 2 - GAP) / 2;
  const H = HEAD + 18 + n * (ROW_H + ROW_GAP) - ROW_GAP + FOOT + 12;

  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);
  ctx.textBaseline = 'alphabetic';

  // Fond + carte
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 10, 10, W - 20, H - 20, 18);
  ctx.fillStyle = C.card; ctx.fill();
  ctx.strokeStyle = C.cardBorder; ctx.lineWidth = 2; ctx.stroke();

  // En-tête
  drawCheck(ctx, PAD + 22, 62, 20);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `700 28px ${MONO_BOLD}`;
  ctx.fillText('Classement', PAD + 56, 64);

  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const totalXp = entries.reduce((s, e) => s + e.xp, 0);
  ctx.fillStyle = C.muted;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(`${mois} · ${fmt(totalXp)} XP · ${totalMembers ?? entries.length} actifs`, PAD + 56, 88);

  // Pastille du serveur (en haut à droite)
  const tag = fit(ctx, cleanName(guildName).toUpperCase(), 220);
  ctx.font = `700 12px ${MONO_BOLD}`;
  const tw = ctx.measureText(tag).width + 38;
  const tx = W - PAD - tw, ty = 44;
  roundRect(ctx, tx, ty, tw, 26, 13);
  ctx.fillStyle = 'rgba(46,229,157,0.10)'; ctx.fill();
  ctx.strokeStyle = C.greenDim; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(tx + 15, ty + 13, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = C.green; ctx.fill();
  ctx.fillStyle = C.green;
  ctx.textAlign = 'left';
  ctx.fillText(tag, tx + 26, ty + 17);

  // Colonnes
  drawColumn(ctx, {
    x: PAD, y: HEAD, w: colW, title: 'TOP XP', rowH: ROW_H, rowGap: ROW_GAP,
    rows: byXp.map(e => ({ name: e.name, value: `${fmt(e.xp)} XP` }))
  });
  drawColumn(ctx, {
    x: PAD + colW + GAP, y: HEAD, w: colW, title: 'TOP NIVEAUX', rowH: ROW_H, rowGap: ROW_GAP,
    rows: byLevel.map(e => ({ name: e.name, value: `Niv. ${e.level}` }))
  });

  // Pied de carte
  const fy = H - 30;
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Source : CoreLab · ${cleanName(guildName)}`, PAD, fy);
  ctx.textAlign = 'right';
  const hh = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  ctx.fillText(`Mis à jour à ${hh}`, W - PAD, fy);

  return canvas.toBuffer('image/png');
}

module.exports = { generateXpLeaderboardImage };
