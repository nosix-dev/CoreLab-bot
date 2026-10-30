'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Éditeur de la carte de bienvenue / au revoir par défaut (image « verre fumé »).
// Ouvert depuis le bouton « 🎨 Carte » du panneau /settings → Premium.
//
// Tout est modifiable : titre, sous-titre, étiquettes des pastilles (ou masquées avec « - »),
// style clair / sombre, couleurs (accent, fond, texte, pseudo, titre, sous-titre, pastilles, contour d'avatar),
// avatar (forme, taille, côté, contour), mise en page (hauteur, coins, taille du pseudo, format des dates),
// pastille libre, pied de carte, image de fond (assombrissement, flou, opacité du verre).
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
  const pick = (v, map, d) => (v === undefined ? d : (map[v] || d));
  const pct = (v, suf = '%') => (v === undefined ? 'défaut' : `\`${v}${suf}\``);
  return [
    `🎨 **Carte de ${kind === 'goodbye' ? 'au revoir' : 'bienvenue'}** (image par défaut)`,
    '',
    `**Textes** — titre : ${val(c.title)} · sous-titre : ${val(c.subtitle)}`,
    `Pastilles — n° de membre : ${val(c.pillMember)} · compte créé : ${val(c.pillCreated)}${kind === 'goodbye' ? ` · arrivé le : ${val(c.pillJoined)}` : ''}`,
    `**Pastille libre** — ${c.customPillValue ? `${val(c.customPillLabel, 'sans titre')} → ${val(c.customPillValue)}` : 'aucune'} · **Pied de carte** — ${val(c.footer, 'aucun')}`,
    `**Style** — ${c.style === 'sombre' ? 'sombre (verre fumé)' : 'clair'} · accent : ${val(c.accent)} · fond : ${val(c.bg)} · texte : ${val(c.textColor)}`,
    `**Couleurs détaillées** — pseudo : ${val(c.nameColor)} · titre : ${val(c.titleColor)} · sous-titre : ${val(c.subColor)} · pastilles : ${val(c.pillBg)} · contour avatar : ${val(c.ringColor)}`,
    `**Avatar** — ${c.hideAvatar ? 'masqué' : `${pick(c.avatarShape, { arrondi: 'carré arrondi', carre: 'carré' }, 'rond')} · ${pick(c.avatarSize, { petit: 'petit', grand: 'grand' }, 'taille normale')} · à ${c.avatarPos === 'droite' ? 'droite' : 'gauche'} · contour ${c.avatarRing === false ? 'masqué' : 'affiché'}`}`,
    `**Mise en page** — hauteur : ${pick(c.height, { compacte: 'compacte', haute: 'haute' }, 'normale')} · coins : ${pick(c.radius, { carre: 'carrés', leger: 'légers', rond: 'très arrondis' }, 'normaux')} · pseudo : ${pick(c.nameSize, { petit: 'petit', moyen: 'moyen', enorme: 'énorme' }, 'grand')} · dates : ${c.dateFormat === 'texte' ? '12 janv. 2026' : '12/01/2026'}`,
    `**Fond** — image : ${bg ? `✅ (${bg.ext})` : 'aucune'} · assombrissement : ${pct(c.bgDim)} · flou : ${pct(c.bgBlur, '')} · opacité du verre : ${pct(c.glassOpacity)}`,
    '👁️ L\'aperçu ci-dessous se met à jour automatiquement après chaque modification.',
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
      new ButtonBuilder().setCustomId(`${p}colors`).setLabel('🌈 Couleurs détaillées').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${p}avatar`).setLabel('🧑 Avatar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${p}layout`).setLabel('📐 Mise en page').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${p}extra`).setLabel('➕ Pastille & pied').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${p}bg`).setLabel('🖼️ Image de fond').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${p}bgset`).setLabel('🌫️ Réglages du fond').setStyle(ButtonStyle.Secondary),
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

// Nombre : '' → undefined (inchangé) · '-' / 'auto' → null (défaut) · invalide → false · sinon borné à [min, max]
function readNum(fields, id, min, max) {
  const raw = readText(fields, id).replace(',', '.').replace('%', '').trim();
  if (!raw) return undefined;
  if (raw === '-' || /^(auto|défaut|defaut|reset)$/i.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// Select : renvoie la valeur choisie, ou undefined si rien n'a été touché
function readSelect(fields, id) {
  try { return fields.getStringSelectValues(id)[0]; } catch { return undefined; }
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
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // Aperçu en direct : l'image du panneau est régénérée après chaque modification
  let n = 0;
  const buildPanel = async () => {
    const payload = { content: summary(guildId, kind), components: panelRows(kind), files: [], attachments: [] };
    try {
      const buf = await renderPreview(i, kind);
      payload.files = [new AttachmentBuilder(buf, { name: `apercu_${Date.now().toString(36)}${n++}.png` })];
    } catch (e) {
      console.error('[welcomeCardConfig] aperçu impossible :', e.message);
    }
    return payload;
  };
  const refresh = async () => i.editReply(await buildPanel()).catch(() => { });

  const msg = await i.editReply(await buildPanel());
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
        await sub.reply({ content: '✅ Textes enregistrés.', flags: MessageFlags.Ephemeral });
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
        await sub.reply({ content: '✅ Style enregistré.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      // Ouvre un modal, attend sa soumission et renvoie l'interaction du modal (ou null)
      const askModal = async (suffix, title, comps) => {
        const modalId = `${p}${suffix}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);
        modal.addLabelComponents(...comps);
        await bi.showModal(modal);
        return bi.awaitModalSubmit({ time: 180000, filter: mi => mi.customId === modalId && mi.user.id === i.user.id }).catch(() => null);
      };
      const SEL_DEFAULT = 'defaut';

      if (action === 'colors') {
        const sub = await askModal('colorsmodal', 'Couleurs détaillées', [
          textInput('nameColor', 'Couleur du pseudo (hex)', card.nameColor, { max: 7, placeholder: 'Ex : FFFFFF', desc: 'Vide = inchangé · auto = défaut' }),
          textInput('titleColor', 'Couleur du titre (hex)', card.titleColor, { max: 7, placeholder: 'Ex : AAAAAA', desc: 'Le petit texte du haut · vide = inchangé · auto = défaut' }),
          textInput('subColor', 'Couleur du sous-titre (hex)', card.subColor, { max: 7, placeholder: 'Ex : CCCCCC', desc: 'Vide = inchangé · auto = défaut' }),
          textInput('pillBg', 'Fond des pastilles (hex)', card.pillBg, { max: 7, placeholder: 'Ex : 5865F2', desc: 'Pastilles de stats et cadre de l\'avatar · auto = défaut' }),
          textInput('ringColor', 'Contour de l\'avatar (hex)', card.ringColor, { max: 7, placeholder: 'Ex : FFD700', desc: 'Vide = inchangé · auto = défaut' })
        ]);
        if (!sub) return;
        const vals = {};
        for (const k of ['nameColor', 'titleColor', 'subColor', 'pillBg', 'ringColor']) vals[k] = readHex(sub.fields, k);
        if (Object.values(vals).some(v => v === false)) {
          return sub.reply({ content: '❌ Couleur invalide. Utilise un code hexadécimal à 6 caractères, ex. : `5865F2`.', flags: MessageFlags.Ephemeral });
        }
        patchCard(guildId, kind, vals);
        await sub.reply({ content: '✅ Couleurs enregistrées.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'avatar') {
        const sub = await askModal('avatarmodal', 'Avatar', [
          selectLabel('shape', 'Forme', [
            { label: 'Rond', value: SEL_DEFAULT }, { label: 'Carré arrondi', value: 'arrondi' }, { label: 'Carré', value: 'carre' }
          ], card.avatarShape || SEL_DEFAULT),
          selectLabel('size', 'Taille', [
            { label: 'Petit', value: 'petit' }, { label: 'Normal', value: SEL_DEFAULT }, { label: 'Grand', value: 'grand' }
          ], card.avatarSize || SEL_DEFAULT),
          selectLabel('pos', 'Position', [
            { label: 'À gauche', value: SEL_DEFAULT }, { label: 'À droite', value: 'droite' }
          ], card.avatarPos || SEL_DEFAULT),
          selectLabel('ring', 'Contour de l\'avatar', [
            { label: 'Affiché', value: SEL_DEFAULT }, { label: 'Masqué', value: 'hide' }
          ], card.avatarRing === false ? 'hide' : SEL_DEFAULT, 'La couleur se règle dans « Couleurs détaillées »')
        ]);
        if (!sub) return;
        const shape = readSelect(sub.fields, 'shape');
        const size = readSelect(sub.fields, 'size');
        const pos = readSelect(sub.fields, 'pos');
        const ring = readSelect(sub.fields, 'ring');
        const norm = v => (v === undefined ? undefined : v === SEL_DEFAULT ? null : v);
        patchCard(guildId, kind, {
          avatarShape: norm(shape), avatarSize: norm(size), avatarPos: norm(pos),
          avatarRing: ring === undefined ? undefined : ring === 'hide' ? false : null
        });
        await sub.reply({ content: '✅ Avatar enregistré.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'layout') {
        const sub = await askModal('layoutmodal', 'Mise en page', [
          selectLabel('height', 'Hauteur de la carte', [
            { label: 'Compacte', value: 'compacte' }, { label: 'Normale', value: SEL_DEFAULT }, { label: 'Haute', value: 'haute' }
          ], card.height || SEL_DEFAULT),
          selectLabel('radius', 'Arrondi des coins', [
            { label: 'Carrés', value: 'carre' }, { label: 'Légèrement arrondis', value: 'leger' },
            { label: 'Normaux', value: SEL_DEFAULT }, { label: 'Très arrondis', value: 'rond' }
          ], card.radius || SEL_DEFAULT),
          selectLabel('nameSize', 'Taille du pseudo', [
            { label: 'Petit', value: 'petit' }, { label: 'Moyen', value: 'moyen' },
            { label: 'Grand', value: SEL_DEFAULT }, { label: 'Énorme', value: 'enorme' }
          ], card.nameSize || SEL_DEFAULT),
          selectLabel('dateFormat', 'Format des dates', [
            { label: '12/01/2026', value: SEL_DEFAULT }, { label: '12 janv. 2026', value: 'texte' }
          ], card.dateFormat || SEL_DEFAULT)
        ]);
        if (!sub) return;
        const norm = v => (v === undefined ? undefined : v === SEL_DEFAULT ? null : v);
        patchCard(guildId, kind, {
          height: norm(readSelect(sub.fields, 'height')),
          radius: norm(readSelect(sub.fields, 'radius')),
          nameSize: norm(readSelect(sub.fields, 'nameSize')),
          dateFormat: norm(readSelect(sub.fields, 'dateFormat'))
        });
        await sub.reply({ content: '✅ Mise en page enregistrée.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'extra') {
        const sub = await askModal('extramodal', 'Pastille libre & pied de carte', [
          textInput('customPillLabel', 'Pastille libre — titre', card.customPillLabel, { max: 24, placeholder: 'Ex : RÔLE', desc: 'Vide = sans titre · - = masquer le titre' }),
          textInput('customPillValue', 'Pastille libre — texte', card.customPillValue, { max: 40, placeholder: 'Ex : Nouveau membre', desc: 'Vide = pas de pastille · variables autorisées' }),
          textInput('footer', 'Pied de carte (petit texte en bas)', card.footer, { max: 100, placeholder: 'Ex : Bienvenue sur {server.name} !', desc: 'Vide = aucun · variables autorisées' })
        ]);
        if (!sub) return;
        patchCard(guildId, kind, {
          customPillLabel: readText(sub.fields, 'customPillLabel') || null,
          customPillValue: readText(sub.fields, 'customPillValue') || null,
          footer: readText(sub.fields, 'footer') || null
        });
        await sub.reply({ content: '✅ Pastille et pied de carte enregistrés.', flags: MessageFlags.Ephemeral });
        return refresh();
      }

      if (action === 'bgset') {
        const sub = await askModal('bgsetmodal', 'Réglages du fond', [
          textInput('bgDim', 'Assombrissement de l\'image (0-90)', card.bgDim, { max: 3, placeholder: 'Ex : 40', desc: 'Pour que le texte reste lisible · vide = inchangé · auto = défaut' }),
          textInput('bgBlur', 'Flou de l\'image (0-30)', card.bgBlur, { max: 3, placeholder: 'Ex : 8', desc: '0 = net · vide = inchangé · auto = défaut' }),
          textInput('glassOpacity', 'Opacité du verre (0-100)', card.glassOpacity, { max: 3, placeholder: 'Ex : 55', desc: '0 = transparent, 100 = opaque · vide = inchangé · auto = défaut' })
        ]);
        if (!sub) return;
        const dim = readNum(sub.fields, 'bgDim', 0, 90);
        const blur = readNum(sub.fields, 'bgBlur', 0, 30);
        const op = readNum(sub.fields, 'glassOpacity', 0, 100);
        if (dim === false || blur === false || op === false) {
          return sub.reply({ content: '❌ Valeur invalide. Utilise des nombres, ex. : `40`.', flags: MessageFlags.Ephemeral });
        }
        // 0 ne doit pas être traité comme « vide » par patchCard : on garde le nombre tel quel
        patchCard(guildId, kind, { bgDim: dim, bgBlur: blur, glassOpacity: op });
        await sub.reply({ content: '✅ Réglages du fond enregistrés.', flags: MessageFlags.Ephemeral });
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
            await bi.followUp({ content: '✅ Image de fond enregistrée.', flags: MessageFlags.Ephemeral });
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
    } catch (e) {
      console.error('[welcomeCardConfig]', e.message);
      const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
      if (bi.deferred || bi.replied) bi.followUp(payload).catch(() => { }); else bi.reply(payload).catch(() => { });
    }
  });

  collector.on('end', () => { i.editReply({ components: [] }).catch(() => { }); });
}

module.exports = { openCardEditor, getCard };