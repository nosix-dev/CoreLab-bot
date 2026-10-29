'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Image du classement pour /economy leaderboard (top 10 des plus riches)
// Même style que la carte de /economy wallet (fond sombre, accents dorés)
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

// ── Polices (Poppins si présente, sinon police système) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'LeaderboardBold');
    GlobalFonts.registerFromPath(r, 'LeaderboardRegular');
    FONT = 'LeaderboardRegular';
    FONT_BOLD = 'LeaderboardBold';
  }
} catch { /* police système */ }

const RANK_COLORS = ['#f4c542', '#cfd8e3', '#d08a4e']; // or, argent, bronze
const DEFAULT_RANK_COLOR = '#4b5563';

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

// Format FR sans espaces insécables (certaines polices les affichent mal)
function formatAmount(n) {
  return Math.floor(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
}

function drawCrown(ctx, x, y, size, color) {
  const w = size, h = size * 0.72;
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, h); ctx.lineTo(0, h * 0.4);
  ctx.lineTo(w * 0.22, h * 0.75); ctx.lineTo(w * 0.5, h * 0.15);
  ctx.lineTo(w * 0.78, h * 0.75); ctx.lineTo(w, h * 0.4); ctx.lineTo(w, h);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

// Petit losange (rappel de l'emoji 💠 de la monnaie)
function drawGem(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.45); ctx.lineTo(cx + r * 0.45, cy);
  ctx.lineTo(cx, cy + r * 0.45); ctx.lineTo(cx - r * 0.45, cy);
  ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
  ctx.restore();
}

async function loadAvatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * @param {Object} opts
 * @param {string} opts.guildName
 * @param {Array<{name:string, avatarURL?:string, total:number}>} opts.entries  triées, max 10
 * @returns {Promise<Buffer>} PNG
 */
async function generateLeaderboardImage({ guildName, entries, guildId = null }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    const top = entries.slice(0, 10);
    return cc.renderCompact({
      guildId, theme: 'orange', title: '🏆 Classement', sub: guildName,
      grid: top.length > 5 ? 2 : 1, valueMax: 24,
      blocks: top.length
        ? top.map((e, i) => ({ label: `${i + 1}. ${e.name || 'Inconnu'}`, value: formatAmount(e.total) }))
        : [{ label: '', value: 'Aucun score pour le moment' }],
      footerRight: `Top ${top.length}`
    });
  }
  const list = entries.slice(0, 10);
  const twoCols = list.length > 5;
  const PAD = 40, GAP = 24, HEAD = 122, ROW_H = 92, ROW_GAP = 14;
  const W = twoCols ? 1400 : 800;
  const colW = twoCols ? (W - PAD * 2 - GAP) / 2 : W - PAD * 2;
  const perCol = twoCols ? 5 : list.length;
  const H = HEAD + perCol * (ROW_H + ROW_GAP) - ROW_GAP + PAD;

  const avatars = await Promise.all(list.map(e => loadAvatar(e.avatarURL)));

  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId, { also: ['#f4c542'], tintDark: true });
  ctx.textBaseline = 'alphabetic';

  // ── Fond ──
  roundRect(ctx, 0, 0, W, H, 34);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a1a1d'); bg.addColorStop(1, '#050505');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const halo = ctx.createRadialGradient(W - 80, -60, 40, W - 80, -60, 620);
  halo.addColorStop(0, 'rgba(244,197,66,0.18)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);

  // ── En-tête ──
  drawCrown(ctx, PAD, 34, 58, '#f4c542');
  ctx.fillStyle = '#ffffff';
  ctx.font = `42px ${FONT_BOLD}`;
  ctx.fillText('Classement des plus riches', PAD + 82, 66);
  ctx.fillStyle = '#8b8f97';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(fit(ctx, guildName, W - PAD * 2 - 82), PAD + 82, 98);

  // ── Lignes ──
  list.forEach((e, i) => {
    const col = twoCols ? Math.floor(i / 5) : 0;
    const row = twoCols ? i % 5 : i;
    const x = PAD + col * (colW + GAP);
    const y = HEAD + row * (ROW_H + ROW_GAP);
    const color = RANK_COLORS[i] || DEFAULT_RANK_COLOR;
    const podium = i < 3;

    // Carte de la ligne
    ctx.fillStyle = podium ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
    roundRect(ctx, x, y, colW, ROW_H, 20); ctx.fill();
    ctx.strokeStyle = podium ? color : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = podium ? 2.5 : 1.5;
    ctx.stroke();

    // Pastille du rang
    const cy = y + ROW_H / 2;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x + 44, cy, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = podium ? '#141414' : '#ffffff';
    ctx.font = `26px ${FONT_BOLD}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 44, cy + 9);
    ctx.textAlign = 'left';

    // Avatar rond
    const ar = 32, ax = x + 122, ay = cy;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
    if (avatars[i]) {
      ctx.drawImage(avatars[i], ax - ar, ay - ar, ar * 2, ar * 2);
    } else {
      ctx.fillStyle = '#2a2d33'; ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
      ctx.fillStyle = '#9aa0a8'; ctx.font = `30px ${FONT_BOLD}`; ctx.textAlign = 'center';
      ctx.fillText((e.name || '?').charAt(0).toUpperCase(), ax, ay + 11);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, ar + 2, 0, Math.PI * 2); ctx.stroke();

    // Montant (à droite) puis nom (avec la place restante)
    const amount = formatAmount(e.total);
    ctx.font = `30px ${FONT_BOLD}`;
    const amountW = ctx.measureText(amount).width;
    const gemR = 11;
    const rightEdge = x + colW - 26;
    ctx.fillStyle = podium ? color : '#e5e7eb';
    ctx.textAlign = 'right';
    ctx.fillText(amount, rightEdge - gemR * 2 - 10, cy + 11);
    ctx.textAlign = 'left';
    drawGem(ctx, rightEdge - gemR, cy, gemR, podium ? color : '#8ec9ff');

    const nameX = x + 122 + ar + 20;
    const nameMax = rightEdge - gemR * 2 - 10 - amountW - 24 - nameX;
    ctx.fillStyle = '#ffffff';
    ctx.font = `30px ${FONT_BOLD}`;
    ctx.fillText(fit(ctx, e.name || 'Inconnu', Math.max(nameMax, 60)), nameX, cy + 11);
  });

  return canvas.toBuffer('image/png');
}

module.exports = { generateLeaderboardImage };
