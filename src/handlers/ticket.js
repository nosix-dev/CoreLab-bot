const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  getGuildConfig
} = require('../core/config');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Stockage local de l'image des formulaires autonomes (/form)
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const DOSSIER_IMAGES_FORMULAIRE = path.join(__dirname, '..', 'data', 'form_images');
async function sauvegarderImageFormulaireLocalement(guildId, slug, attachment) {
  if (!fs.existsSync(DOSSIER_IMAGES_FORMULAIRE)) fs.mkdirSync(DOSSIER_IMAGES_FORMULAIRE, {
    recursive: true
  });
  const MIME_TO_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const ext = MIME_TO_EXT[attachment.contentType?.toLowerCase()] || (path.extname(attachment.name || '') || '.png').toLowerCase();

  // Nettoie une éventuelle ancienne image (autre extension) pour ce formulaire
  for (const f of fs.readdirSync(DOSSIER_IMAGES_FORMULAIRE)) {
    if (f.startsWith(`${guildId}_${slug}.`)) {
      try {
        fs.unlinkSync(path.join(DOSSIER_IMAGES_FORMULAIRE, f));
      } catch { }
    }
  }
  const nomFichier = `${guildId}_${slug}${ext}`;
  const cheminFichier = path.join(DOSSIER_IMAGES_FORMULAIRE, nomFichier);
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Téléchargement image échoué (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cheminFichier, buffer);
  return nomFichier;
}
function supprimerImageFormulaire(nomFichier) {
  if (!nomFichier) return;
  const p = path.join(DOSSIER_IMAGES_FORMULAIRE, nomFichier);
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch { }
  }
}

// Normalise une entrée de store.formulaires[gid][slug] : accepte l'ancien
// format (simple chaîne = nom) comme le nouveau ({ nom, image }).
function normFormMeta(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return {
    nom: entry,
    image: null
  };
  return {
    image: null,
    ...entry
  };
}
const COLOR_MAP = {
  red: ButtonStyle.Danger,
  green: ButtonStyle.Success,
  blurple: ButtonStyle.Primary,
  grey: ButtonStyle.Secondary
};
// Discord n'autorise que 4 couleurs de bouton. « auto » alterne les 4 d'une raison à l'autre.
const AUTO_ORDER = ['green', 'blurple', 'red', 'grey'];
const COLOR_ALIASES = {
  red: 'red', rouge: 'red', r: 'red',
  green: 'green', vert: 'green', v: 'green',
  blurple: 'blurple', bleu: 'blurple', blue: 'blurple', b: 'blurple', primary: 'blurple',
  grey: 'grey', gray: 'grey', gris: 'grey', g: 'grey', secondary: 'grey',
  auto: 'auto', multi: 'auto', multicolore: 'auto'
};
function normalizeReasonColor(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (COLOR_ALIASES[k]) return COLOR_ALIASES[k];
  // Couleur personnalisée hexadécimale : #RRGGBB, RRGGBB, #RGB ou RGB
  const m = k.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return '#' + h;
  }
  return 'blurple';
}
function isCustomHexColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}
// Style de bouton Discord le plus proche d'une couleur hex (Discord n'autorise que 4 styles)
function nearestButtonStyleName(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.2) return 'grey';
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 45 || h >= 330) return 'red';
  if (h < 170) return 'green';
  return 'blurple';
}
// Couleur de la carte du panneau pour une raison (hex perso ou couleur de la palette)
function reasonCardHex(color, index) {
  if (isCustomHexColor(color)) return color;
  return CARD_COLORS[resolveReasonColor(color, index)];
}
// Style du bouton Discord pour une raison
function reasonButtonStyle(color, index) {
  if (isCustomHexColor(color)) return COLOR_MAP[nearestButtonStyleName(color)];
  return COLOR_MAP[resolveReasonColor(color, index)] || ButtonStyle.Primary;
}
// Emoji valide pour un bouton/option Discord : unicode ou personnalisé <:nom:id> / <a:nom:id>.
// Retourne null si invalide (évite l'erreur COMPONENT_INVALID_EMOJI à la publication).
function sanitizeEmoji(raw) {
  const e = String(raw || '').trim();
  if (!e) return null;
  if (/^<a?:\w{2,32}:\d{17,22}>$/.test(e)) return e;
  const unicode = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;
  return unicode.test(e) ? e : null;
}
// Couleur « réelle » d'une raison (résout « auto » selon sa position)
function resolveReasonColor(color, index) {
  return color === 'auto' ? AUTO_ORDER[index % AUTO_ORDER.length] : (COLOR_MAP[color] ? color : 'blurple');
}
const CARD_COLORS = { green: '#3ddc84', blurple: '#7f8cff', red: '#ff6b6b', grey: '#9aa6a0' };

