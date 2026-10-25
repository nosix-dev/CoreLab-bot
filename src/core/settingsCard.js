'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte image générique pour les panneaux de configuration
// (même style que /protect-settings : fond vert sombre, pastille, tuiles).
//
// Usage le plus simple : on garde l'embed et les boutons existants et on
// les passe à buildSettingsPayload(), qui transforme les champs de l'embed
// en tuiles sur une image et renvoie un message Components V2 :
//
//   interaction.update(buildSettingsPayload({ guild, embed, rows, file: 'starboard.png' }))
//   interaction.reply({ ...buildSettingsPayload({...}), flags: payload.flags | MessageFlags.Ephemeral })
//
// Si le rendu de l'image échoue, on retombe sur l'ancien rendu (embed -> Container).
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require('discord.js');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx, containerAccent } = require('./cardTheme');

// ── Police (même logique que protectCard.js) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'SettingsCardBold');
    GlobalFonts.registerFromPath(r, 'SettingsCard');
    FONT = 'SettingsCard';
    FONT_BOLD = 'SettingsCardBold';
  }
} catch { /* police système */ }

const OK = '#3ddc84';
const WARN = '#f0b429';

// ── Nettoyage du texte Discord -> texte brut pour le canvas ──
// Le canvas ne sait ni afficher les mentions (<#id>) ni les emojis : on résout les
// mentions en noms et on retire les emojis (l'état reste visible via la pastille).
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

// Caractères que la police peut afficher (latin, grec, cyrillique, ponctuation courante).
// Tout le reste (ex. « ・ », « ┃ », CJK, symboles déco des noms de salons) sortirait en carré vide.
const UNSUPPORTED_RE = /[^\n\u0020-\u024F\u0370-\u04FF\u2010-\u2027\u2030-\u203A\u20AC\u2122\u2190-\u2193]/gu;

function cleanText(text, guild) {
  let t = String(text ?? '');
  t = t.replace(/<#(\d+)>/g, (_, id) => {
    const c = guild?.channels?.cache?.get(id);
    return c ? `#${c.name.replace(UNSUPPORTED_RE, '') || 'salon'}` : '#salon-inconnu';
  });
  t = t.replace(/<@&(\d+)>/g, (_, id) => {
    const r = guild?.roles?.cache?.get(id);
    return r ? `@${r.name.replace(UNSUPPORTED_RE, '') || 'rôle'}` : '@rôle-inconnu';
  });
  t = t.replace(/<@!?(\d+)>/g, (_, id) => {
    const m = guild?.members?.cache?.get(id);
    return m ? `@${m.displayName}` : '@membre';
  });
  t = t.replace(/<a?:([A-Za-z0-9_]+):\d+>/g, ':$1:');      // emoji perso -> :nom:
  t = t.replace(/<t:\d+(?::[a-zA-Z])?>/g, '');             // timestamps Discord
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');           // liens markdown
  t = t.replace(/```[a-z]*\n?/gi, '').replace(/[*_~`|]/g, '');
  t = t.replace(EMOJI_RE, '');
  t = t.replace(UNSUPPORTED_RE, '');
  return t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// Détecte l'état d'une valeur de champ d'après son emoji de tête.
function detectState(raw) {
  const s = String(raw ?? '').trim();
  if (/^(🟢|✅)/u.test(s)) return true;
  if (/^(🔴|⛔|❌)/u.test(s)) return false;
  return null; // pas un champ "état"
}

/**
 * Convertit un embed (EmbedBuilder ou objet brut) en données de carte.
 * @returns {{title:string, subtitle:string, tiles:Array<{label:string,value:string,state:boolean|null,span:number}>}}
 */
function cardDataFromEmbed(embed, guild) {
  const d = typeof embed?.toJSON === 'function' ? embed.toJSON() : (embed || {});
  const fields = Array.isArray(d.fields) ? d.fields : [];
  const tiles = fields
    .filter(f => f && !(f.name === '\u200B' && f.value === '\u200B') && f.name !== '\u200b')
    .map(f => ({
      label: cleanText(f.name, guild).toUpperCase(),
      value: cleanText(f.value, guild) || '—',
      state: detectState(f.value),
      span: f.inline ? 1 : 3
    }));

  return {
    title: cleanText(d.title || 'Configuration', guild),
    subtitle: '',
    description: d.description ? String(d.description) : '',   // markdown brut, affiché en texte natif
    footer: d.footer?.text ? String(d.footer.text) : '',
    tiles
  };
}

// ── Dessin ──
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

