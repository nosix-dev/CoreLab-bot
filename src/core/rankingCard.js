'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte image (canvas) verte pour les classements : quiz, pendu, devine,
// mots enchaînés, clans… Même style que la carte de /protect-settings.
// Envoyée en Components V2 : titre + grande image + petite note.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags
} = require('discord.js');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx, containerAccent } = require('./cardTheme');
const compactCard = require('./compactCard');

// ── Police (même logique que protectCard.js) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'RankCardBold');
    GlobalFonts.registerFromPath(r, 'RankCard');
    FONT = 'RankCard';
    FONT_BOLD = 'RankCardBold';
  }
} catch { /* police système */ }

const OK = '#3ddc84';
const MEDALS = ['#f5c542', '#c4ccd4', '#cd8a4b']; // or, argent, bronze

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
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/**
 * @param {object} o
 * @param {string} o.title     ex. "Classement Quiz"
 * @param {string} o.subtitle  ex. "3 joueurs"
 * @param {string} [o.badge]   ex. "QUIZ"
 * @param {{name:string,value:string}[]} o.rows  déjà triées (10 max)
 * @returns {Buffer} PNG
 */
function renderRankingCard({ title, subtitle, badge = 'CLASSEMENT', rows, guildId = null }) {
  if (compactCard.isCompact(guildId)) return compactCard.renderCompactSync(compactCard.rankingSpec({ title, subtitle, badge, rows, guildId }));
  const PAD = 26, GAP = 10, ROW_H = 58, W = 1240, HEAD = 112;
  const list = rows.length ? rows : [{ name: 'Aucun score pour le moment', value: '', empty: true }];
  const H = HEAD + list.length * (ROW_H + GAP) - GAP + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);

  // Fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12291c');
  bg.addColorStop(1, '#090e0b');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  // Pastille ronde + coche
  ctx.fillStyle = OK;
  ctx.beginPath(); ctx.arc(PAD + 30, 56, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a1a10'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(PAD + 17, 57); ctx.lineTo(PAD + 27, 68); ctx.lineTo(PAD + 45, 45); ctx.stroke();

  // Titre + sous-titre
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, title, 760), PAD + 78, 56);
  ctx.fillStyle = '#8fa398';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(subtitle, PAD + 78, 86);

  // Pastille (badge)
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(badge).width + 58;
  ctx.fillStyle = OK + '33';
  roundRect(ctx, W - PAD - pw, 34, pw, 44, 22); ctx.fill();
  ctx.fillStyle = OK;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 56, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(badge, W - PAD - pw + 38, 63);

  // Lignes
  list.forEach((r, i) => {
    const x = PAD, y = HEAD + i * (ROW_H + GAP), w = W - PAD * 2;
    const first = i === 0 && !r.empty;

    ctx.fillStyle = first ? '#14351f' : '#171c19';
    roundRect(ctx, x, y, w, ROW_H, 14); ctx.fill();
    ctx.strokeStyle = first ? '#2c7d4d' : '#2a312d';
    ctx.lineWidth = 2; ctx.stroke();

    const cy = y + ROW_H / 2;
    let textX = x + 26;

    if (!r.empty) {
      // Rang : médaille (top 3) ou pastille grise
      ctx.fillStyle = i < 3 ? MEDALS[i] : '#2a332d';
      ctx.beginPath(); ctx.arc(x + 36, cy, 19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i < 3 ? '#1b1b1b' : '#aab6af';
      ctx.font = `22px ${FONT_BOLD}`;
      const n = String(i + 1);
      ctx.fillText(n, x + 36 - ctx.measureText(n).width / 2, cy + 8);
      textX = x + 74;
    }

    // Valeur à droite
    ctx.font = `27px ${FONT_BOLD}`;
    ctx.fillStyle = OK;
    const vw = r.value ? ctx.measureText(r.value).width : 0;
    if (r.value) ctx.fillText(r.value, x + w - 28 - vw, cy + 9);

    // Nom
    ctx.font = `27px ${FONT_BOLD}`;
    ctx.fillStyle = r.empty ? '#9aa6a0' : '#ffffff';
    ctx.fillText(fit(ctx, r.name, w - (textX - x) - vw - 60), textX, cy + 9);
  });

  return canvas.toBuffer('image/png');
}

/**
 * Payload Components V2 prêt pour interaction.reply().
 * @param {object} o  mêmes champs que renderRankingCard (dont guildId = thème) + :
 * @param {string} o.heading  titre markdown au-dessus de l'image, ex. "## 🧠 Classement Quiz"
 * @param {string} [o.note]   petite ligne sous l'image
 */
function buildRankingPayload({ heading, note, ...card }) {
  const file = new AttachmentBuilder(renderRankingCard(card), { name: 'classement.png' });
  const container = new ContainerBuilder().setAccentColor(containerAccent(card.guildId, 0xFFFFFF));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://classement.png'))
  );
  if (note) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(note).slice(0, 500)));
  }
  return {
    components: [container],
    files: [file],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

/**
 * Pseudos affichables pour une liste d'ids (une image ne peut pas contenir de mention).
 * Cache d'abord ; sinon REST users.fetch (pas de requête gateway → pas de rate limit membres).
 * @returns {Promise<Map<string,string>>}
 */
async function resolveNames(guild, ids) {
  const out = new Map();
  await Promise.all(ids.map(async (id) => {
    const m = guild.members.cache.get(id);
    if (m) return out.set(id, m.displayName);
    const cached = guild.client.users.cache.get(id);
    if (cached) return out.set(id, cached.globalName || cached.username);
    try {
      const u = await guild.client.users.fetch(id);
      out.set(id, u.globalName || u.username);
    } catch {
      out.set(id, 'Utilisateur inconnu');
    }
  }));
  return out;
}

module.exports = { renderRankingCard, buildRankingPayload, resolveNames };
