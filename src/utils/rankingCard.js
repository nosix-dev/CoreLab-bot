// utils/rankingCard.js
// Carte image verte (même style que /protect-settings) pour tous les classements.
const { createCanvas } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme'); // si tu utilises 'canvas', change juste cette ligne
const { AttachmentBuilder } = require('discord.js');
const compactCard = require('../core/compactCard');

const FONT = 'DejaVu Sans Mono, Consolas, monospace'; // remplace par la police de protect-settings si besoin
const GREEN = '#2ecc71';
const MEDAL_COLORS = ['#f1c40f', '#bdc3c7', '#cd7f32']; // or, argent, bronze

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cut(ctx, text, maxW) {
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === String(text) ? t : t.slice(0, -1) + '…';
}

/**
 * @param {object} o
 * @param {string} o.title     "Classement Quiz"
 * @param {string} o.subtitle  "3 joueurs"
 * @param {string} [o.badge]   "QUIZ"
 * @param {{name:string,value:string}[]} o.rows  déjà triées (max ~10)
 * @param {string} [o.filename]
 */
function buildRankingCard({ title, subtitle, badge = 'CLASSEMENT', rows, filename = 'classement.png', guildId = null }) {
  if (compactCard.isCompact(guildId)) return new AttachmentBuilder(compactCard.renderCompactSync(compactCard.rankingSpec({ title, subtitle, badge, rows, guildId })), { name: filename });
  const list = rows.length ? rows : [{ name: 'Aucun résultat pour le moment', value: '' }];
  const W = 560, rowH = 42, gap = 8;
  const H = 108 + list.length * (rowH + gap) + 16;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);

  // fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a1610');
  bg.addColorStop(1, '#10301e');
  rr(ctx, 2, 2, W - 4, H - 4, 18);
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(46,204,113,0.35)'; ctx.lineWidth = 2; ctx.stroke();

  // pastille check
  ctx.fillStyle = GREEN;
  ctx.beginPath(); ctx.arc(48, 54, 18, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a1610'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(40, 54); ctx.lineTo(46, 60); ctx.lineTo(57, 47); ctx.stroke();

  // titre
  ctx.fillStyle = '#f4f4f4';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(cut(ctx, title, 330), 80, 52);
  ctx.fillStyle = '#93a59b';
  ctx.font = `14px ${FONT}`;
  ctx.fillText(subtitle, 80, 74);

  // badge
  ctx.font = `bold 12px ${FONT}`;
  const bw = ctx.measureText(badge).width + 38;
  const bx = W - bw - 26;
  rr(ctx, bx, 38, bw, 26, 13);
  ctx.fillStyle = 'rgba(46,204,113,0.15)'; ctx.fill();
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = GREEN;
  ctx.beginPath(); ctx.arc(bx + 14, 51, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(badge, bx + 26, 55);

  // lignes
  let y = 96;
  list.forEach((r, i) => {
    rr(ctx, 24, y, W - 48, rowH, 9);
    ctx.fillStyle = i === 0 ? 'rgba(46,204,113,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = i === 0 ? GREEN : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1; ctx.stroke();

    // rang : médaille dessinée pour le top 3, pastille grise sinon
    const cy = y + rowH / 2;
    if (rows.length) {
      ctx.fillStyle = i < 3 ? MEDAL_COLORS[i] : '#33433a';
      ctx.beginPath(); ctx.arc(46, cy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i < 3 ? '#1a1a1a' : '#b5c4bb';
      ctx.font = `bold 13px ${FONT}`;
      const n = String(i + 1);
      ctx.fillText(n, 46 - ctx.measureText(n).width / 2, cy + 5);
    }

    // valeur à droite
    ctx.font = `bold 15px ${FONT}`;
    const vw = ctx.measureText(r.value).width;
    ctx.fillStyle = GREEN;
    ctx.fillText(r.value, W - 42 - vw, cy + 5);

    // nom
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText(cut(ctx, r.name, W - 48 - 84 - vw - 20), rows.length ? 70 : 44, cy + 5);
    y += rowH + gap;
  });

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: filename });
}

/** Renvoie directement { files } (carte seule, sans embed) prêt pour interaction.reply() */
function rankingReply(opts) {
  const file = buildRankingCard(opts);
  return { files: [file] };
}

module.exports = { buildRankingCard, rankingReply };
