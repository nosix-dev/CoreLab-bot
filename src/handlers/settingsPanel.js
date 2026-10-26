// ────────────────────────────────────────────────
// settingsPanel.js — Panneaux de configuration boutons
// pour les Traductions admin et les Réponses automatiques.
// Pattern identique à protection.js / buildProtectDashboard.
// ────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');
const {
  getGuildConfig
} = require('../core/config');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Langues proposées dans le sélecteur (max 25 Discord)
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const {
  configCardPayload
} = require("../core/configLook");
const LANGUES_SELECTEUR = [{
  label: '🇫🇷 Français',
  value: 'fr'
}, {
  label: '🇬🇧 Anglais',
  value: 'en'
}, {
  label: '🇪🇸 Espagnol',
  value: 'es'
}, {
  label: '🇩🇪 Allemand',
  value: 'de'
}, {
  label: '🇮🇹 Italien',
  value: 'it'
}, {
  label: '🇵🇹 Portugais',
  value: 'pt'
}, {
  label: '🇷🇺 Russe',
  value: 'ru'
}, {
  label: '🇯🇵 Japonais',
  value: 'ja'
}, {
  label: '🇰🇷 Coréen',
  value: 'ko'
}, {
  label: '🇨🇳 Chinois (simplifié)',
  value: 'zh-CN'
}, {
  label: '🇸🇦 Arabe',
  value: 'ar'
}, {
  label: '🇳🇱 Néerlandais',
  value: 'nl'
}, {
  label: '🇵🇱 Polonais',
  value: 'pl'
}, {
  label: '🇹🇷 Turc',
  value: 'tr'
}, {
  label: '🇸🇪 Suédois',
  value: 'sv'
}, {
  label: '🇺🇦 Ukrainien',
  value: 'uk'
}, {
  label: '🇷🇴 Roumain',
  value: 'ro'
}, {
  label: '🇨🇿 Tchèque',
  value: 'cs'
}, {
  label: '🇭🇺 Hongrois',
  value: 'hu'
}, {
  label: '🇬🇷 Grec',
  value: 'el'
}, {
  label: '🇩🇰 Danois',
  value: 'da'
}, {
  label: '🇫🇮 Finnois',
  value: 'fi'
}, {
  label: '🇳🇴 Norvégien',
  value: 'no'
}, {
  label: '🇮🇳 Hindi',
  value: 'hi'
}, {
  label: '🇮🇩 Indonésien',
  value: 'id'
}];
function libelleLanguePanel(code) {
  const entry = LANGUES_SELECTEUR.find(l => l.value === code);
  return entry ? entry.label : code ? String(code).toUpperCase() : '❌ Non défini';
}

// ════════════════════════════════════════════════
//  TRADUCTION ADMIN
// ════════════════════════════════════════════════

function buildTranslationDashboard(guild) {
  const cfg = getGuildConfig(guild.id);
  const on = v => v ? '🟢 Activé' : '🔴 Désactivé';
  const chan = id => id ? `<#${id}>` : '❌ Non configuré';
  const scope = cfg.translation_scope === 'server' ? '🌍 Serveur entier' : cfg.translation_scope === 'channel' ? '📌 Salon précis' : '❌ Non défini';
  const omni = cfg.translation_omnidirectional === true;
  const langFieldName = omni ? '🔤 Langue des non-francophones' : '🔤 Langue cible';
  const embed = new EmbedBuilder().setTitle('🌐 Panneau de traduction automatique').setDescription('Configure ici le système de traduction automatique admin.\nClique sur un bouton pour modifier un paramètre.' + (omni ? '\n\n🔁 **Mode omnidirectionnel activé** : tout message qui n\'est pas en français est traduit en français, et tout message en français est traduit dans la langue ci-dessous.' : '')).setColor(0xFFFFFF).addFields({
    name: '🌐 Traduction automatique',
    value: on(cfg.translation_enabled),
    inline: true
  }, {
    name: '🌍 Portée',
    value: scope,
    inline: true
  }, {
    name: '📌 Salon',
    value: chan(cfg.translation_channel_id),
    inline: true
  }, {
    name: '🔁 Mode omnidirectionnel',
    value: on(omni),
    inline: true
  }, {
    name: langFieldName,
    value: libelleLanguePanel(cfg.translation_target_lang || 'fr'),
    inline: true
  }).setFooter({
    text: 'CoreLab • Traduction admin'
  });
  return embed;
}
function buildTranslationRows(guild) {
  const cfg = getGuildConfig(guild.id);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings_trans_toggle').setLabel(cfg.translation_enabled ? '🔴 Désactiver' : '🟢 Activer').setStyle(cfg.translation_enabled ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder().setCustomId('settings_trans_channel').setLabel('📌 Salon').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('settings_trans_scope').setLabel('🌍 Portée').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('settings_trans_lang').setLabel(cfg.translation_omnidirectional ? '🔤 Langue non-FR' : '🔤 Langue cible').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('settings_trans_omni_toggle').setLabel(cfg.translation_omnidirectional ? '🔁 Omnidirectionnel : ON' : '🔁 Omnidirectionnel : OFF').setStyle(cfg.translation_omnidirectional ? ButtonStyle.Success : ButtonStyle.Secondary));
  return [row];
}
// Panneau complet avec carte image (pastille ACTIVÉ/DÉSACTIVÉ déduite du 1er champ)
function translationPayload(guild, extraRows = []) {
  return configCardPayload(buildTranslationDashboard(guild), [...buildTranslationRows(guild), ...extraRows], {
    guild,
    file: 'config-traduction.png',
    pill: undefined
  });
}
async function refreshTranslationDashboard(interaction) {
  return interaction.update(translationPayload(interaction.guild));
}

