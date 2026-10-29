'use strict';

// ─────────────────────────────────────────────────────────────────────────
// protectionSetup.js — Installation guidée de la protection à l'ajout du bot
//
//  1. À l'ajout du bot (guildCreate) : crée le salon « 🛡️・logs-protection »
//     tout en haut de la liste, visible uniquement par les administrateurs
//     (et le bot), et l'enregistre comme salon de logs de protection.
//  2. Y poste le message de bienvenue : bouton bleu « Setup », lien vers la
//     documentation, lien vers le serveur de support.
//  3. « Setup » ouvre un assistant (message éphémère, Components V2) en
//     4 étapes + récapitulatif, avec tous les réglages de protection répartis
//     sur les pages. Les choix sont appliqués immédiatement.
//
// Les boutons/menus de l'assistant ont le préfixe `psetup_` (routés depuis
// index.js vers routeProtectionSetupInteraction). Les réglages détaillés
// (RaidMode, Captcha, HoneyPot…) réutilisent les panneaux de /protect-settings.
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { persist } = require('../core/data');
const { LANGUAGES } = require('../core/i18n');
const { MODULES, buildProtectPayload } = require('../core/protectCard');
const { PANEL_OPENERS } = require('./protection');

// ── Constantes ──
const LOG_CHANNEL_NAME = '🛡️・logs-protection';
const SUPPORT_URL = process.env.SUPPORT_URL || 'https://discord.gg/WecpyxrSBT';
// Lien « site / documentation » (surchargeable via DOCS_URL)
const DOCS_URL = process.env.DOCS_URL || 'https://corelab-4cn.pages.dev/docs';
const TOTAL_STEPS = 4;

// ─────────────────────────────────────────────────────────────────────────
// 1. Salon de logs + message de bienvenue
// ─────────────────────────────────────────────────────────────────────────

// Crée (ou retrouve) le salon, tout en haut, réservé aux administrateurs et au bot
async function ensureLogChannel(guild) {
  const cfg = getGuildConfig(guild.id);
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

  // Réinvitation / relance : on réutilise le salon existant au lieu d'en recréer un
  let channel = cfg.protection_setup_channel_id ? guild.channels.cache.get(String(cfg.protection_setup_channel_id)) : null;
  if (!channel) channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === LOG_CHANNEL_NAME) ?? null;

  if (!channel) {
    const overwrites = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (me) {
      overwrites.push({
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }
    channel = await guild.channels.create({
      name: LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: 'Journal des actions de protection du bot — visible uniquement par les administrateurs.',
      permissionOverwrites: overwrites,
      position: 0,
      reason: 'Salon de logs de protection (installation du bot)'
    });
  }
  // Tout en haut de la liste (au-dessus des catégories)
  await channel.setPosition(0).catch(() => { });

  cfg.protection_setup_channel_id = channel.id;
  if (!cfg.protection_log_channel_id) cfg.protection_log_channel_id = channel.id;
  persist('configuration');
  return channel;
}

function buildSetupMessage(guild, client) {
  const name = client.user.username;
  const botRole = guild.members.me?.roles?.botRole;
  const roleMention = botRole ? `<@&${botRole.id}>` : `**${name}**`;

  const welcome = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(`Merci d'avoir installé ${name} ❤️`)
    .setDescription(
      `**Pour bien commencer, nous vous recommandons de [consulter notre documentation](${DOCS_URL}) et de [rejoindre notre serveur Discord](${SUPPORT_URL}).**\n\n` +
      `Ce salon, visible uniquement par les administrateurs pour l'instant, trace les actions de protection de ${name}. Vous pouvez le changer avec \`/protect-settings\`.\n\n` +
      `⚠️ Placez le rôle ${roleMention} le plus haut possible pour que le bot fonctionne correctement.`
    );

  const scam = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle('👁️ Protection anti-arnaque')
    .setDescription(
      'Les liens de phishing et les images d\'arnaque (crypto, faux giveaways…) peuvent être détectés automatiquement : ' +
      'le message est supprimé et son auteur sanctionné. Activez-les à l\'étape 3 de **Setup**.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('psetup_start').setLabel('Setup').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel('Voir la documentation').setEmoji('📖').setStyle(ButtonStyle.Link).setURL(DOCS_URL),
    new ButtonBuilder().setLabel('Rejoindre le support').setEmoji('💬').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL)
  );
  return { embeds: [welcome, scam], components: [row] };
}