// ────────────────────────────────────────────────
// Construction des embeds / panneaux
// ────────────────────────────────────────────────
function hexToInt(hex) {
  if (!hex) return null;
  const clean = String(hex).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
}

// Embed du panneau de gestion des tickets : une tuile par paramètre
// (même principe que les catégories de /settings → rendu en carte image).
function buildTicketConfigEmbed(cfg, channelId) {
  const chKey = String(channelId);
  const reasons = cfg.ticket_reasons?.[chKey] || [];
  const refId = cfg.ticket_categories?.[chKey];
  const appearance = cfg.ticket_appearance?.[chKey];
  const claimEnabled = !!cfg.ticket_claim_enabled?.[chKey];
  return new EmbedBuilder()
    .setTitle('🎫 Gestion des tickets — ce salon')
    .setDescription('Gère les raisons de tickets de ce salon avec les boutons ci-dessous.')
    .setColor(0xFFFFFF)
    .addFields({
      name: '📋 Raisons configurées',
      value: `\`${reasons.length}\``,
      inline: true
    }, {
      name: '📂 Salon de référence',
      value: refId ? `<#${refId}>` : '❌ Non défini',
      inline: true
    }, {
      name: '🎨 Apparence ⭐',
      value: appearance ? '✅ Configurée' : '❌ Par défaut',
      inline: true
    }, {
      name: '🖐️ Bouton Claim ⭐',
      value: claimEnabled ? '✅ Activé' : '❌ Désactivé',
      inline: true
    });
}

// Boutons rangés par thème :
//   1. Raisons    → ajouter / modifier / retirer
//   2. Réglages   → salon de référence, apparence, claim, bannière, message d'ouverture
//   3. Panneau    → voir la liste / publier
function buildTicketConfigRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_add_reason').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_edit_reason').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_remove_reason').setLabel('Retirer').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_choose_category').setLabel('Salon').setEmoji('📂').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_appearance').setLabel('Apparence').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_toggle_claim').setLabel('Claim').setEmoji('🖐️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_set_image').setLabel('Bannière').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_open_msg').setLabel('Ouverture').setEmoji('✉️').setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_show_list').setLabel('Voir la liste').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_publish_panel').setLabel('Publier le panneau').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );
  return [row1, row2, row3];
}

// Payload complet « carte image » (même rendu que /settings et /protect-settings).
// À utiliser pour /settings ticket ET pour rafraîchir le panneau après une modification.
// → Components V2 : conteneur avec titre, carte image (même rendu que les logs), boutons.
async function buildTicketConfigPayload(cfg, channelId, guild, opts = {}) {
  const tilesEmbed = buildTicketConfigEmbed(cfg, channelId);
  // Pas de description dans le conteneur : le titre, la carte et les boutons suffisent
  tilesEmbed.setDescription(null);
  const rows = buildTicketConfigRows();
  try {
    const { buildSettingsPayload, cardDataFromEmbed } = require('../core/settingsCard');
    const data = cardDataFromEmbed(tilesEmbed, guild);
    const stateTiles = data.tiles.filter(t => t.state !== null);
    const subtitle = stateTiles.length
      ? `${stateTiles.filter(t => t.state).length}/${stateTiles.length} options actives`
      : `${data.tiles.length} paramètre(s)`;
    // Components V2 : conteneur avec titre, carte (même rendu que les logs), boutons
    const payload = buildSettingsPayload({
      guild,
      embed: tilesEmbed,
      rows,
      file: 'config-ticket.png',
      notice: opts.notice ? String(opts.notice) : null,
      hint: 'Utilise les boutons ci-dessous pour gérer les tickets de ce salon.',
      heading: '🎫 Gestion des tickets — ce salon',
      subtitle,
      pill: null
    });
    if (opts.ephemeral) payload.flags = (payload.flags ?? MessageFlags.IsComponentsV2) | MessageFlags.Ephemeral;
    return payload;
  } catch (e) {
    console.error('[Ticket] Erreur rendu panneau :', e.message);
    // Repli sans image : l'embed avec ses champs
    const payload = { embeds: [tilesEmbed], components: rows, attachments: [] };
    if (opts.ephemeral) payload.flags = MessageFlags.Ephemeral;
    return payload;
  }
}

