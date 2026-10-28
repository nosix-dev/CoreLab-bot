'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Cartes « verre fumé » universelles (glassmorphism)
//
//  • renderGlassEmbed(embed, opts)  : transforme N'IMPORTE QUEL embed (titre, description, champs,
//    miniature, image, footer) en carte image verre dépoli (même rendu que la carte de niveau).
//  • glassPayload(payload, opts)    : comme toCV2Payload() mais l'embed devient une carte image
//    (Components V2 : conteneur + image, boutons conservés). Retombe sur toCV2Payload en cas d'erreur.
//  • glassReply(interaction, payload, opts) : reply / followUp selon l'état de l'interaction.
//  • renderWelcomeCard(o)           : carte de bienvenue / au revoir (avatar + compteur de membres).
//
// Particularités :
//  - les mentions <@id> <@&id> <#id> et les horodatages <t:...> sont convertis en texte lisible ;
//  - le markdown est retiré ; les lignes « Label : valeur » deviennent des pastilles de verre ;
//  - une valeur en % ou une barre ▓▓░░ devient une barre de progression en verre ;
//  - le thème (/card-style : couleur, fond, style clair) est respecté.
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
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { getTheme, containerAccent } = require('./cardTheme');
const glass = require('./glassCard');
const { preloadEmojis, measureRich, drawRich, splitUnits, tokenize } = require('./cardEmoji');
const { toCV2Payload } = require('./componentsV2');

// ── Polices (Poppins si présente, sinon police système) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'GlassEmbedBold');
    GlobalFonts.registerFromPath(r, 'GlassEmbedRegular');
    FONT = 'GlassEmbedRegular';
    FONT_BOLD = 'GlassEmbedBold';
  }
} catch { /* police système */ }

const W = 1100;
const OUT = 14;   // marge extérieure du panneau
const PAD = 58;   // marge intérieure
const TOP = 46;
const INNER_W = W - 2 * OUT - 2 * PAD;
const X0 = OUT + PAD;

const DARK = { text: '#ffffff', muted: 'rgba(255,255,255,0.62)', pill: 'rgba(255,255,255,0.07)', light: false };
const LIGHT = { text: '#14181d', muted: 'rgba(20,24,29,0.62)', pill: 'rgba(255,255,255,0.55)', light: true };

// ─────────────────────────────────────────────────────────────────────────
// Texte : mentions, horodatages, markdown
// ─────────────────────────────────────────────────────────────────────────

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const pad2 = n => String(n).padStart(2, '0');

function fmtDate(ts, style) {
  const d = new Date(ts * 1000);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  switch (style) {
    case 't': return time;
    case 'T': return `${time}:${pad2(d.getSeconds())}`;
    case 'd': return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
    case 'F': case 'f': return `${date} à ${time}`;
    default: return date;
  }
}

function relative(ts) {
  const diff = ts * 1000 - Date.now();
  const a = Math.abs(diff) / 1000;
  let n; let u;
  if (a < 60) { n = Math.max(1, Math.round(a)); u = n > 1 ? 'secondes' : 'seconde'; }
  else if (a < 3600) { n = Math.round(a / 60); u = 'min'; }
  else if (a < 86400) { n = Math.round(a / 3600); u = 'h'; }
  else if (a < 86400 * 30) { n = Math.round(a / 86400); u = n > 1 ? 'jours' : 'jour'; }
  else if (a < 86400 * 365) { n = Math.round(a / (86400 * 30)); u = 'mois'; }
  else { n = Math.round(a / (86400 * 365)); u = n > 1 ? 'ans' : 'an'; }
  return diff >= 0 ? `dans ${n} ${u}` : `il y a ${n} ${u}`;
}