// Retour à la ligne (mots), max `maxLines` lignes, la dernière est tronquée avec « … ».
function wrapLines(ctx, text, maxW, maxLines) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = fit(ctx, kept[maxLines - 1] + ' …', maxW);
    return kept;
  }
  return out.map(l => fit(ctx, l, maxW));
}

/**
 * Dessine la carte. Synchrone, aucun réseau.
 * @param {{title:string, subtitle?:string, tiles:Array, pill?:{label:string,color:string}|null, scale?:number, cols?:number}} o
 *   scale : agrandit textes et tuiles (1 = taille d'origine, ex. 1.3 = plus gros)
 *   cols  : nombre de colonnes (3 par défaut ; 2 recommandé avec un scale > 1)
 *   header  : false = pas d'en-tête (2e image d'un panneau découpé)
 *   compact : tuiles plus serrées (utile pour les panneaux à beaucoup de tuiles)
 *   width : largeur du canvas en px (1240 par défaut). Discord affiche l'image à une largeur
 *           fixe : plus le canvas est étroit, plus le texte paraît gros à l'écran.
 * @returns {Buffer} PNG
 */
function renderSettingsCard({ title, subtitle = '', tiles, pill = undefined, scale = 1, cols = 3, width = 1240, compact = false, header = true, guildId = null }) {
  const s = scale;
  const hs = 1 + (s - 1) * 0.5;               // le header grossit moins vite que les tuiles
  const COLS = cols, PAD = Math.round(26 * s), GAP = Math.round(12 * s), W = width;
  const tileW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const LINE = Math.round(32 * s);
  // Mode compact : tuiles plus serrées (même texte, image moins haute => Discord ne la réduit pas)
  const K = compact
    ? { top: 44, dot: 23, lab: 29, val: 62, bot: 10, min: 78, head: 92, labLH: 20 }
    : { top: 58, dot: 30, lab: 36, val: 78, bot: 14, min: 104, head: 112, labLH: 22 };
  const left = PAD + Math.round(78 * hs);     // début du texte du header

  // Statut global (pilule à droite) : par défaut déduit des tuiles "état"
  let status = pill;
  if (status === undefined) {
    const first = tiles.find(t => t.state !== null);
    status = first ? { label: first.state ? 'ACTIVÉ' : 'DÉSACTIVÉ', color: first.state ? OK : WARN } : null;
  }
  const pf = Math.round(20 * hs), ph = Math.round(44 * hs), pr = ph / 2;
  let pillW = 0;
  const probe0 = createCanvas(10, 10).getContext('2d');
  if (status) {
    probe0.font = `${pf}px ${FONT_BOLD}`;
    pillW = probe0.measureText(status.label).width + Math.round(58 * hs);
  }

  // Titre : rétrécit un peu, puis passe sur 2 lignes si toujours trop long (jamais coupé)
  const textMax = W - left - PAD - (pillW ? pillW + 20 : 0);
  let titlePx = Math.round(40 * hs);
  const minTitlePx = Math.round(24 * hs);
  probe0.font = `${titlePx}px ${FONT_BOLD}`;
  while (titlePx > minTitlePx && probe0.measureText(title).width > textMax) {
    titlePx -= 1;
    probe0.font = `${titlePx}px ${FONT_BOLD}`;
  }
  const titleLines = wrapLines(probe0, title, textMax, 3);
  const titleLH = Math.round(titlePx * 1.15);
  const HEAD = header === false
    ? PAD
    : Math.max(Math.round(K.head * hs), titleLines.length * titleLH + (subtitle ? Math.round(40 * hs) : 0) + Math.round(40 * hs));
  const cy = HEAD / 2;                        // axe vertical du header

  // Mesure (contexte temporaire) pour calculer la hauteur de chaque tuile
  const probe = createCanvas(10, 10).getContext('2d');
  const laid = tiles.map(t0 => {
    const t = { ...t0, span: t0.span >= 3 ? COLS : t0.span };   // span 3 = pleine largeur, quel que soit le nombre de colonnes
    const full = t.span >= COLS;
    const w = tileW * t.span + GAP * (t.span - 1);
    // Longue liste (plusieurs lignes) : police et interligne réduits pour rester compact
    const isList = full && t.value.split('\n').length > 4;
    const fontPx = Math.round((isList ? 24 : 28) * s);
    const line = isList ? Math.round(30 * s) : LINE;
    probe.font = `${fontPx}px ${FONT_BOLD}`;
    const maxLines = full ? (isList ? 16 : 6) : 3;
    const lines = wrapLines(probe, t.value, w - Math.round(48 * s), maxLines);
    // Libellé : jusqu'à 2 lignes (au lieu d'être coupé par « … »)
    const labelPx = Math.round(18 * s), labelLine = Math.round(K.labLH * s);
    probe.font = `${labelPx}px ${FONT_BOLD}`;
    const labelLines = wrapLines(probe, t.label, w - Math.round(64 * s), 2);
    const extra = (labelLines.length - 1) * labelLine;
    const h = Math.round(K.top * s) + extra + lines.length * line + Math.round(K.bot * s);
    return { ...t, w, lines, fontPx, line, labelLines, labelPx, labelLine, extra, h: Math.max(h, Math.round(K.min * s)) };
  });

  // Placement en lignes (une ligne = tuiles qui tiennent sur COLS colonnes)
  const rows = [];
  let cur = [], used = 0;
  for (const t of laid) {
    if (used + t.span > COLS) { rows.push(cur); cur = []; used = 0; }
    cur.push(t); used += t.span;
  }
  if (cur.length) rows.push(cur);
  const rowH = rows.map(r => Math.max(...r.map(t => t.h)));

  const H = HEAD + rowH.reduce((a, b) => a + b, 0) + GAP * Math.max(rows.length - 1, 0) + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);
  ctx.textBaseline = 'alphabetic';

  // Fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12291c');
  bg.addColorStop(1, '#090e0b');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  if (header !== false) {
    // Pastille ronde + coche dessinée (comme /protect-settings)
    ctx.save();
    ctx.translate(PAD + 30, cy);
    ctx.scale(hs, hs);
    ctx.fillStyle = OK;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0a1a10'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-13, 1); ctx.lineTo(-3, 12); ctx.lineTo(15, -11); ctx.stroke();
    ctx.restore();
    // Pilule de statut
    if (status) {
      ctx.font = `${pf}px ${FONT_BOLD}`;
      ctx.fillStyle = status.color + '33';
      roundRect(ctx, W - PAD - pillW, cy - pr, pillW, ph, pr); ctx.fill();
      ctx.fillStyle = status.color;
      ctx.beginPath(); ctx.arc(W - PAD - pillW + pr, cy, Math.round(7 * hs), 0, Math.PI * 2); ctx.fill();
      ctx.fillText(status.label, W - PAD - pillW + pr + Math.round(16 * hs), cy + Math.round(7 * hs));
    }

    // Titre + sous-titre
    ctx.fillStyle = '#ffffff';
    ctx.font = `${titlePx}px ${FONT_BOLD}`;
    const blockH = titleLines.length * titleLH + (subtitle ? Math.round(36 * hs) : 0);
    let ty = cy - blockH / 2 + Math.round(titlePx * 0.85);
    titleLines.forEach((l, i) => ctx.fillText(l, left, ty + i * titleLH));
    if (subtitle) {
      ctx.fillStyle = '#8fa398';
      ctx.font = `${Math.round(22 * hs)}px ${FONT}`;
      ctx.fillText(fit(ctx, subtitle, textMax), left, ty + (titleLines.length - 1) * titleLH + Math.round(34 * hs));
    }

  }

  // Tuiles
  let y = HEAD;
  rows.forEach((row, ri) => {
    let x = PAD;
    for (const t of row) {
      const on = t.state === true;
      const off = t.state === false;

      ctx.fillStyle = on ? '#14351f' : '#171c19';
      roundRect(ctx, x, y, t.w, rowH[ri], 14); ctx.fill();
      ctx.strokeStyle = on ? '#2c7d4d' : '#2a312d';
      ctx.lineWidth = 2; ctx.stroke();

      // Pastille d'état : verte = activé, grise = désactivé / non défini, bleue = valeur simple
      ctx.fillStyle = on ? OK : off ? '#5a655e' : '#6fb1ff';
      ctx.beginPath(); ctx.arc(x + Math.round(26 * s), y + Math.round(K.dot * s), Math.round(8 * s), 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#8fa398';
      ctx.font = `${t.labelPx}px ${FONT_BOLD}`;
      t.labelLines.forEach((l, i) => ctx.fillText(l, x + Math.round(46 * s), y + Math.round(K.lab * s) + i * t.labelLine));

      ctx.fillStyle = off ? '#9aa6a0' : '#ffffff';
      ctx.font = `${t.fontPx}px ${FONT_BOLD}`;
      t.lines.forEach((l, i) => ctx.fillText(l, x + Math.round(24 * s), y + Math.round(K.val * s) + t.extra + i * t.line));

      x += t.w + GAP;
    }
    y += rowH[ri] + GAP;
  });

  return canvas.toBuffer('image/png');
}

