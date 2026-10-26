'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Rendu des panneaux /settings dans le style « Soutiens » :
//
//   ┃ ## 🌐 | Titre
//   ┃ ───────────────
//   ┃ 📌 | **Libellé:** valeur
//   ┃ 🔔 | **Libellé:** valeur
//   ┃ ───────────────
//   ┃ [ menu déroulant ]
//   ┃ [ bouton ] [ bouton ]
//   ┃ -# petit texte en bas
//
// Un seul Container (Components V2) avec la barre colorée à gauche ; les menus
// et les boutons sont placés DANS le conteneur, comme sur la capture.
// Le code existant continue de fabriquer des EmbedBuilder : on les convertit ici.
// ─────────────────────────────────────────────────────────────────────────

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require('discord.js');

// Couleur de la barre à gauche (couleur du bot). Une seule ligne à changer si besoin.
const CONFIG_ACCENT = 0xFFFFFF;

// Discord limite un Container à 10 composants enfants.
const MAX_CHILDREN = 10;

// Emoji de tête : emoji Unicode (avec variation) ou emoji perso <:nom:id>.
const LEAD_EMOJI_RE = /^((?:<a?:\w+:\d+>)|(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*))\s*(.*)$/su;

function toData(embed) {
  if (!embed) return {};
  return typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
}

function splitEmoji(text) {
  const s = String(text ?? '').trim();
  const m = s.match(LEAD_EMOJI_RE);
  if (m && m[2]) return { emoji: m[1], label: m[2].trim() };
  return { emoji: '', label: s };
}

// Champ d'embed -> ligne compacte « emoji | **Libellé:** valeur ».
// Les valeurs longues ou sur plusieurs lignes deviennent un bloc à part.
function fieldToEntry(field) {
  const { emoji, label } = splitEmoji(field.name);
  const value = String(field.value ?? '').trim() || '—';
  const compact = !value.includes('\n') && value.length <= 90;
  if (compact) {
    const head = emoji ? `${emoji} | ` : '▫️ | ';
    return { block: false, text: `${head}**${label}:** ${value}` };
  }
  return { block: true, text: `**${emoji ? `${emoji} | ` : ''}${label}**\n${value}` };
}

/**
 * Convertit un embed + des rangées de composants en Container « style Soutiens ».
 * @param {import('discord.js').EmbedBuilder|Object} embed
 * @param {Array} rows  ActionRowBuilder[] placées dans le conteneur
 * @param {{accent?:number, notice?:string}} [opts]
 */
function buildConfigContainer(embed, rows = [], opts = {}) {
  const d = toData(embed);
  const container = new ContainerBuilder().setAccentColor(opts.accent ?? CONFIG_ACCENT);

  // ── En-tête : « ## 🌐 | Titre » ──
  const { emoji, label } = splitEmoji(d.title || 'Configuration');
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${emoji ? `${emoji} | ` : ''}${label}`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // ── Corps : message d'information, description, lignes, blocs ──
  const compactLines = [];
  const blocks = [];
  for (const f of Array.isArray(d.fields) ? d.fields : []) {
    if (!f || String(f.name).trim() === '\u200b') continue;
    const entry = fieldToEntry(f);
    (entry.block ? blocks : compactLines).push(entry.text);
  }

  const body = [];
  if (opts.notice) body.push(String(opts.notice));
  if (d.description) body.push(String(d.description));
  if (compactLines.length) body.push(compactLines.join('\n'));
  body.push(...blocks);

  // Un seul TextDisplay (la limite de 10 enfants est vite atteinte avec 5 rangées).
  // Limite Discord : 4000 caractères de texte au total dans le message.
  const bodyText = (body.join('\n\n') || '\u200b').slice(0, 3500);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText));

  // ── Composants (menus, boutons) dans le conteneur ──
  const usableRows = (rows || []).filter(Boolean);
  const footerText = d.footer?.text ? `-# ${d.footer.text}` : '';

  // Enfants déjà posés : en-tête + séparateur + corps = 3 ; + séparateur avant les rangées.
  let used = 3;
  if (usableRows.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    used += 1;
    for (const row of usableRows) {
      if (used >= MAX_CHILDREN) break;
      container.addActionRowComponents(row);
      used += 1;
    }
  }
  if (footerText && used < MAX_CHILDREN) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText));
  }

  return container;
}

/**
 * Payload prêt à envoyer (reply / editReply / update / safeComponentUpdate).
 * Ne pas ajouter `content` ni `embeds` : interdits avec Components V2.
 * `opts.ephemeral` ajoute le flag éphémère (nouveau message uniquement).
 */
function configPayload(embed, rows = [], opts = {}) {
  let flags = MessageFlags.IsComponentsV2;
  if (opts.ephemeral) flags |= MessageFlags.Ephemeral;
  return {
    components: [buildConfigContainer(embed, rows, opts)],
    attachments: [],
    flags
  };
}

/**
 * Même chose que configPayload, mais avec une carte image (style /protect-settings) :
 * titre, grande image avec tuiles (une par paramètre), puis menus et boutons dans le conteneur.
 * Si le rendu de l'image échoue, buildSettingsPayload retombe sur l'ancien rendu.
 *
 * @param {import('discord.js').EmbedBuilder|Object} embed  embed du panneau (titre, description, champs)
 * @param {Array} rows  ActionRowBuilder[] placées sous la carte
 * @param {{guild:import('discord.js').Guild, file?:string, pill?:Object|null, ephemeral?:boolean, notice?:string}} opts
 *   pill : null = pas de pastille (défaut) ; undefined = ACTIVÉ/DÉSACTIVÉ déduit de la 1re tuile « état »
 */
function configCardPayload(embed, rows = [], opts = {}) {
  const { buildSettingsPayload, cardDataFromEmbed } = require('./settingsCard');
  const d = toData(embed);
  const data = cardDataFromEmbed(embed, opts.guild);
  const stateTiles = data.tiles.filter(t => t.state !== null);
  const subtitle = stateTiles.length
    ? `${stateTiles.filter(t => t.state).length}/${stateTiles.length} activés`
    : `${data.tiles.length} paramètre(s)`;

  const payload = buildSettingsPayload({
    guild: opts.guild,
    embed,
    rows,
    file: opts.file || 'config.png',
    notice: opts.notice || null,
    heading: d.title || null,
    subtitle,
    pill: 'pill' in opts ? opts.pill : null
  });
  if (opts.ephemeral) payload.flags = (payload.flags ?? MessageFlags.IsComponentsV2) | MessageFlags.Ephemeral;
  return payload;
}

module.exports = { CONFIG_ACCENT, buildConfigContainer, configPayload, configCardPayload };