async function resolveMentions(texts, guild, client) {
  const m = { users: new Map(), roles: new Map(), channels: new Map() };
  const all = texts.filter(Boolean).join('\n');
  const uids = new Set(); const rids = new Set(); const cids = new Set();
  for (const x of all.matchAll(/<@!?(\d+)>/g)) uids.add(x[1]);
  for (const x of all.matchAll(/<@&(\d+)>/g)) rids.add(x[1]);
  for (const x of all.matchAll(/<#(\d+)>/g)) cids.add(x[1]);
  const cl = client || (guild && guild.client) || null;
  await Promise.all([...uids].map(async (id) => {
    const mem = guild && guild.members && guild.members.cache.get(id);
    if (mem) return m.users.set(id, mem.displayName);
    const cached = cl && cl.users.cache.get(id);
    if (cached) return m.users.set(id, cached.globalName || cached.username);
    try {
      const u = cl && await cl.users.fetch(id);
      m.users.set(id, u ? (u.globalName || u.username) : 'inconnu');
    } catch { m.users.set(id, 'inconnu'); }
  }));
  for (const id of rids) m.roles.set(id, (guild && guild.roles && guild.roles.cache.get(id)?.name) || 'rôle');
  for (const id of cids) m.channels.set(id, (guild && guild.channels && guild.channels.cache.get(id)?.name) || 'salon');
  return m;
}

function clean(str, m) {
  let s = String(str ?? '');
  s = s
    .replace(/<@!?(\d+)>/g, (_, id) => '@' + (m.users.get(id) || 'inconnu'))
    .replace(/<@&(\d+)>/g, (_, id) => '@' + (m.roles.get(id) || 'rôle'))
    .replace(/<#(\d+)>/g, (_, id) => '#' + (m.channels.get(id) || 'salon'))
    .replace(/<t:(-?\d+)(?::([a-zA-Z]))?>/g, (_, ts, st) => (st === 'R' ? relative(+ts) : fmtDate(+ts, st)))
    .replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, '$1')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\|\|(.+?)\|\|/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^\s*-#\s?/gm, '')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+\n/g, '\n');
  return s.trim();
}

function wrapRich(ctx, text, family, size, maxW, maxLines) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? `${line} ${w}` : w;
      if (measureRich(ctx, test, family, size) <= maxW) { line = test; continue; }
      if (line) out.push(line);
      if (measureRich(ctx, w, family, size) > maxW) {
        let chunk = '';
        for (const u of splitUnits(w)) {
          if (measureRich(ctx, chunk + u, family, size) > maxW) { out.push(chunk); chunk = u; } else chunk += u;
        }
        line = chunk;
      } else line = w;
    }
    if (line) out.push(line);
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = out[maxLines - 1].replace(/[\s.,;:]*$/, '') + '…';
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Images (avatars, bannière)
// ─────────────────────────────────────────────────────────────────────────

async function loadRemote(url) {
  if (!url) return null;
  try {
    let u = String(url);
    if (/cdn\.discordapp\.com/.test(u)) u = u.replace(/\.webp(\?|$)/, '.png$1');
    const res = await fetch(u, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch { return null; }
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s; const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawAvatar(ctx, img, cx, cy, r, P) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  ctx.restore();
  if (img) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0.55)');
  ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = P.light ? 'rgba(20,24,29,0.35)' : g;
  ctx.lineWidth = 4; ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────
// Fond + palette selon le thème (/card-style)
// ─────────────────────────────────────────────────────────────────────────

function makeBackdrop(H, theme, custom = {}) {
  const light = theme.look === 'clair';
  let back;
  if (custom.bgHex) {
    back = createCanvas(W, H);
    const c = back.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(custom.bgHex, light ? 0.25 : -0.25));
    g.addColorStop(0.5, custom.bgHex);
    g.addColorStop(1, shade(custom.bgHex, light ? 0.1 : -0.5));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  } else if (light) {
    back = createCanvas(W, H);
    const c = back.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#eef1f5'); g.addColorStop(0.5, '#cfd6e0'); g.addColorStop(1, '#e4e8ef');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  } else {
    back = glass.glassBackdrop(W, H, theme.accent, false, theme);
  }
  if (custom.bgImg) drawCover(back.getContext('2d'), custom.bgImg, 0, 0, W, H);
  return { back, blur: glass.blurred(back, W, H), P: light ? LIGHT : DARK, tint: light ? 'rgba(255,255,255,0.5)' : glass.tintFor(theme, 0.55) };
}

function colorHex(c) {
  if (c === undefined || c === null || Number.isNaN(Number(c))) return null;
  return '#' + (Number(c) & 0xFFFFFF).toString(16).padStart(6, '0');
}

// ─────────────────────────────────────────────────────────────────────────
// Analyse de l'embed → éléments de mise en page
// ─────────────────────────────────────────────────────────────────────────

const STAT_RE = /^(.{2,34}?)\s*:\s+(.+)$/;
const BAR_RE = /([█▓▇■▰🟩🟦🟥🟧🟨🟪]+)([░▒▁□▱⬜⬛]*)/u;
const PCT_RE = /(\d{1,3}(?:[.,]\d+)?)\s*%/;

function parseStat(line) {
  const m = line.match(STAT_RE);
  if (!m) return null;
  const label = m[1].trim(); let value = m[2].trim();
  if (value.startsWith('//')) return null;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(label)) return null;
  if (label.split(' ').length > 5) return null;
  return makePill(label, value);
}

function makePill(label, value, forceFull = false) {
  let ratio = null;
  const bar = value.match(BAR_RE);
  if (bar) {
    const f = Array.from(bar[1]).length; const t = f + Array.from(bar[2]).length;
    if (t >= 4) { ratio = f / t; value = value.replace(BAR_RE, '').replace(/\s{2,}/g, ' ').trim(); }
  }
  value = value.replace(/[░▒▁□▱]{3,}/gu, '').replace(/\s{2,}/g, ' ').trim();
  if (ratio === null) {
    const p = value.match(PCT_RE);
    if (p) ratio = Math.max(0, Math.min(1, parseFloat(p[1].replace(',', '.')) / 100));
  }
  return { label, value: value || '—', ratio, full: forceFull };
}

// Ligne de « symboles » (ex. [ 🍒 | 🍋 | 7️⃣ ]) : affichée en grand et centrée
function isHero(line) {
  const stripped = line.replace(/[\[\]|·•,\s]/g, '');
  if (!stripped || stripped.length > 40) return false;
  const toks = tokenize(stripped);
  return toks.length >= 1 && toks.length <= 8 && toks.every(t => t.t === 'emoji');
}

function blocksFromEmbed(data, m) {
  const blocks = [];
  let pills = [];
  const flush = () => { if (pills.length) { blocks.push({ t: 'pills', pills }); pills = []; } };
  const desc = clean(data.description || '', m);
  for (const raw of desc.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); blocks.push({ t: 'gap' }); continue; }
    const pill = parseStat(line);
    if (pill) pills.push(pill);
    else { flush(); blocks.push(isHero(line) ? { t: 'hero', v: line.replace(/^\s*\[\s*|\s*\]\s*$/g, '').replace(/\|/g, '  ') } : { t: 'text', v: line }); }
  }
  flush();
  const fields = (data.fields || []).map(f => ({ n: clean(f.name, m), v: clean(f.value, m), inline: f.inline })).filter(f => f.n || f.v);
  if (fields.length) {
    blocks.push({ t: 'gap' });
    blocks.push({ t: 'pills', pills: fields.map(f => makePill(f.n || '—', f.v || '—', f.inline === false)) });
  }
  while (blocks.length && blocks[0].t === 'gap') blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].t === 'gap') blocks.pop();
  return blocks.filter((b, i) => !(b.t === 'gap' && blocks[i - 1] && blocks[i - 1].t === 'gap'));
}