/**
 * Construit un message Components V2 : titre + image (carte) + hint + composants.
 * @param {Object} o
 * @param {import('discord.js').Guild} o.guild
 * @param {import('discord.js').EmbedBuilder|Object} o.embed   embed existant du panneau (titre, description, champs)
 * @param {Array} [o.rows]        ActionRows (boutons, menus) déjà construites
 * @param {string} [o.file]       nom du fichier image (unique par panneau)
 * @param {string|null} [o.notice] petite ligne de texte sous la carte
 * @param {string|null} [o.hint]  ligne d'aide en petit sous la carte
 * @param {{label:string,color:string}|null} [o.pill] force/masque la pilule de statut (null = aucune)
 * @param {Array} [o.extraTiles]  tuiles ajoutées à la fin ({label,value,state?,span?})
 * @param {number} [o.scale]      agrandissement des textes/tuiles (1 = normal, 1.3 = plus gros)
 * @param {number} [o.cols]       colonnes de la carte (3 par défaut, 2 conseillé avec scale > 1)
 * @param {number} [o.split]      découpe la carte en 2 images après N tuiles (texte plus gros dans Discord :
 *                                Discord réduit les images trop hautes). 0 = une seule image.
 * @param {boolean} [o.compact]   tuiles plus serrées (panneaux à beaucoup de tuiles)
 * @param {number} [o.width]      largeur du canvas (1240 par défaut ; ~760 = texte bien plus gros dans Discord)
 * @param {string|null} [o.heading]  titre en texte natif au-dessus de la carte (« ## … », comme /protect-settings)
 * @param {string} [o.subtitle]   sous-titre dessiné sous le titre de la carte (ex. « 3/5 activés »)
 */