function registerProtectionSetupHandler(client) {
  client.on('guildCreate', async guild => {
    try {
      // Si le bot a été retiré entre-temps (serveur blacklisté…), on ne fait rien
      if (!guild.available || !client.guilds.cache.has(guild.id)) return;
      const channel = await ensureLogChannel(guild);
      await channel.send(buildSetupMessage(guild, client));
    } catch (e) {
      // Le plus souvent : permission « Gérer les salons » manquante
      console.warn(`[ProtectionSetup] Salon ${LOG_CHANNEL_NAME} non créé sur ${guild.name} :`, e.message);
    }
  });
  console.log(`✅ Installation guidée de la protection (${LOG_CHANNEL_NAME} + Setup) initialisée.`);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Assistant de configuration (Components V2)
// ─────────────────────────────────────────────────────────────────────────

// Protections activables par simple coche, par page
const TOGGLES = {
  2: [
    { key: 'raidmode', label: 'RaidMode', desc: 'Anti-raid automatique', get: c => c.raidmode_enabled, set: (c, v) => { c.raidmode_enabled = v; } },
    { key: 'antiddos', label: 'Anti-DDoS', desc: 'Inondation de messages', get: c => c.anti_ddos_enabled, set: (c, v) => { c.anti_ddos_enabled = v; } },
    { key: 'antiddosvoice', label: 'Anti-DDoS vocal', desc: 'Inondation de connexions vocales', get: c => c.anti_ddos_voice_enabled, set: (c, v) => { c.anti_ddos_voice_enabled = v; } },
    { key: 'minage', label: 'Âge minimum du compte', desc: 'Expulse les comptes trop récents (3 j par défaut)', get: c => Number(c.min_account_age_days) > 0, set: (c, v) => { c.min_account_age_days = v ? (Number(c.min_account_age_days) || 3) : 0; } },
    { key: 'anti_bot', label: 'Anti-bot', desc: 'Bots non autorisés', get: c => c.anti_bot_enabled, set: (c, v) => { c.anti_bot_enabled = v; } },
    { key: 'anti_alt', label: 'Anti-alt', desc: 'Comptes alternatifs', get: c => c.anti_alt_enabled, set: (c, v) => { c.anti_alt_enabled = v; } },
    { key: 'dm_lock', label: 'Fermeture des MP', desc: 'MP des membres fermés', get: c => c.dm_lock_enabled, set: (c, v) => { c.dm_lock_enabled = v; } }
  ],
  3: [
    { key: 'antispam', label: 'Anti-spam', desc: 'Messages répétés', get: c => c.antispam, set: (c, v) => { c.antispam = v; } },
    { key: 'antieveryone', label: 'Anti-@everyone', desc: 'Mentions de masse', get: c => c.antieveryone, set: (c, v) => { c.antieveryone = v; } },
    { key: 'anti_link', label: 'Anti-lien', desc: 'Liens non autorisés', get: c => c.anti_link_enabled, set: (c, v) => { c.anti_link_enabled = v; } },
    { key: 'anti_nuke', label: 'Anti-Nuke', desc: 'Actions destructrices', get: c => c.anti_nuke_enabled, set: (c, v) => { c.anti_nuke_enabled = v; } },
    { key: 'anti_ghost', label: 'Anti-Ghostping', desc: 'Mentions supprimées', get: c => c.anti_ghostping_enabled, set: (c, v) => { c.anti_ghostping_enabled = v; } },
    { key: 'anti_phishing', label: 'Anti-phishing', desc: 'Liens frauduleux', get: c => c.anti_phishing, set: (c, v) => { c.anti_phishing = v; } },
    { key: 'anti_scam', label: 'Anti-arnaque (OCR)', desc: 'Images d\'arnaque (crypto…)', get: c => c.anti_scam_image, set: (c, v) => { c.anti_scam_image = v; } }
  ],
  4: [
    { key: 'double', label: 'Compte double', desc: 'Détection des doublons', get: c => c.auth_double_detection_enabled, set: (c, v) => { c.auth_double_detection_enabled = v; } }
  ]
};

// Réglages détaillés : réutilisent les panneaux de /protect-settings
const DETAIL_OPENERS = {
  2: [
    { key: 'raidmode', label: 'RaidMode', emoji: '🚨' },
    { key: 'antiddos', label: 'Anti-DDoS', emoji: '🌊' },
    { key: 'antiddosvoice', label: 'Anti-DDoS vocal', emoji: '🎙️' },
    { key: 'minage', label: 'Âge minimum', emoji: '⏳' },
    { key: 'captcha', label: 'Captcha', emoji: '🔒' },
    { key: 'auth', label: 'Authentification', emoji: '🪪' }
  ],
  4: [
    { key: 'honeypot', label: 'HoneyPot', emoji: '🍯' },
    { key: 'tagrole', label: 'Rôle de Tag', emoji: '🏷️' },
    { key: 'sanctions', label: 'Sanctions (action par défaut)', emoji: '⚠️' }
  ]
};

const PAGE_META = {
  1: { emoji: '⚙️', title: 'Général', intro: 'Commençons par la langue et les salons où le bot écrit ses journaux. Chaque choix est appliqué tout de suite.' },
  2: { emoji: '🚨', title: 'Anti-raid & accès', intro: 'Protège les arrivées : coche les protections à activer. Pour ajuster les seuils, ouvre le réglage détaillé.' },
  3: { emoji: '🧹', title: 'Anti-abus', intro: 'Protège les salons : spam, mentions de masse, liens frauduleux, images d\'arnaque…' },
  4: { emoji: '🗂️', title: 'Modération & suivi', intro: 'Signalements, transparence et protections avancées (HoneyPot, rôle de tag, authentification…).' }
};

const text = s => new TextDisplayBuilder().setContent(String(s).slice(0, 3900));
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const rowOf = (...c) => new ActionRowBuilder().addComponents(...c);

// Avertit si des rôles sont au-dessus du rôle du bot (il ne pourrait pas les sanctionner)
function roleWarning(guild) {
  const me = guild.members.me;
  if (!me) return null;
  const above = guild.roles.cache.filter(r => r.id !== guild.id && r.position > me.roles.highest.position);
  if (!above.size) return null;
  const botRole = me.roles.botRole;
  const ref = botRole ? `<@&${botRole.id}>` : 'le rôle du bot';
  return `⚠️ **${above.size} rôle(s)** sont au-dessus de ${ref} : leurs membres échappent aux sanctions, et le bot ne peut pas attribuer ces rôles. Montez ${ref} au-dessus d'eux dans **Paramètres du serveur > Rôles**.`;
}

function channelSelect(customId, placeholder, currentId, guild) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (currentId && guild.channels.cache.has(String(currentId))) menu.setDefaultChannels(String(currentId));
  return rowOf(menu);
}