// ── Handlers boutons traduction ──

async function handleTransToggle(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_enabled = !cfg.translation_enabled;
  persist('config');
  return interaction.update(translationPayload(interaction.guild));
}
async function handleTransChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const select = new ChannelSelectMenuBuilder().setCustomId('settings_trans_channel_select').setPlaceholder('Choisis le salon à traduire').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  const disableRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings_trans_channel_remove').setLabel('🔴 Retirer le salon').setStyle(ButtonStyle.Danger));
  return interaction.reply({
    content: `📌 **Salon de traduction**\nChoisis le salon où activer la traduction automatique (portée "Salon précis").\n\nActuel : ${cfg.translation_channel_id ? `<#${cfg.translation_channel_id}>` : 'aucun'}`,
    components: [new ActionRowBuilder().addComponents(select), disableRow],
    flags: MessageFlags.Ephemeral
  });
}
async function handleTransScope(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_scope = cfg.translation_scope === 'server' ? 'channel' : 'server';
  persist('config');
  const label = cfg.translation_scope === 'server' ? '🌍 Portée : Serveur entier' : '📌 Portée : Salon précis';
  return interaction.reply({
    content: `✅ Portée mise à jour → **${label}**`,
    flags: MessageFlags.Ephemeral
  });
}
async function handleTransOmniToggle(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_omnidirectional = !cfg.translation_omnidirectional;
  persist('config');
  return interaction.update(translationPayload(interaction.guild));
}
async function handleTransLang(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const currentLang = cfg.translation_target_lang || 'fr';
  const select = new StringSelectMenuBuilder().setCustomId('settings_trans_lang_select').setPlaceholder('Choisis la langue cible').addOptions(LANGUES_SELECTEUR.map(l => new StringSelectMenuOptionBuilder().setLabel(l.label).setValue(l.value).setDefault(l.value === currentLang)));
  const intro = cfg.translation_omnidirectional ? '🔤 **Langue des messages non-francophones**\nEn mode omnidirectionnel, les messages en français sont traduits vers cette langue (les autres langues sont toujours traduites vers le français).' : '🔤 **Langue cible de traduction**';
  return interaction.reply({
    content: `${intro}\nActuelle : **${libelleLanguePanel(currentLang)}**`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  });
}
async function handleTransChannelSelect(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_channel_id = interaction.values[0];
  if (cfg.translation_scope !== 'server') cfg.translation_scope = 'channel';
  persist('config');
  return interaction.update({
    content: `✅ Salon de traduction défini : <#${cfg.translation_channel_id}>`,
    components: []
  });
}
async function handleTransChannelRemove(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_channel_id = null;
  persist('config');
  return interaction.update({
    content: '🔴 Salon de traduction retiré.',
    components: []
  });
}
async function handleTransLangSelect(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.translation_target_lang = interaction.values[0];
  persist('config');
  return interaction.update({
    content: `✅ Langue cible : **${libelleLanguePanel(cfg.translation_target_lang)}**`,
    components: []
  });
}

// ════════════════════════════════════════════════
//  RÉPONSES AUTOMATIQUES
// ════════════════════════════════════════════════

