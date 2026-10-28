'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Éditeur de la carte de bienvenue / au revoir par défaut (image « verre fumé »).
// Ouvert depuis le bouton « 🎨 Carte » du panneau /settings → Premium.
//
// Tout est modifiable : titre, sous-titre, étiquettes des pastilles (ou masquées avec « - »),
// style clair / sombre, couleurs (accent, fond, texte), image de fond, avatar affiché ou non.
// Les réglages sont stockés dans cfg.welcome_card / cfg.goodbye_card.
// Rendu : renderWelcomeCard() dans core/glassEmbed.js.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const { getGuildConfig } = require('./config');
const { persist } = require('./data');
const { renderWelcomeCard, findCardBackground, CARD_BG_DIR, CARD_BG_EXTS } = require('./glassEmbed');

const MAX_BG_SIZE = 8 * 1024 * 1024; // 8 Mo
const PANEL_TIMEOUT_MS = 10 * 60 * 1000;
const HEX_RE = /^#?([0-9a-f]{6})$/i;

function keyFor(kind) { return kind === 'goodbye' ? 'goodbye_card' : 'welcome_card'; }

function getCard(guildId, kind) {
  return getGuildConfig(guildId)[keyFor(kind)] || {};
}

function patchCard(guildId, kind, patch) {
  const cfg = getGuildConfig(guildId);
  const key = keyFor(kind);
  const next = { ...(cfg[key] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;          // champ non touché
    if (v === null || v === '') delete next[k]; // valeur vide = retour au défaut
    else next[k] = v;
  }
  if (Object.keys(next).length) cfg[key] = next; else delete cfg[key];
  persist('config');
}

function removeBackground(guildId, kind) {
  for (const ext of CARD_BG_EXTS) {
    const p = path.join(CARD_BG_DIR, `${guildId}_${kind}.${ext}`);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* ignoré */ } }
  }
}

function summary(guildId, kind) {
  const c = getCard(guildId, kind);
  const bg = findCardBackground(guildId, kind);
  const val = (v, d = 'défaut') => (v === undefined || v === '' ? d : (v === '-' ? 'masqué' : `\`${v}\``));
  return [
    `🎨 **Carte de ${kind === 'goodbye' ? 'au revoir' : 'bienvenue'}** (image par défaut)`,
    '',
    `**Textes** — titre : ${val(c.title)} · sous-titre : ${val(c.subtitle)}`,
    `Pastilles — n° de membre : ${val(c.pillMember)} · compte créé : ${val(c.pillCreated)}${kind === 'goodbye' ? ` · arrivé le : ${val(c.pillJoined)}` : ''}`,
    `**Style** — ${c.style === 'sombre' ? 'sombre (verre fumé)' : 'clair'} · accent : ${val(c.accent)} · fond : ${val(c.bg)} · texte : ${val(c.textColor)} · avatar : ${c.hideAvatar ? 'masqué' : 'affiché'}`,
    `**Image de fond** — ${bg ? `✅ définie (${bg.ext})` : 'aucune'}`,
    '',
    'Variables dans les textes : `{user.name}` `{server.name}` `{server.member_count}`',
    'Un champ laissé vide = valeur par défaut. Mets `-` pour masquer un élément.',
    'ℹ️ Si une image personnalisée complète est définie avec le bouton « Image », elle remplace cette carte.'
  ].join('\n');
}

function panelRows(kind) {
  const p = `wcard_${kind}_`;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${p}text`).setLabel('✏️ Textes').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${p}style`).setLabel('🎨 Style & couleurs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${p}bg`).setLabel('🖼️ Image de fond').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${p}preview`).setLabel('👁️ Aperçu').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${p}bgdel`).setLabel('Retirer le fond').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${p}reset`).setLabel('♻️ Tout réinitialiser').setStyle(ButtonStyle.Danger)
    )
  ];
}

function textInput(id, label, value, { style = TextInputStyle.Short, max = 100, placeholder, desc } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(false).setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  if (value) input.setValue(String(value).slice(0, max));
  const l = new LabelBuilder().setLabel(label.slice(0, 45)).setTextInputComponent(input);
  if (desc) l.setDescription(desc.slice(0, 100));
  return l;
}

function selectLabel(id, label, options, current, desc) {
  const select = new StringSelectMenuBuilder().setCustomId(id).setRequired(false).setMinValues(0).setMaxValues(1)
    .addOptions(options.map(o => new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setDefault(o.value === current)));
  const l = new LabelBuilder().setLabel(label).setStringSelectMenuComponent(select);
  if (desc) l.setDescription(desc.slice(0, 100));
  return l;
}