function buildSettingsPayload({ guild, embed, rows = [], file = 'settings.png', notice = null, hint = null, pill = undefined, extraTiles = [], scale = 1, cols = 3, width = 1240, compact = false, split = 0, heading = null, subtitle = '' }) {
  try {
    const data = cardDataFromEmbed(embed, guild);
    data.subtitle = subtitle || '';
    data.tiles.push(...extraTiles.map(t => ({ state: null, span: 1, ...t, label: String(t.label).toUpperCase() })));
    const opts = { scale, cols, width, compact, guildId: guild?.id || null };
    const cut = split > 0 && split < data.tiles.length ? split : 0;
    const pngs = cut
      ? [
          renderSettingsCard({ ...data, tiles: data.tiles.slice(0, cut), pill, ...opts }),
          renderSettingsCard({ ...data, tiles: data.tiles.slice(cut), pill: null, header: false, ...opts })
        ]
      : [renderSettingsCard({ ...data, pill, ...opts })];
    const names = pngs.map((_, i) => (i === 0 ? file : file.replace(/(\.[^.]+)?$/, `-${i + 1}$1`)));

    const container = new ContainerBuilder().setAccentColor(containerAccent(guild?.id, 0xFFFFFF));
    // Discord limite un Container à 10 enfants : on retire le titre natif si la liste de rangées est trop longue
    const small = [hint, data.footer].filter(Boolean).join(' • ');
    const childCount = (notice ? 1 : 0) + (data.description ? 1 : 0) + names.length + (small ? 1 : 0) + (rows.length ? 1 + rows.length : 0);
    if (heading && childCount < 10) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${String(heading).slice(0, 200)}`));
    if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 500)));
    // Description de l'embed en texte natif (garde gras, mentions cliquables, retours à la ligne)
    if (data.description) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(data.description.slice(0, 1500)));
    for (const name of names) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`))
      );
    }
    if (small) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${small}`));
    if (rows.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addActionRowComponents(...rows);
    }
    return {
      components: [container],
      files: pngs.map((png, i) => new AttachmentBuilder(png, { name: names[i] })),
      attachments: [],
      flags: MessageFlags.IsComponentsV2
    };
  } catch (e) {
    console.error('[SettingsCard] Erreur image panneau :', e.message);
    // Repli : ancien rendu (embed converti en Container)
    const { toCV2Payload } = require('./componentsV2');
    return { ...toCV2Payload({ embeds: [embed], components: rows }), attachments: [] };
  }
}

module.exports = { buildSettingsPayload, renderSettingsCard, cardDataFromEmbed, cleanText };