// ────────────────────────────────────────────────
// Panneau PUBLIÉ aux membres — « style 4 » en vert
// Embed classique + carte image : bloc vert à gauche (icône du serveur),
// titre à droite et liste des raisons. La bannière choisie (🖼️ Bannière)
// est dessinée sous la carte, dans la même image. Boutons de raisons dessous.
// ────────────────────────────────────────────────
let _ticketFonts = null;
function ticketFonts() {
  if (_ticketFonts) return _ticketFonts;
  _ticketFonts = { bold: 'sans-serif', regular: 'sans-serif' };
  try {
    const { GlobalFonts } = require('@napi-rs/canvas');
    const dir = path.join(__dirname, '..', 'assets', 'fonts');
    const b = path.join(dir, 'Poppins-Bold.ttf');
    const r = path.join(dir, 'Poppins-Regular.ttf');
    if (fs.existsSync(b) && fs.existsSync(r)) {
      GlobalFonts.registerFromPath(b, 'TicketCardBold');
      GlobalFonts.registerFromPath(r, 'TicketCard');
      _ticketFonts = { bold: 'TicketCardBold', regular: 'TicketCard' };
    }
  } catch { /* police système */ }
  return _ticketFonts;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
// logoSource : Buffer / chemin de l'icône du serveur (bloc de gauche)
// bannerPath : chemin de la bannière choisie (dessinée sous la carte verte)
async function renderTicketPanelCard({ title, reasons, logoSource, bannerPath, guildId = null }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    return cc.renderCompact({
      guildId, theme: 'cyan', title: `🎫 ${title}`,
      sub: `${reasons.length} catégorie${reasons.length > 1 ? 's' : ''}`,
      grid: 1, valueMax: 44,
      blocks: reasons.slice(0, 8).map(r => ({ label: r.label, value: r.description || '—' })),
      footerRight: reasons.length > 8 ? `+ ${reasons.length - 8} autre${reasons.length - 8 > 1 ? 's' : ''}` : undefined
    });
  }
  const { themedCtx } = require('../core/cardTheme');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const F = ticketFonts();
  const GREEN = '#3ddc84', DARK = '#0a1a10';
  const W = 1000, PAD = 28, BLOCK = 230, ROW = 40, GAP = 16;
  const shown = reasons.slice(0, 6);
  const extra = reasons.length - shown.length;
  const rowsCount = shown.length + (extra > 0 ? 1 : 0);
  const HC = Math.max(290, PAD * 2 + 118 + rowsCount * ROW); // hauteur de la carte

  // Bannière choisie (affichée sous la carte)
  let banner = null, bannerH = 0;
  if (bannerPath && fs.existsSync(bannerPath)) {
    try {
      banner = await loadImage(bannerPath);
      bannerH = Math.min(320, Math.max(120, Math.round(W * banner.height / banner.width)));
    } catch { banner = null; }
  }

  const H = HC + (banner ? GAP + bannerH : 0);
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);

  // Fond de la carte
  ctx.fillStyle = '#0f1f16';
  rrect(ctx, 0, 0, W, HC, 24); ctx.fill();
  ctx.strokeStyle = '#1d3a28'; ctx.lineWidth = 2;
  rrect(ctx, 1, 1, W - 2, HC - 2, 24); ctx.stroke();

  // Bloc de gauche : icône du serveur (ou icône par défaut + « SUPPORT »)
  const bx = PAD, by = PAD, bw = BLOCK, bh = HC - PAD * 2;
  let logo = null;
  if (logoSource) {
    try { logo = await loadImage(logoSource); } catch { logo = null; }
  }
  if (logo) {
    ctx.fillStyle = '#08120c';
    rrect(ctx, bx, by, bw, bh, 18); ctx.fill();
    ctx.strokeStyle = '#2c7d4d'; ctx.lineWidth = 2;
    rrect(ctx, bx, by, bw, bh, 18); ctx.stroke();
    const aw = bw - 24, ah = bh - 24;
    const sc = Math.min(aw / logo.width, ah / logo.height);
    const lw = logo.width * sc, lh = logo.height * sc;
    const lx = bx + (bw - lw) / 2, ly = by + (bh - lh) / 2;
    ctx.save();
    rrect(ctx, lx, ly, lw, lh, 14); ctx.clip();
    ctx.drawImage(logo, lx, ly, lw, lh);
    ctx.restore();
  } else {
    ctx.fillStyle = GREEN;
    rrect(ctx, bx, by, bw, bh, 18); ctx.fill();
    const cx = bx + bw / 2, cy = by + bh / 2 - 14;
    // bulle de discussion
    ctx.strokeStyle = DARK; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    rrect(ctx, cx - 44, cy - 32, 88, 62, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 18, cy + 30); ctx.lineTo(cx - 28, cy + 50); ctx.lineTo(cx + 2, cy + 30); ctx.stroke();
    ctx.fillStyle = DARK;
    [-18, 0, 18].forEach(dx => { ctx.beginPath(); ctx.arc(cx + dx, cy - 1, 5, 0, Math.PI * 2); ctx.fill(); });
    ctx.font = `22px ${F.bold}`;
    ctx.textAlign = 'center';
    ctx.fillText('SUPPORT', cx, by + bh - 28);
    ctx.textAlign = 'left';
  }

  // Colonne de droite
  const x0 = bx + bw + 34, maxW = W - x0 - PAD - 8;
  ctx.fillStyle = GREEN;
  ctx.font = `20px ${F.bold}`;
  ctx.fillText('T I C K E T S', x0, PAD + 26);

  let tpx = 46;
  ctx.font = `${tpx}px ${F.bold}`;
  while (tpx > 26 && ctx.measureText(title).width > maxW) { tpx -= 2; ctx.font = `${tpx}px ${F.bold}`; }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fitText(ctx, title, maxW), x0, PAD + 26 + 14 + tpx);

  let y = PAD + 26 + 14 + tpx + 36;
  for (const r of shown) {
    // chevron
    ctx.strokeStyle = r.hex || GREEN; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y - 18); ctx.lineTo(x0 + 10, y - 9); ctx.lineTo(x0, y); ctx.stroke();
    const tx = x0 + 28;
    ctx.font = `26px ${F.bold}`;
    ctx.fillStyle = '#d6efe0';
    const label = fitText(ctx, r.label || 'Ticket', maxW - 28);
    ctx.fillText(label, tx, y);
    if (r.description) {
      const used = ctx.measureText(label).width;
      ctx.font = `22px ${F.regular}`;
      ctx.fillStyle = '#7fa38c';
      const room = maxW - 28 - used - 14;
      if (room > 80) ctx.fillText(fitText(ctx, '— ' + r.description, room), tx + used + 14, y);
    }
    y += ROW;
  }
  if (extra > 0) {
    ctx.font = `22px ${F.regular}`;
    ctx.fillStyle = '#7fa38c';
    ctx.fillText(`+ ${extra} autre(s) catégorie(s)`, x0 + 28, y);
  }

  // Bannière choisie, sous la carte verte (recadrée "cover", coins arrondis)
  if (banner) {
    const yb = HC + GAP;
    ctx.save();
    rrect(ctx, 0, yb, W, bannerH, 24); ctx.clip();
    const sc = Math.max(W / banner.width, bannerH / banner.height);
    const dw = banner.width * sc, dh = banner.height * sc;
    ctx.drawImage(banner, (W - dw) / 2, yb + (bannerH - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = '#1d3a28'; ctx.lineWidth = 2;
    rrect(ctx, 1, yb + 1, W - 2, bannerH - 2, 24); ctx.stroke();
  }
  return canvas.toBuffer('image/png');
}

// Payload du panneau publié — Components V2 100 % natif (aucune image générée) :
//   • bannière choisie (🖼️ Bannière) en haut du conteneur
//   • section : titre + texte d'intro, icône du serveur en miniature à droite
//   • liste des raisons avec leur description (si elles en ont)
//   • séparateur, puis boutons de raisons
async function buildTicketPublishPayload(cfg, panelChannelId, guild, bannerPath = null) {
  const chKey = String(panelChannelId);
  const reasons = cfg.ticket_reasons?.[chKey] || [];
  const appearance = cfg.ticket_appearance?.[chKey] || {};
  const rows = buildTicketReasonButtons(reasons, panelChannelId);
  const intro = appearance.description || "Besoin d'aide ? Sélectionne la catégorie qui correspond le mieux à ton problème.";
  const { cleanText } = require('../core/settingsCard');
  const title = cleanText(appearance.title || '', guild) || 'Ouvrir un ticket';
  const container = new ContainerBuilder().setAccentColor(appearance.color ?? 0xFFFFFF);
  const files = [];

  // 1. Bannière en haut
  if (bannerPath && fs.existsSync(bannerPath)) {
    const bannerName = `ticket-banner${path.extname(bannerPath) || '.png'}`;
    files.push(new AttachmentBuilder(bannerPath, { name: bannerName }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${bannerName}`))
    );
  }

  // 2. Titre + intro, icône du serveur en miniature
  const head = [`## 🎫 ${title}`.slice(0, 250), intro.slice(0, 2000)].join('\n');
  const iconUrl = guild?.iconURL({ extension: 'png', size: 256, forceStatic: true });
  if (iconUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  }

  // 3. Descriptions des raisons (seulement si au moins une en a une)
  if (reasons.some(r => r.description)) {
    const lines = reasons.slice(0, 25).map(r => {
      const emoji = sanitizeEmoji(r.emoji);
      const label = cleanText(r.label, guild);
      const desc = cleanText(r.description || '', guild);
      return `${emoji ? emoji + ' ' : '• '}**${label}**${desc ? ` — ${desc}` : ''}`;
    });
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 3500)));
  }

  // 4. Boutons de raisons
  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    for (const row of rows.slice(0, 5)) container.addActionRowComponents(row);
  }
  return { components: [container], files, flags: MessageFlags.IsComponentsV2 };
}