// ─────────────────────────────────────────────────────────────────────────
// Rendu d'un embed
// ─────────────────────────────────────────────────────────────────────────

const LINE_H = 40;
const PILL_GAP = 16;

function layoutPills(ctx, pills) {
  const half = (INNER_W - PILL_GAP) / 2;
  for (const p of pills) {
    const natural = measureRich(ctx, p.value, FONT_BOLD, 28);
    if (!p.full && natural > half - 52) p.full = true;
  }
  const rows = [];
  let cur = null;
  for (const p of pills) {
    if (p.full) { if (cur) { rows.push([cur]); cur = null; } rows.push([p]); continue; }
    if (cur) { rows.push([cur, p]); cur = null; } else cur = p;
  }
  if (cur) rows.push([cur]);
  return rows.map(row => {
    const items = row.map((p) => {
      const w = p.full ? INNER_W : half;
      const lines = wrapRich(ctx, p.value, FONT_BOLD, 28, w - 52, p.full ? 5 : 3);
      const h = 18 + 26 + 6 + lines.length * 36 + (p.ratio !== null ? 30 : 0) + 18;
      return { p, w, lines, h };
    });
    return { items, h: Math.max(...items.map(i => i.h)) };
  });
}

/**
 * @param {object} embed  EmbedBuilder ou objet brut
 * @param {object} [o]
 * @param {object} [o.guild] @param {string} [o.guildId] @param {object} [o.client]
 * @param {string} [o.badge]      petit libellé au-dessus du titre (ex. « SANCTION »)
 * @param {Array<string|object>} [o.versus]  2 avatars face à face (URL ou User) à la place de la miniature
 * @param {string} [o.versusIcon] emoji au centre des deux avatars
 * @param {string} [o.avatar]     URL d'avatar forcée (sinon miniature de l'embed)
 * @param {string} [o.footer]     texte de pied de carte forcé
 * @returns {Promise<Buffer>}
 */