function readText(fields, id) {
  try { return fields.getTextInputValue(id).trim(); } catch { return ''; }
}

// Hex : '' → undefined (inchangé) · 'auto' ou '-' → null (défaut) · invalide → false
function readHex(fields, id) {
  const raw = readText(fields, id);
  if (!raw) return undefined;
  if (raw === '-' || /^(auto|défaut|defaut|reset)$/i.test(raw)) return null;
  const m = raw.match(HEX_RE);
  return m ? `#${m[1].toLowerCase()}` : false;
}

async function renderPreview(interaction, kind) {
  const guild = interaction.guild;
  const member = interaction.member;
  return renderWelcomeCard({
    guildId: guild.id,
    kind,
    username: member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
    serverName: guild.name,
    memberCount: guild.memberCount,
    card: getCard(guild.id, kind),
    createdTs: interaction.user.createdTimestamp,
    joinedTs: member?.joinedTimestamp
  });
}

/**
 * Ouvre l'éditeur de carte. `i` = interaction du bouton « 🎨 Carte ».
 * @param {'welcome'|'goodbye'} kind
 */
async function openCardEditor(i, kind) {
  const guildId = i.guild.id;
  const p = `wcard_${kind}_`;
  const msg = await i.reply({
    content: summary(guildId, kind),
    components: panelRows(kind),
    flags: MessageFlags.Ephemeral,
    fetchReply: true
  });

  const refresh = () => i.editReply({ content: summary(guildId, kind), components: panelRows(kind) }).catch(() => { });
  const collector = msg.createMessageComponentCollector({
    filter: bi => bi.user.id === i.user.id && bi.customId.startsWith(p),
    time: PANEL_TIMEOUT_MS
  });

  collector.on('collect', async bi => {
    try {
      const action = bi.customId.slice(p.length);
      const card = getCard(guildId, kind);

      if (action === 'text') {
        const modalId = `${p}textmodal`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Textes de la carte');
        const comps = [
          textInput('title', 'Titre (petit texte du haut)', card.title, { max: 40, placeholder: kind === 'goodbye' ? 'AU REVOIR' : 'BIENVENUE', desc: 'Vide = défaut · - = masquer' }),
          textInput('subtitle', 'Sous-titre', card.subtitle, { max: 120, placeholder: 'vient de rejoindre {server.name}', desc: '{user.name} {server.name} {server.member_count}' }),
          textInput('pillMember', 'Pastille n° de membre', card.pillMember, { max: 24, placeholder: kind === 'goodbye' ? 'MEMBRES RESTANTS' : 'MEMBRE N°', desc: 'Vide = défaut · - = masquer' }),
          textInput('pillCreated', 'Pastille compte créé', card.pillCreated, { max: 24, placeholder: 'COMPTE CRÉÉ', desc: 'Vide = défaut · - = masquer' })
        ];
        if (kind === 'goodbye') comps.push(textInput('pillJoined', 'Pastille arrivé le', card.pillJoined, { max: 24, placeholder: 'ARRIVÉ LE', desc: 'Vide = défaut · - = masquer' }));
        modal.addLabelComponents(...comps);
        await bi.showModal(modal);
        const sub = await bi.awaitModalSubmit({ time: 180000, filter: mi => mi.customId === modalId && mi.user.id === i.user.id }).catch(() => null);
        if (!sub) return;
        const patch = {};
        for (const k of ['title', 'subtitle', 'pillMember', 'pillCreated', ...(kind === 'goodbye' ? ['pillJoined'] : [])]) {
          patch[k] = readText(sub.fields, k) || null; // vide → défaut
        }
        patchCard(guildId, kind, patch);
        await sub.reply({ content: '✅ Textes enregistrés. Clique sur « 👁️ Aperçu » pour voir le rendu.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'style') {
        const modalId = `${p}stylemodal`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Style & couleurs');
        modal.addLabelComponents(
          selectLabel('style', 'Style', [
            { label: 'Clair', value: 'clair' },
            { label: 'Sombre (verre fumé)', value: 'sombre' }
          ], card.style || 'clair'),
          textInput('accent', 'Couleur d\'accent (hex)', card.accent, { max: 7, placeholder: 'Ex : 5865F2', desc: 'Halo du fond en style sombre · vide = inchangé · auto = défaut' }),
          textInput('bg', 'Couleur de fond (hex)', card.bg, { max: 7, placeholder: 'Ex : 101820', desc: 'Remplace le dégradé · vide = inchangé · auto = défaut' }),
          textInput('textColor', 'Couleur du texte (hex)', card.textColor, { max: 7, placeholder: 'Ex : FFFFFF', desc: 'Vide = inchangé · auto = défaut' }),
          selectLabel('avatar', 'Avatar du membre', [
            { label: 'Afficher', value: 'show' },
            { label: 'Masquer', value: 'hide' }
          ], card.hideAvatar ? 'hide' : 'show')
        );
        await bi.showModal(modal);
        const sub = await bi.awaitModalSubmit({ time: 180000, filter: mi => mi.customId === modalId && mi.user.id === i.user.id }).catch(() => null);
        if (!sub) return;
        const accent = readHex(sub.fields, 'accent');
        const bg = readHex(sub.fields, 'bg');
        const textColor = readHex(sub.fields, 'textColor');
        if (accent === false || bg === false || textColor === false) {
          return sub.reply({ content: '❌ Couleur invalide. Utilise un code hexadécimal à 6 caractères, ex. : `5865F2`.', flags: MessageFlags.Ephemeral });
        }
        let style; try { style = sub.fields.getStringSelectValues('style')[0]; } catch { /* inchangé */ }
        let avatar; try { avatar = sub.fields.getStringSelectValues('avatar')[0]; } catch { /* inchangé */ }
        patchCard(guildId, kind, {
          style: style === 'sombre' ? 'sombre' : style === 'clair' ? null : undefined, // clair = défaut
          accent, bg, textColor,
          hideAvatar: avatar === 'hide' ? true : avatar === 'show' ? null : undefined
        });
        await sub.reply({ content: '✅ Style enregistré. Clique sur « 👁️ Aperçu » pour voir le rendu.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'bg') {
        await bi.reply({ content: '🖼️ Envoie une image dans ce salon (60 secondes) : elle servira de fond à la carte. Taille max 8 Mo (PNG, JPG, WebP ; un GIF utilisera sa première image).', flags: MessageFlags.Ephemeral });
        const imgCollector = bi.channel.createMessageCollector({
          filter: m => m.author.id === i.user.id && m.attachments.size > 0,
          time: 60000,
          max: 1
        });
        imgCollector.on('collect', async m => {
          const att = m.attachments.first();
          const extFromType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[att.contentType?.split(';')[0]];
          if (!extFromType) return bi.followUp({ content: '❌ Ce n\'est pas une image valide (PNG, JPG, WebP ou GIF).', flags: MessageFlags.Ephemeral });
          if (att.size > MAX_BG_SIZE) return bi.followUp({ content: `❌ Image trop lourde (${(att.size / 1024 / 1024).toFixed(1)} Mo, max 8 Mo).`, flags: MessageFlags.Ephemeral });
          try {
            const res = await fetch(att.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.mkdirSync(CARD_BG_DIR, { recursive: true });
            removeBackground(guildId, kind);
            fs.writeFileSync(path.join(CARD_BG_DIR, `${guildId}_${kind}.${extFromType}`), buffer);
            await bi.followUp({ content: '✅ Image de fond enregistrée. Clique sur « 👁️ Aperçu » pour voir le rendu.', flags: MessageFlags.Ephemeral });
            refresh();
          } catch (e) {
            console.error('Image de fond de carte non enregistrée :', e.message);
            await bi.followUp({ content: '❌ Erreur lors de l\'enregistrement.', flags: MessageFlags.Ephemeral });
          }
        });
        imgCollector.on('end', collected => {
          if (collected.size === 0) bi.followUp({ content: '⏱️ Temps écoulé, aucune image reçue.', flags: MessageFlags.Ephemeral }).catch(() => { });
        });
        return;
      }

      if (action === 'bgdel') {
        removeBackground(guildId, kind);
        await bi.reply({ content: '✅ Image de fond retirée.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'reset') {
        patchCard(guildId, kind, Object.fromEntries(Object.keys(card).map(k => [k, null])));
        removeBackground(guildId, kind);
        await bi.reply({ content: '✅ Carte réinitialisée (rendu par défaut).', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'preview') {
        await bi.deferReply({ flags: MessageFlags.Ephemeral });
        const buf = await renderPreview(bi, kind);
        return bi.editReply({ content: 'Aperçu avec ton profil :', files: [new AttachmentBuilder(buf, { name: 'apercu.png' })] });
      }
    } catch (e) {
      console.error('[welcomeCardConfig]', e.message);
      const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
      if (bi.deferred || bi.replied) bi.followUp(payload).catch(() => { }); else bi.reply(payload).catch(() => { });
    }
  });

  collector.on('end', () => { i.editReply({ components: [] }).catch(() => { }); });
}

module.exports = { openCardEditor, getCard };