// Panneau de gestion d'un formulaire (questions + image + publication).
// Utilisé aussi bien pour les formulaires liés à un ticket que pour les
// formulaires autonomes (/form) — les boutons Image/Publier ne
// s'affichent que pour ces derniers (formKey préfixé par "standalone_").
function buildFormManagerRows(formKey) {
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_form_add_field_${formKey}`).setLabel('➕ Ajouter une question').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`ticket_form_remove_field_${formKey}`).setLabel('🗑️ Retirer une question').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`ticket_form_edit_field_${formKey}`).setLabel('✏️ Modifier une question').setStyle(ButtonStyle.Primary));
  const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_form_list_fields_${formKey}`).setLabel('📋 Voir les questions').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`ticket_form_validate_${formKey}`).setLabel('✅ Valider le formulaire').setStyle(ButtonStyle.Success));
  const rows = [row1, row2];
  if (formKey.startsWith('standalone_')) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_form_style_${formKey}`).setLabel('Personnaliser l\'apparence').setEmoji('🎨').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`ticket_form_image_${formKey}`).setLabel('🖼️ Image du formulaire').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`ticket_form_publish_${formKey}`).setLabel('📨 Publier le formulaire').setStyle(ButtonStyle.Primary)));
  }
  return rows;
}
function buildTicketReasonButtons(reasons, panelChannelId) {
  const rows = [];
  let row = new ActionRowBuilder();
  reasons.slice(0, 25).forEach((r, i) => {
    if (i > 0 && i % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    const btn = new ButtonBuilder().setCustomId(`ticket_reason_${panelChannelId}_${r.value}`).setLabel(r.label.slice(0, 80)).setStyle(reasonButtonStyle(r.color, i));
    const emojiOk = sanitizeEmoji(r.emoji);
    if (emojiOk) btn.setEmoji(emojiOk);
    row.addComponents(btn);
  });
  if (row.components.length) rows.push(row);
  return rows;
}
function buildCloseButtonRow() {
  return buildTicketActionRow(false);
}
function buildTicketActionRow(claimEnabled, claimedBy = null) {
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close_btn').setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  if (claimEnabled) {
    const claimBtn = new ButtonBuilder().setCustomId('ticket_claim_btn').setEmoji('🖐️').setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary).setLabel(claimedBy ? 'Pris en charge' : 'Prendre en charge').setDisabled(!!claimedBy);
    row.addComponents(claimBtn);
  }
  return row;
}

// ────────────────────────────────────────────────
// Création du salon de ticket
// ────────────────────────────────────────────────
async function createTicketChannel(interaction, reasonLabel, reasonValue, answers, cfg, guild, user, panelChannelId) {
  const chKey = String(panelChannelId);
  const categoryId = cfg.ticket_categories?.[chKey];
  if (!categoryId) {
    return interaction.followUp({
      content: '❌ Catégorie de référence non configurée pour ce panneau.',
      flags: MessageFlags.Ephemeral
    });
  }
  const category = guild.channels.cache.get(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return interaction.followUp({
      content: '❌ Catégorie de référence introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  const channel = await guild.channels.create({
    name: `ticket-${user.username.toLowerCase()}-${reasonValue}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Ticket de ${user.tag} | ${reasonLabel}`,
    permissionOverwrites: [{
      id: guild.roles.everyone.id,
      deny: ['ViewChannel']
    }, {
      id: user.id,
      allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
    }, {
      id: guild.members.me.id,
      allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
    }],
    reason: `Ticket créé par ${user.tag}`
  });
  if (!cfg.ticket_counts) cfg.ticket_counts = {};
  const countKey = `${chKey}_${reasonValue}`;
  cfg.ticket_counts[countKey] = (cfg.ticket_counts[countKey] || 0) + 1;
  cfg.ticket_open_count = (cfg.ticket_open_count || 0) + 1;
  // Métadonnées utilisées par la transcription à la fermeture du ticket.
  cfg.ticket_seq = (cfg.ticket_seq || 0) + 1;
  if (!cfg.ticket_meta) cfg.ticket_meta = {};
  cfg.ticket_meta[channel.id] = {
    n: cfg.ticket_seq,
    openerId: user.id,
    openerTag: user.tag,
    reason: reasonLabel,
    openedAt: Date.now()
  };
  persist('config');
  const appearance = cfg.ticket_appearance?.[chKey] || {};
  const remplacerVariables = texte => (texte || '').replace(/\{membre\}/g, user.toString()).replace(/\{raison\}/g, reasonLabel);
  const titreOuverture = appearance.openTitle ? remplacerVariables(appearance.openTitle) : `🎫 Ticket – ${reasonLabel}`;
  const messageOuverture = appearance.openDescription ? remplacerVariables(appearance.openDescription) : `Merci ${user} !\n\n📋 **Récapitulatif de tes réponses :**`;
  const recap = new EmbedBuilder().setTitle(titreOuverture).setColor(appearance.color ?? 0xFFFFFF).setTimestamp().setDescription(messageOuverture);
  for (const [q, a] of Object.entries(answers)) {
    recap.addFields({
      name: `❓ ${q}`,
      value: (a || '*(vide)*').slice(0, 1024),
      inline: false
    });
  }
  const claimEnabled = !!cfg.ticket_claim_enabled?.[chKey];
  await channel.send(toCV2Payload({
    content: `${user}`,
    embeds: [recap],
    components: [buildTicketActionRow(claimEnabled)]
  }));
  await interaction.followUp({
    content: `✅ Ticket créé → ${channel}`,
    flags: MessageFlags.Ephemeral
  });
}

// ────────────────────────────────────────────────
// Formulaires dynamiques — modal de saisie (par groupes de 5)
// ────────────────────────────────────────────────
function buildFormModal(reasonLabel, fields, page) {
  const modal = new ModalBuilder().setCustomId(`ticket_form_submit_${page}`).setTitle(`🎫 ${reasonLabel.slice(0, 40)}${page > 1 ? ` (suite ${page})` : ''}`);
  fields.slice(0, 5).forEach((field, i) => {
    const input = new TextInputBuilder().setCustomId(`field_${i}`).setLabel((field.label || 'Question').slice(0, 45)).setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required !== false).setMaxLength(1024);
    if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

// État temporaire en mémoire pour les formulaires multi-pages (par utilisateur+panneau+raison)
const pendingForms = new Map();
function pendingKey(userId, panelChannelId, reasonValue) {
  return `${userId}_${panelChannelId}_${reasonValue}`;
}
module.exports = {
  COLOR_MAP,
  normalizeReasonColor,
  sanitizeEmoji,
  hexToInt,
  buildTicketConfigEmbed,
  buildTicketConfigRows,
  buildTicketConfigPayload,
  buildTicketPublishPayload,
  buildTicketReasonButtons,
  buildCloseButtonRow,
  buildTicketActionRow,
  createTicketChannel,
  buildFormModal,
  buildFormManagerRows,
  pendingForms,
  pendingKey,
  DOSSIER_IMAGES_FORMULAIRE,
  sauvegarderImageFormulaireLocalement,
  supprimerImageFormulaire,
  normFormMeta
};