async function renderGlassEmbed(embed, o = {}) {
  const data = (embed && typeof embed.toJSON === 'function') ? embed.toJSON() : (embed || {});
  const guildId = o.guildId || (o.guild && o.guild.id) || null;
  const theme = getTheme(guildId);

  const rawTexts = [data.title, data.description, data.author && data.author.name, data.footer && data.footer.text,
    ...(data.fields || []).flatMap(f => [f.name, f.value])];
  const m = await resolveMentions(rawTexts, o.guild, o.client);

  const title = clean(data.title || (data.author && data.author.name) || '', m);
  const badge = clean(o.badge || (data.title && data.author && data.author.name) || '', m).toUpperCase();
  let footer = clean(o.footer !== undefined ? o.footer : (data.footer && data.footer.text) || '', m);
  if (data.timestamp) {
    const ts = Math.floor(new Date(data.timestamp).getTime() / 1000);
    footer += (footer ? '  ·  ' : '') + fmtDate(ts, 'f');
  }
  const blocks = blocksFromEmbed(data, m);

  // images
  const urlOf = v => (v && (typeof v === 'string' ? v : (typeof v.displayAvatarURL === 'function' ? v.displayAvatarURL({ extension: 'png', size: 256 }) : null)));
  const versusUrls = (o.versus || []).map(urlOf).filter(Boolean);
  const thumbUrl = o.avatar || (data.thumbnail && data.thumbnail.url) || (data.author && (data.author.icon_url || data.author.iconURL)) || null;
  const [versusImgs, thumbImg, bannerImg] = await Promise.all([
    Promise.all(versusUrls.map(loadRemote)),
    versusUrls.length ? null : loadRemote(thumbUrl),
    loadRemote(data.image && data.image.url)
  ]);

  const emojiTexts = [title, footer, o.versusIcon, ...blocks.flatMap(b => (b.t === 'text' || b.t === 'hero') ? [b.v] : b.t === 'pills' ? b.pills.flatMap(p => [p.label, p.value]) : [])];
  await preloadEmojis(emojiTexts);

  // ── Mise en page (mesures) ──
  const ctx0 = createCanvas(10, 10).getContext('2d');
  const hasVersus = versusUrls.length >= 2;
  const hasThumb = !hasVersus && !!thumbImg;
  const sideW = hasVersus ? 360 : hasThumb ? 160 : 0;
  const headW = INNER_W - sideW;
  const titleLines = title ? wrapRich(ctx0, title, FONT_BOLD, 44, headW, 2) : [];
  const badgeH = badge ? 36 : 0;
  const headTextH = badgeH + titleLines.length * 56;
  const avatarBlockH = hasVersus ? 132 : hasThumb ? 132 : 0;
  const headH = Math.max(headTextH, avatarBlockH);

  let y = TOP + headH;
  const items = [];
  const bodyStart = y;
  for (const b of blocks) {
    if (b.t === 'gap') { y += 16; items.push({ ...b, y: y - 16, h: 16 }); continue; }
    if (b.t === 'text') {
      const lines = wrapRich(ctx0, b.v, FONT, 28, INNER_W, 8);
      if (!items.length || items[items.length - 1].t !== 'gap') { /* espacement initial */ }
      items.push({ t: 'text', y: y + 18, lines, h: lines.length * LINE_H });
      y += 18 + lines.length * LINE_H;
      continue;
    }
    if (b.t === 'hero') {
      items.push({ t: 'hero', y: y + 14, v: b.v, h: 96 });
      y += 14 + 96;
      continue;
    }
    if (b.t === 'pills') {
      y += 18;
      const rows = layoutPills(ctx0, b.pills);
      for (const r of rows) { items.push({ t: 'row', y, row: r, h: r.h }); y += r.h + PILL_GAP; }
      y -= PILL_GAP;
    }
  }
  if (bannerImg) { y += 26; items.push({ t: 'banner', y, h: 300 }); y += 300; }
  if (footer) { y += 30; items.push({ t: 'footer', y, h: 24 }); y += 24; }
  const H = Math.ceil(y + TOP - 4 + OUT);
  void bodyStart;

  // ── Dessin ──
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const { back, blur, P, tint } = makeBackdrop(H, theme);
  glass.glassPanel(ctx, back, blur, OUT, OUT, W - 2 * OUT, H - 2 * OUT, 44, { tint });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // en-tête
  let ty = TOP;
  if (badge) {
    const dot = colorHex(data.color) || '#ffffff';
    ctx.beginPath(); ctx.arc(X0 + 8, ty + 14, 8, 0, Math.PI * 2);
    ctx.save(); ctx.shadowColor = dot; ctx.shadowBlur = 14; ctx.fillStyle = dot; ctx.fill(); ctx.restore();
    ctx.fillStyle = P.muted; ctx.font = `20px ${FONT_BOLD}`;
    ctx.fillText(badge, X0 + 28, ty + 21);
    ty += badgeH;
  }
  titleLines.forEach((ln, i) => drawRich(ctx, ln, X0, ty + 42 + i * 56, FONT_BOLD, 44, { color: P.text }));

  if (hasVersus) {
    const r = 62; const cyA = TOP + 66;
    const cxB = X0 + INNER_W - r; const cxA = cxB - 168;
    drawAvatar(ctx, versusImgs[0], cxA, cyA, r, P);
    drawAvatar(ctx, versusImgs[1], cxB, cyA, r, P);
    const mx = (cxA + cxB) / 2;
    glass.glassPanel(ctx, back, blur, mx - 28, cyA - 28, 56, 56, 28, { tint: P.pill });
    if (o.versusIcon) drawRich(ctx, o.versusIcon, mx, cyA + 11, FONT_BOLD, 30, { color: P.text, align: 'center' });
  } else if (hasThumb && o.thumbSquare) {
    const sz = 140; const sx = X0 + INNER_W - sz; const sy = TOP;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    glass.roundRect(ctx, sx, sy, sz, sz, 28); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    ctx.restore();
    ctx.save(); glass.roundRect(ctx, sx, sy, sz, sz, 28); ctx.clip();
    drawCover(ctx, thumbImg, sx, sy, sz, sz);
    ctx.restore();
    glass.roundRect(ctx, sx, sy, sz, sz, 28);
    ctx.strokeStyle = P.light ? 'rgba(20,24,29,0.35)' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.stroke();
  } else if (hasThumb) {
    drawAvatar(ctx, thumbImg, X0 + INNER_W - 66, TOP + 66, 66, P);
  }

  // corps
  for (const it of items) {
    if (it.t === 'text') {
      it.lines.forEach((ln, i) => { if (ln) drawRich(ctx, ln, X0, it.y + 30 + i * LINE_H, FONT, 28, { color: P.text }); });
    } else if (it.t === 'hero') {
      glass.glassPanel(ctx, back, blur, X0, it.y, INNER_W, it.h, 30, { tint: P.pill });
      drawRich(ctx, it.v, X0 + INNER_W / 2, it.y + 68, FONT_BOLD, 56, { color: P.text, align: 'center' });
    } else if (it.t === 'row') {
      let x = X0;
      for (const cell of it.row.items) {
        const { p, w, lines } = cell; const h = it.row.h;
        glass.glassPanel(ctx, back, blur, x, it.y, w, h, 24, { tint: P.pill });
        drawRich(ctx, p.label, x + 26, it.y + 18 + 20, FONT, 20, { color: P.muted });
        lines.forEach((ln, i) => drawRich(ctx, ln, x + 26, it.y + 18 + 26 + 6 + 26 + i * 36, FONT_BOLD, 28, { color: P.text }));
        if (p.ratio !== null) glass.glassBar(ctx, x + 26, it.y + h - 18 - 16, w - 52, 14, p.ratio);
        x += w + PILL_GAP;
      }
    } else if (it.t === 'banner') {
      ctx.save();
      glass.roundRect(ctx, X0, it.y, INNER_W, it.h, 26); ctx.clip();
      drawCover(ctx, bannerImg, X0, it.y, INNER_W, it.h);
      ctx.restore();
      glass.roundRect(ctx, X0, it.y, INNER_W, it.h, 26);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    } else if (it.t === 'footer') {
      drawRich(ctx, footer, X0, it.y + 18, FONT, 20, { color: P.muted });
    }
  }

  return canvas.toBuffer('image/png');
}