function toggleSelect(page, cfg) {
  const defs = TOGGLES[page];
  return rowOf(
    new StringSelectMenuBuilder()
      .setCustomId(`psetup_tog_${page}`)
      .setPlaceholder('Protections à activer…')
      .setMinValues(0)
      .setMaxValues(defs.length)
      .addOptions(defs.map(d => ({
        label: d.label,
        value: d.key,
        description: d.desc,
        emoji: d.get(cfg) ? '🟢' : '⚪',
        default: !!d.get(cfg)
      })))
  );
}

function detailSelect(page) {
  return rowOf(
    new StringSelectMenuBuilder()
      .setCustomId('psetup_open')
      .setPlaceholder('Réglages détaillés…')
      .addOptions(DETAIL_OPENERS[page].map(d => ({ label: d.label, value: d.key, emoji: d.emoji })))
  );
}

// Rangée de navigation (5 boutons max) : Précédent · Suivant · Vue d'ensemble · Support · Documentation
function navRow(page) {
  const last = page === TOTAL_STEPS;
  return rowOf(
    new ButtonBuilder().setCustomId(`psetup_page_${page - 1}`).setLabel('Précédent').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(last ? 'psetup_recap_end' : `psetup_page_${page + 1}`).setLabel(last ? 'Récapitulatif' : 'Suivant').setEmoji('▶️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('psetup_recap').setLabel('Vue d\'ensemble').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
    new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(DOCS_URL)
  );
}

function wrap(container) {
  return { components: [container], attachments: [], flags: MessageFlags.IsComponentsV2 };
}