function getAutoresponses(guildId) {
  const id = String(guildId);
  if (!store.autoresponses) store.autoresponses = {};
  if (!store.autoresponses[id]) store.autoresponses[id] = [];
  return store.autoresponses[id];
}
function buildAutoresponseDashboard(guild) {
  const cfg = getGuildConfig(guild.id);
  const on = v => v !== false ? '🟢 Activé' : '🔴 Désactivé';
  const bucket = getAutoresponses(guild.id);
  const listValue = bucket.length ? bucket.slice(0, 10).map((a, i) => `\`${i + 1}\` **${a.keyword}** → ${String(a.response).slice(0, 60)}${a.response.length > 60 ? '…' : ''}`).join('\n') + (bucket.length > 10 ? `\n*... et ${bucket.length - 10} de plus*` : '') : '*(aucune réponse configurée)*';
  return new EmbedBuilder().setTitle('🤖 Panneau des réponses automatiques').setDescription('Configure ici les réponses automatiques du serveur.\nClique sur un bouton pour gérer la liste.').setColor(0xFFFFFF).addFields({
    name: '💬 Système',
    value: on(cfg.autoresponse_enabled),
    inline: true
  }, {
    name: '📊 Réponses configurées',
    value: `\`${bucket.length}\``,
    inline: true
  }, {
    name: '📋 Liste',
    value: listValue,
    inline: false
  }).setFooter({
    text: 'CoreLab • Réponses automatiques'
  });
}
function buildAutoresponseRows(guild) {
  const cfg = getGuildConfig(guild.id);
  const bucket = getAutoresponses(guild.id);
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings_ar_toggle').setLabel(cfg.autoresponse_enabled !== false ? '🔴 Désactiver' : '🟢 Activer').setStyle(cfg.autoresponse_enabled !== false ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder().setCustomId('settings_ar_add').setLabel('➕ Ajouter').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('settings_ar_list').setLabel('📋 Liste complète').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('settings_ar_remove').setLabel('🗑️ Retirer').setStyle(ButtonStyle.Secondary).setDisabled(bucket.length === 0), new ButtonBuilder().setCustomId('settings_ar_clear').setLabel('🧹 Tout vider').setStyle(ButtonStyle.Danger).setDisabled(bucket.length === 0));
  return [row1];
}
function autoresponsePayload(guild, extraRows = []) {
  return configCardPayload(buildAutoresponseDashboard(guild), [...buildAutoresponseRows(guild), ...extraRows], {
    guild,
    file: 'config-reponses-auto.png',
    pill: undefined
  });
}
async function refreshAutoresponseDashboard(interaction) {
  return interaction.update(autoresponsePayload(interaction.guild));
}

// ── Handlers boutons autoréponses ──