// ─────────────────────────────────────────────────────────────────────────
// Carte de bienvenue / au revoir
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} [o.guildId]
 * @param {'welcome'|'goodbye'} [o.kind]
 * @param {string} o.username
 * @param {string} [o.avatarUrl]
 * @param {string} [o.serverName]
 * @param {number} [o.memberCount]
 * @param {number} [o.createdTs]  création du compte (ms)
 * @param {number} [o.joinedTs]   arrivée sur le serveur (ms)
 * @param {string} [o.subtitle]   texte libre sous le pseudo
 * @returns {Promise<Buffer>}
 */
// ── Personnalisation de la carte de bienvenue / au revoir ──────────────────
// Réglages stockés dans cfg.welcome_card / cfg.goodbye_card (voir core/welcomeCardConfig.js) :
//   title, subtitle, pillMember, pillCreated, pillJoined  (texte ; « - » = masquer la pastille/le titre)
//   style ('clair' | 'sombre'), accent, bg, textColor (hex), hideAvatar (bool)
// + image de fond optionnelle : card_backgrounds/<guildId>_<welcome|goodbye>.<ext>
const CARD_BG_DIR = path.join(__dirname, '..', '..', 'card_backgrounds');
const CARD_BG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

function findCardBackground(guildId, kind) {
  for (const ext of CARD_BG_EXTS) {
    const filePath = path.join(CARD_BG_DIR, `${guildId}_${kind}.${ext}`);
    if (fs.existsSync(filePath)) return { filePath, ext };
  }
  return null;
}