function buildPage(guild, page) {
  const cfg = getGuildConfig(guild.id);
  const meta = PAGE_META[page];
  const c = new ContainerBuilder().setAccentColor(0xFFFFFF);

  const warn = roleWarning(guild);
  if (warn) c.addTextDisplayComponents(text(warn)).addSeparatorComponents(sep());

  c.addTextDisplayComponents(text(`## ${meta.emoji} ${meta.title} · étape ${page}/${TOTAL_STEPS}\n${meta.intro}`));
  c.addSeparatorComponents(sep());

  if (page === 1) {
    const lang = LANGUAGES[cfg.language] ? cfg.language : 'fr';
    c.addTextDisplayComponents(text(`### 🌐 Langue\nLes messages publics du bot (bienvenue, captcha, logs) suivent cette langue.`));
    c.addActionRowComponents(rowOf(
      new StringSelectMenuBuilder()
        .setCustomId('psetup_lang')
        .setPlaceholder('Langue du bot')
        .addOptions(Object.entries(LANGUAGES).map(([code, info]) => ({ label: info.name, value: code, emoji: info.flag, default: code === lang })))
    ));
    c.addTextDisplayComponents(text(`### 📋 Salon de logs de protection\nAlertes RaidMode, captcha, anti-spam, anti-@everyone… Actuel : ${cfg.protection_log_channel_id ? `<#${cfg.protection_log_channel_id}>` : '*non défini*'}`));
    c.addActionRowComponents(channelSelect('psetup_logs', 'Choisis le salon de logs', cfg.protection_log_channel_id, guild));
    c.addTextDisplayComponents(text(`### ⚠️ Salon des sanctions\nJournal des sanctions (bans, kicks, timeouts…). Actuel : ${cfg.infraction_channel_id ? `<#${cfg.infraction_channel_id}>` : '*non défini*'}`));
    c.addActionRowComponents(channelSelect('psetup_sanctions', 'Choisis le salon des sanctions', cfg.infraction_channel_id, guild));
  } else {
    c.addTextDisplayComponents(text('### 🛡️ Protections'));
    c.addActionRowComponents(toggleSelect(page, cfg));
    if (page === 4) {
      c.addTextDisplayComponents(text(`### 🚩 Signalements\nSalon où arrivent les signalements faits avec \`/report\`. Actuel : ${cfg.signalement_enabled && cfg.signalement_channel_id ? `<#${cfg.signalement_channel_id}>` : '*désactivé*'}`));
      c.addActionRowComponents(channelSelect('psetup_signal', 'Choisis le salon des signalements', cfg.signalement_channel_id, guild));
      c.addTextDisplayComponents(text(`### 📖 Transparence\nRepublie les alertes de protection dans un salon visible des membres. Actuel : ${cfg.transparence_enabled && cfg.transparence_channel_id ? `<#${cfg.transparence_channel_id}>` : '*désactivé*'}`));
      c.addActionRowComponents(channelSelect('psetup_transp', 'Choisis le salon public de transparence', cfg.transparence_channel_id, guild));
    }
    if (DETAIL_OPENERS[page]) {
      c.addTextDisplayComponents(text('### 🔧 Réglages détaillés\nOuvre le panneau complet du module (seuils, rôles, salons…).'));
      c.addActionRowComponents(detailSelect(page));
    }
  }

  c.addSeparatorComponents(sep());
  c.addActionRowComponents(navRow(page));
  return wrap(c);
}

// Récapitulatif : état de tous les modules + actions finales
const RECAP_GROUPS = [
  { title: '🚨 Anti-raid & accès', keys: ['raidmode', 'antiddos', 'antiddosvoice', 'captcha', 'minage', 'anti_bot_enabled', 'anti_alt_enabled', 'dm_lock_enabled', 'auth', 'auth_double_detection_enabled'] },
  { title: '🧹 Anti-abus', keys: ['antispam', 'antieveryone', 'anti_link_enabled', 'anti_nuke_enabled', 'anti_ghostping_enabled', 'anti_phishing', 'anti_scam_image'] },
  { title: '🗂️ Modération & suivi', keys: ['logs', 'signalement', 'sanctions', 'transparence', 'tagrole', 'honeypot'] }
];

function buildRecap(guild, notice = null) {
  const cfg = getGuildConfig(guild.id);
  const byKey = Object.fromEntries(MODULES.map(m => [m.key, m]));
  const active = MODULES.filter(m => m.on(cfg)).length;

  const c = new ContainerBuilder().setAccentColor(0xFFFFFF);
  const warn = roleWarning(guild);
  if (warn) c.addTextDisplayComponents(text(warn)).addSeparatorComponents(sep());
  c.addTextDisplayComponents(text(`## 📋 Récapitulatif\n**${active}/${MODULES.length}** modules actifs sur **${guild.name}**.`));
  if (notice) c.addTextDisplayComponents(text(notice));
  c.addSeparatorComponents(sep());
  for (const g of RECAP_GROUPS) {
    const lines = g.keys.map(k => byKey[k]).filter(Boolean).map(m => `${m.on(cfg) ? '🟢' : '⚪'} **${m.label}** — ${m.sub(cfg)}`);
    c.addTextDisplayComponents(text(`### ${g.title}\n${lines.join('\n')}`));
  }
  c.addSeparatorComponents(sep());
  c.addActionRowComponents(rowOf(
    new ButtonBuilder().setCustomId(`psetup_page_${TOTAL_STEPS}`).setLabel('Précédent').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('psetup_reco').setLabel('Config recommandée').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('psetup_dash').setLabel('Panneau complet').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('psetup_done').setLabel('Terminer').setEmoji('✔️').setStyle(ButtonStyle.Success)
  ));
  c.addActionRowComponents(rowOf(
    new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
    new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(DOCS_URL)
  ));
  return wrap(c);
}

// Active un socle de protections raisonnable (sans rien qui nécessite un rôle/salon)
function applyRecommended(cfg) {
  cfg.antispam = true;
  cfg.antieveryone = true;
  cfg.anti_phishing = true;
  cfg.anti_scam_image = true;
  cfg.anti_nuke_enabled = true;
  cfg.raidmode_enabled = true;
  cfg.anti_ddos_enabled = true;
  cfg.anti_ddos_voice_enabled = true;
  cfg.min_account_age_days = Number(cfg.min_account_age_days) || 3;
  persist('configuration');
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Routeur des interactions `psetup_*`
// ─────────────────────────────────────────────────────────────────────────
async function routeProtectionSetupInteraction(interaction) {
  try {
    if (!interaction.inGuild() || !interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur** pour utiliser le setup.', flags: MessageFlags.Ephemeral });
    }
    const guild = interaction.guild;
    const cfg = getGuildConfig(guild.id);
    const id = interaction.customId || '';

    // Accusé de réception immédiat : Discord coupe l'interaction au bout de 3 s
    const selfAnswered = id === 'psetup_start' || id === 'psetup_open';
    if (!selfAnswered && interaction.isMessageComponent?.()) await interaction.deferUpdate();

    if (interaction.isButton()) {
      if (id === 'psetup_start') {
        return interaction.reply({ ...buildPage(guild, 1), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      }
      if (id.startsWith('psetup_page_')) {
        const page = Math.min(Math.max(parseInt(id.slice('psetup_page_'.length), 10) || 1, 1), TOTAL_STEPS);
        return interaction.editReply(buildPage(guild, page));
      }
      if (id === 'psetup_recap' || id === 'psetup_recap_end') return interaction.editReply(buildRecap(guild));
      if (id === 'psetup_reco') {
        applyRecommended(cfg);
        return interaction.editReply(buildRecap(guild, '✅ Config recommandée appliquée : anti-spam, anti-@everyone, anti-phishing, anti-arnaque, anti-nuke, RaidMode, anti-DDoS et âge minimum.'));
      }
      if (id === 'psetup_dash') return interaction.editReply(buildProtectPayload(guild));
      if (id === 'psetup_done') {
        // Supprime le panneau (message éphémère ou public)
        const ok = await interaction.deleteReply().then(() => true).catch(() => false);
        if (!ok) await interaction.message?.delete().catch(() => { });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (id === 'psetup_lang') {
        const code = interaction.values[0];
        if (LANGUAGES[code]) { cfg.language = code; persist('configuration'); }
        return interaction.editReply(buildPage(guild, 1));
      }
      if (id.startsWith('psetup_tog_')) {
        const page = parseInt(id.slice('psetup_tog_'.length), 10);
        const defs = TOGGLES[page];
        if (!defs) return;
        for (const d of defs) d.set(cfg, interaction.values.includes(d.key));
        persist('configuration');
        return interaction.editReply(buildPage(guild, page));
      }
      if (id === 'psetup_open') {
        const open = PANEL_OPENERS[interaction.values[0]];
        return open ? open(interaction) : interaction.deferUpdate();
      }
    }

    if (interaction.isChannelSelectMenu()) {
      const channelId = interaction.values[0];
      if (id === 'psetup_logs') { cfg.protection_log_channel_id = channelId; persist('configuration'); return interaction.editReply(buildPage(guild, 1)); }
      if (id === 'psetup_sanctions') { cfg.infraction_channel_id = channelId; persist('configuration'); return interaction.editReply(buildPage(guild, 1)); }
      if (id === 'psetup_signal') { cfg.signalement_channel_id = channelId; cfg.signalement_enabled = true; persist('configuration'); return interaction.editReply(buildPage(guild, 4)); }
      if (id === 'psetup_transp') { cfg.transparence_channel_id = channelId; cfg.transparence_enabled = true; persist('configuration'); return interaction.editReply(buildPage(guild, 4)); }
    }
  } catch (e) {
    console.error('Erreur routeProtectionSetupInteraction :', e);
    const msg = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => { });
    else await interaction.reply(msg).catch(() => { });
  }
}

module.exports = {
  registerProtectionSetupHandler,
  routeProtectionSetupInteraction,
  ensureLogChannel,
  buildSetupMessage,
  LOG_CHANNEL_NAME
};