async function handleArToggle(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.autoresponse_enabled = cfg.autoresponse_enabled === false ? true : false;
  persist('configuration');
  return refreshAutoresponseDashboard(interaction);
}
async function handleArAdd(interaction) {
  const modal = new ModalBuilder().setCustomId('settings_ar_add_modal').setTitle('➕ Ajouter une réponse automatique');
  const kwInput = new TextInputBuilder().setCustomId('ar_keyword').setLabel('Mot-clé (déclencheur)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Ex: bonjour');
  const respInput = new TextInputBuilder().setCustomId('ar_response').setLabel('Réponse automatique').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('Ex: Bonjour ! Bienvenue sur le serveur 🎉');
  modal.addComponents(new ActionRowBuilder().addComponents(kwInput), new ActionRowBuilder().addComponents(respInput));
  return interaction.showModal(modal);
}
async function handleArAddModal(interaction) {
  const keyword = interaction.fields.getTextInputValue('ar_keyword').trim();
  const response = interaction.fields.getTextInputValue('ar_response').trim();
  if (!keyword || !response) {
    return interaction.reply({
      content: '❌ Mot-clé et réponse sont obligatoires.',
      flags: MessageFlags.Ephemeral
    });
  }
  const bucket = getAutoresponses(interaction.guild.id);
  if (bucket.some(a => a.keyword.toLowerCase() === keyword.toLowerCase())) {
    return interaction.reply({
      content: `⚠️ Un mot-clé **${keyword}** existe déjà. Utilise "Retirer" pour le supprimer d'abord.`,
      flags: MessageFlags.Ephemeral
    });
  }
  bucket.push({
    keyword,
    response
  });
  persist('autoresponses');
  return interaction.reply({
    content: `✅ Réponse automatique ajoutée : **${keyword}** → ${response.slice(0, 80)}${response.length > 80 ? '…' : ''}`,
    flags: MessageFlags.Ephemeral
  });
}
async function handleArList(interaction) {
  const bucket = getAutoresponses(interaction.guild.id);
  if (!bucket.length) {
    return interaction.reply({
      content: '🤖 Aucune réponse automatique configurée.',
      flags: MessageFlags.Ephemeral
    });
  }
  const lines = bucket.map((a, i) => `\`${i + 1}\` **${a.keyword}** → ${String(a.response).slice(0, 100)}${a.response.length > 100 ? '…' : ''}`).join('\n');
  return interaction.reply({
    content: `🤖 **Réponses automatiques (${bucket.length})**\n\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}
async function handleArRemove(interaction) {
  const bucket = getAutoresponses(interaction.guild.id);
  if (!bucket.length) {
    return interaction.reply({
      content: '❌ Aucune réponse automatique à retirer.',
      flags: MessageFlags.Ephemeral
    });
  }
  const modal = new ModalBuilder().setCustomId('settings_ar_remove_modal').setTitle('🗑️ Retirer une réponse automatique');
  const preview = bucket.slice(0, 5).map((a, i) => `${i + 1}. ${a.keyword}`).join('\n') + (bucket.length > 5 ? `\n... (${bucket.length} total)` : '');
  const numInput = new TextInputBuilder().setCustomId('ar_num').setLabel(`Numéro à retirer (1-${bucket.length})`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder(`1 à ${bucket.length} — Liste: ${preview.replace(/\n/g, ', ')}`);
  modal.addComponents(new ActionRowBuilder().addComponents(numInput));
  return interaction.showModal(modal);
}
async function handleArRemoveModal(interaction) {
  const bucket = getAutoresponses(interaction.guild.id);
  const num = parseInt(interaction.fields.getTextInputValue('ar_num'), 10);
  if (!Number.isFinite(num) || num < 1 || num > bucket.length) {
    return interaction.reply({
      content: `❌ Numéro invalide. Indique un nombre entre 1 et ${bucket.length}.`,
      flags: MessageFlags.Ephemeral
    });
  }
  const [removed] = bucket.splice(num - 1, 1);
  persist('autoresponses');
  return interaction.reply({
    content: `🗑️ Réponse automatique retirée : **${removed.keyword}**`,
    flags: MessageFlags.Ephemeral
  });
}
async function handleArClear(interaction) {
  // Bouton de confirmation avant de tout vider
  const confirmRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings_ar_clear_confirm').setLabel('✅ Oui, tout vider').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('settings_ar_clear_cancel').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));
  return interaction.reply({
    content: '⚠️ Tu es sur le point de supprimer **toutes** les réponses automatiques. Cette action est irréversible.',
    components: [confirmRow],
    flags: MessageFlags.Ephemeral
  });
}
async function handleArClearConfirm(interaction) {
  const id = String(interaction.guild.id);
  if (!store.autoresponses) store.autoresponses = {};
  store.autoresponses[id] = [];
  persist('autoresponses');
  return interaction.update({
    content: '🧹 Toutes les réponses automatiques ont été supprimées.',
    components: []
  });
}
async function handleArClearCancel(interaction) {
  return interaction.update({
    content: '✅ Annulé.',
    components: []
  });
}

// ════════════════════════════════════════════════
//  ROUTEUR PRINCIPAL
// ════════════════════════════════════════════════

async function routeSettingsInteraction(interaction) {
  try {
    const id = interaction.customId || '';

    // ── Traduction ──
    if (interaction.isButton()) {
      if (id === 'settings_trans_toggle') return handleTransToggle(interaction);
      if (id === 'settings_trans_channel') return handleTransChannel(interaction);
      if (id === 'settings_trans_scope') return handleTransScope(interaction);
      if (id === 'settings_trans_lang') return handleTransLang(interaction);
      if (id === 'settings_trans_omni_toggle') return handleTransOmniToggle(interaction);
      if (id === 'settings_trans_channel_remove') return handleTransChannelRemove(interaction);

      // ── Autoréponses ──
      if (id === 'settings_ar_toggle') return handleArToggle(interaction);
      if (id === 'settings_ar_add') return handleArAdd(interaction);
      if (id === 'settings_ar_list') return handleArList(interaction);
      if (id === 'settings_ar_remove') return handleArRemove(interaction);
      if (id === 'settings_ar_clear') return handleArClear(interaction);
      if (id === 'settings_ar_clear_confirm') return handleArClearConfirm(interaction);
      if (id === 'settings_ar_clear_cancel') return handleArClearCancel(interaction);
    }
    if (interaction.isChannelSelectMenu()) {
      if (id === 'settings_trans_channel_select') return handleTransChannelSelect(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (id === 'settings_trans_lang_select') return handleTransLangSelect(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (id === 'settings_ar_add_modal') return handleArAddModal(interaction);
      if (id === 'settings_ar_remove_modal') return handleArRemoveModal(interaction);
    }
  } catch (e) {
    console.error('Erreur routeSettingsInteraction :', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Une erreur est survenue.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}
module.exports = {
  routeSettingsInteraction,
  buildTranslationDashboard,
  buildTranslationRows,
  buildAutoresponseDashboard,
  buildAutoresponseRows,
  translationPayload,
  autoresponsePayload
};