function validHex(v) {
  const m = String(v ?? '').trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function shade(hex, amt) { // amt > 0 éclaircit, < 0 assombrit
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function applyCardPlaceholders(text, o) {
  return String(text)
    .replace(/\{(?:user\.name|user\.mention|membre)\}/g, String(o.username || 'Membre'))
    .replace(/\{(?:server\.name|serveur)\}/g, String(o.serverName || ''))
    .replace(/\{(?:server\.member_count|nombre_membres)\}/g, Number.isFinite(o.memberCount) ? String(o.memberCount) : '');
}

async function renderWelcomeCard(o) {
  const H = 440;
  const card = o.card || {};
  const kind = o.kind === 'goodbye' ? 'goodbye' : 'welcome';
  const baseTheme = getTheme(o.guildId);
  const accent = validHex(card.accent);
  const theme = {
    ...baseTheme,
    ...(card.style === 'sombre' ? { look: 'fume' } : card.style === 'clair' ? { look: 'clair' } : {}),
    ...(accent ? { accent } : {})
  };
  const img = card.hideAvatar ? null : await loadRemote(o.avatarUrl);
  const custom = t => (typeof t === 'string' && t.trim() ? applyCardPlaceholders(t.trim(), o) : null);
  const hidden = t => typeof t === 'string' && t.trim() === '-';

  const title = custom(card.title) || (kind === 'goodbye' ? 'AU REVOIR' : 'BIENVENUE');
  const username = String(o.username || 'Membre');
  const server = String(o.serverName || '');
  const sub = custom(card.subtitle) || o.subtitle || (kind === 'goodbye'
    ? (server ? `a quitté ${server}` : 'a quitté le serveur')
    : (server ? `vient de rejoindre ${server}` : 'vient de rejoindre le serveur'));
  const pills = [];
  if (Number.isFinite(o.memberCount) && !hidden(card.pillMember)) {
    pills.push({ l: custom(card.pillMember) || (kind === 'goodbye' ? 'MEMBRES RESTANTS' : 'MEMBRE N°'), v: Number(o.memberCount).toLocaleString('fr-FR') });
  }
  if (o.createdTs && !hidden(card.pillCreated)) {
    pills.push({ l: custom(card.pillCreated) || 'COMPTE CRÉÉ', v: fmtDate(Math.floor(o.createdTs / 1000), 'd') });
  }
  if (kind === 'goodbye' && o.joinedTs && !hidden(card.pillJoined)) {
    pills.push({ l: custom(card.pillJoined) || 'ARRIVÉ LE', v: fmtDate(Math.floor(o.joinedTs / 1000), 'd') });
  }
  await preloadEmojis([username, sub, title, ...pills.map(p => p.l)]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bgHex = validHex(card.bg);
  const bgFile = findCardBackground(o.guildId, kind);
  const bgImg = bgFile ? await loadImage(bgFile.filePath).catch(() => null) : null;
  const { back, blur, P: baseP, tint } = makeBackdrop(H, theme, { bgHex, bgImg });
  const textHex = validHex(card.textColor);
  const P = textHex ? { ...baseP, text: textHex, muted: shade(textHex, baseP.light ? 0.35 : -0.35) } : baseP;
  glass.glassPanel(ctx, back, blur, OUT, OUT, W - 2 * OUT, H - 2 * OUT, 44, { tint });
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  // avatar dans une grande pastille de verre
  if (!card.hideAvatar) {
    glass.glassPanel(ctx, back, blur, X0 - 8, 92, 256, 256, 52, { tint: P.pill });
    drawAvatar(ctx, img, X0 + 120, 220, 100, P);
  }

  const tx = card.hideAvatar ? X0 : X0 + 292; const tw = W - OUT - PAD - tx;
  ctx.fillStyle = P.muted; ctx.font = `22px ${FONT_BOLD}`;
  if (!hidden(card.title)) ctx.fillText(title, tx, 118);
  const size = (() => { let s = 60; while (s > 28 && measureRich(ctx, username, FONT_BOLD, s) > tw) s -= 2; return s; })();
  drawRich(ctx, username, tx, 118 + 18 + size, FONT_BOLD, size, { color: P.text });
  const lines = wrapRich(ctx, sub, FONT, 26, tw, 2);
  lines.forEach((ln, i) => drawRich(ctx, ln, tx, 118 + 18 + size + 46 + i * 34, FONT, 26, { color: P.muted }));

  // pastilles de stats
  const pw = Math.floor((tw - 16 * (pills.length - 1)) / Math.max(1, pills.length));
  pills.forEach((p, i) => {
    const px = tx + i * (pw + 16); const py = 312;
    glass.glassPanel(ctx, back, blur, px, py, pw, 80, 26, { tint: P.pill });
    ctx.fillStyle = P.muted; ctx.font = `15px ${FONT_BOLD}`;
    ctx.fillText(p.l, px + 22, py + 30);
    drawRich(ctx, p.v, px + 22, py + 62, FONT_BOLD, 28, { color: P.text });
  });

  return canvas.toBuffer('image/png');
}

// ─────────────────────────────────────────────────────────────────────────
// Payloads Discord
// ─────────────────────────────────────────────────────────────────────────

let seq = 0;
const uniq = prefix => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}.png`;

/**
 * Remplace toCV2Payload() : chaque embed devient une carte image en verre fumé.
 * Les boutons / menus (`components`), le `content`, `ephemeral` et `files` sont conservés.
 * @param {object} payload  { embeds, components, content, ephemeral, flags, files, allowedMentions… }
 * @param {object} [o]      options de renderGlassEmbed + { update: true } pour interaction.update()
 */
async function glassPayload(payload = {}, o = {}) {
  const embeds = (payload.embeds || []).filter(Boolean);
  if (!embeds.length) return toCV2Payload(payload);
  try {
    const { embeds: _e, components = [], content, ephemeral, flags = 0, files = [], ...rest } = payload;
    const guildId = o.guildId || (o.guild && o.guild.id) || null;
    const top = [];
    if (content) top.push(new TextDisplayBuilder().setContent(String(content)));
    const attachments = [];
    for (let i = 0; i < embeds.length; i++) {
      const name = uniq('glass');
      const buf = await renderGlassEmbed(embeds[i], { ...o, guildId });
      attachments.push(new AttachmentBuilder(buf, { name }));
      // Image seule, sans cadre ni barre colorée (pas de Container) : on ne voit plus que la carte verre
      top.push(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
    }
    top.push(...components);
    let finalFlags = flags | MessageFlags.IsComponentsV2;
    if (ephemeral) finalFlags |= MessageFlags.Ephemeral;
    const out = { ...rest, components: top, files: [...files, ...attachments], flags: finalFlags };
    if (o.update) out.attachments = [];
    return out;
  } catch (e) {
    console.error('[glassEmbed] rendu impossible, retour à l\'embed :', e.message);
    return toCV2Payload(payload);
  }
}

/** Répond à une interaction (reply, ou followUp si elle a déjà été defer/répondue). */
async function glassReply(interaction, payload, o = {}) {
  const built = await glassPayload(payload, { guild: interaction.guild, client: interaction.client, ...o });
  if (interaction.deferred || interaction.replied) return interaction.followUp(built);
  return interaction.reply(built);
}

/** Variante interaction.update() (boutons Accepter / Refuser…). */
async function glassUpdate(interaction, payload, o = {}) {
  const built = await glassPayload(payload, { guild: interaction.guild, client: interaction.client, update: true, ...o });
  return interaction.update(built);
}

/** Payload CV2 contenant uniquement une image générée (bienvenue / au revoir…). */
function imagePayload(buffer, name = 'card.png') {
  const file = uniq(name.replace(/\.png$/, ''));
  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${file}`)));
  return { file: new AttachmentBuilder(buffer, { name: file }), fileName: file, container };
}

module.exports = {
  renderGlassEmbed,
  renderWelcomeCard,
  findCardBackground,
  CARD_BG_DIR,
  CARD_BG_EXTS,
  glassPayload,
  glassReply,
  glassUpdate,
  imagePayload,
  resolveMentions,
  clean
};
