const fs = require('fs');
const path = require('path');
const { dossierPersistant, fichierPersistant } = require('../core/persistentPath');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  LabelBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder
} = require('discord.js');
const {
  getGuildConfig,
  getGuildBucket
} = require('../core/config');
const { openCardEditor } = require('../core/welcomeCardConfig');
const {
  safeReply,
  safeComponentUpdate
} = require('../core/safeReply');
const {
  store,
  persist
} = require('../core/data');
const {
  buildTicketConfigEmbed,
  buildTicketConfigRows
} = require('../handlers/ticket');
const {
  getCountingState,
  setCountingState,
  buildStatsEmbed: buildComptageStatsEmbed
} = require('../handlers/counting');
const {
  buildLanguageRow
} = require('../handlers/welcome');
const {
  t,
  LANGUAGES
} = require('../core/i18n');
const {
  isPremium,
  requirePremium,
  requireCustomization,
  buildSubscriptionRow
} = require('../core/premium');
const {
  PREMIUM_SKU_ID
} = require('../core/constants');
const {
  logInfraction
} = require('../core/infractionLogger');
const {
  PALETTE_COULEURS_APPARENCE,
  hexToColorInt,
  buildCouleurLabelComponents,
  resoudreCouleurDepuisModal
} = require('../core/colorPalette');
const {
  buildLinkButtonsLabelComponents,
  parseLinkButtonsFromModal,
  parseLinkButtonField
} = require('../core/linkButtons');
const {
  XP_IMAGE_EXTENSIONS
} = require('../handlers/xpImage');
const {
  buildTranslationDashboard,
  buildTranslationRows,
  buildAutoresponseDashboard,
  buildAutoresponseRows,
  translationPayload,
  autoresponsePayload,
  routeSettingsInteraction
} = require('../handlers/settingsPanel');
const {
  toCV2Payload
} = require("../core/componentsV2");
const {
  configPayload,
  configCardPayload
} = require("../core/configLook");
function formatDate(date) {
  return new Date(date).toLocaleString('fr-FR');
}
const setnick = {
  data: new SlashCommandBuilder().setName('pseudo-definir').setDescription('Changer mon pseudo sur ce serveur').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames).addStringOption(o => o.setName('nouveau_pseudo').setDescription('Nouveau pseudo').setRequired(true)),
  async execute(interaction) {
    const nickname = interaction.options.getString('nouveau_pseudo');
    if (nickname.length > 32) {
      return interaction.reply({
        content: t(interaction.guild.id, 'setnick_too_long'),
        flags: MessageFlags.Ephemeral
      });
    }
    try {
      await interaction.guild.members.me.edit({
        nick: nickname
      });
      const cfg = getGuildConfig(interaction.guild.id);
      cfg.bot_nickname = nickname;
      persist('configuration');
      await interaction.reply({
        content: t(interaction.guild.id, 'setnick_success', {
          nickname
        })
      });
    } catch {
      await interaction.reply({
        content: t(interaction.guild.id, 'missing_permission'),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
const resetnick = {
  data: new SlashCommandBuilder().setName('pseudo-reinitialiser').setDescription('Réinitialiser mon pseudo par défaut').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
  async execute(interaction) {
    try {
      await interaction.guild.members.me.edit({
        nick: null
      });
      const cfg = getGuildConfig(interaction.guild.id);
      cfg.bot_nickname = null;
      persist('configuration');
      await interaction.reply({
        content: t(interaction.guild.id, 'resetnick_success')
      });
    } catch {
      await interaction.reply({
        content: t(interaction.guild.id, 'missing_permission'),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
const annonce = {
  data: new SlashCommandBuilder().setName('annonce').setDescription('Publier une annonce').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(true)),
  async execute(interaction) {
    const message = interaction.options.getString('message');
    const cfg = getGuildConfig(interaction.guild.id);
    const channelId = cfg.announce_channel_id;
    let channel = interaction.channel;
    if (channelId) {
      const configured = interaction.guild.channels.cache.get(String(channelId));
      if (!configured) {
        return interaction.reply({
          content: '❌ Le salon d\'annonces configuré est introuvable (supprimé ?). Utilisez `/settings announcement` pour en redéfinir un.',
          flags: MessageFlags.Ephemeral
        });
      }
      channel = configured;
    }
    try {
      await channel.send(message);
    } catch {
      return interaction.reply({
        content: `❌ Impossible d'envoyer le message dans ${channel}. Vérifiez les permissions du bot.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const confirmation = channelId && channel.id !== interaction.channel.id ? `✅ Annonce envoyée dans ${channel}.` : t(interaction.guild.id, 'announce_sent');
    await interaction.reply({
      content: confirmation,
      flags: MessageFlags.Ephemeral
    });
  }
};

// ════════════════════════════════════════════════
// /settings — PANNEAU DE CONFIGURATION COMPLET DU SERVEUR
// ════════════════════════════════════════════════

// Les paramètres stockent maintenant des CLÉS de traduction plutôt que du texte brut,
// donc tout le panneau est rendu dans la langue configurée du serveur via t().
const CONFIG_CATEGORIES = {
  channels: {
    titleKey: 'cat_channels_title',
    descKey: 'cat_channels_desc',
    settings: [{
      labelKey: 'setting_ticket_channel',
      value: 'ticket_channel_id',
      emoji: '🎫',
      type: 'channel'
    }, {
      labelKey: 'setting_ticket_panel_channel',
      value: 'ticket_panel_channel_id',
      emoji: '📌',
      type: 'channel'
    }, {
      labelKey: 'setting_welcome_channel',
      value: 'welcome_channel_id',
      emoji: '📥',
      type: 'channel'
    }, {
      labelKey: 'setting_goodbye_channel',
      value: 'goodbye_channel_id',
      emoji: '📤',
      type: 'channel'
    }, {
      labelKey: 'setting_anniversaire_channel',
      value: 'anniversaire_channel_id',
      emoji: '🎂',
      type: 'channel'
    }, {
      labelKey: 'setting_infraction_channel',
      value: 'infraction_channel_id',
      emoji: '⚠️',
      type: 'channel'
    }, {
      labelKey: 'setting_suggestion_channel',
      value: 'suggestion_channel_id',
      emoji: '💡',
      type: 'channel'
    }]
  },
  logs: {
    titleKey: 'cat_logs_title',
    descKey: 'cat_logs_desc',
    settings: [{
      labelKey: 'setting_log_channel',
      value: 'log_channel_id',
      emoji: '📋',
      type: 'channel'
    }, {
      labelKey: 'setting_log_messages',
      value: 'log_messages',
      emoji: '🗑️',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_messages_sent',
      value: 'log_messages_sent',
      emoji: '💬',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_members',
      value: 'log_members',
      emoji: '👥',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_members_update',
      value: 'log_members_update',
      emoji: '🎭',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_roles',
      value: 'log_roles',
      emoji: '🛡️',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_channels',
      value: 'log_channels',
      emoji: '📁',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_voice',
      value: 'log_voice',
      emoji: '🔊',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_bans',
      value: 'log_bans',
      emoji: '🔨',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_server',
      value: 'log_server',
      emoji: '⚙️',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_emojis',
      value: 'log_emojis',
      emoji: '😀',
      type: 'boolean'
    }, {
      labelKey: 'setting_log_sanctions',
      value: 'log_sanctions',
      emoji: '⚖️',
      type: 'boolean'
    }]
  },
  roles: {
    titleKey: 'cat_roles_title',
    descKey: 'cat_roles_desc',
    settings: [{
      labelKey: 'setting_member_role',
      value: 'member_role_id',
      emoji: '✅',
      type: 'role'
    }, {
      labelKey: 'setting_member_role_2',
      value: 'member_role_id_2',
      emoji: '✅',
      type: 'role'
    }, {
      labelKey: 'setting_mute_role',
      value: 'mute_role',
      emoji: '🔇',
      type: 'role'
    }, {
      labelKey: 'setting_photo_winner_role',
      value: 'photo_winner_role_id',
      emoji: '🏆',
      type: 'role'
    }, {
      labelKey: 'setting_anniversaire_role',
      value: 'anniversaire_role_id',
      emoji: '🎉',
      type: 'role'
    }]
  },
  bienvenue: {
    titleKey: 'cat_bienvenue_title',
    descKey: 'cat_bienvenue_desc',
    settings: [{
      labelKey: 'setting_welcome_dm_enabled',
      value: 'welcome_dm_enabled',
      emoji: '📨',
      type: 'boolean'
    }, {
      labelKey: 'setting_welcome_dm_message',
      value: 'welcome_dm_message',
      emoji: '✏️',
      type: 'text',
      long: true
    }]
  },
  reglement: {
    titleKey: 'cat_reglement_title',
    descKey: 'cat_reglement_desc',
    settings: [{
      labelKey: 'setting_send_rules_dm',
      value: 'send_rules_dm',
      emoji: '📨',
      type: 'boolean'
    }, {
      labelKey: 'setting_rules_dm_text',
      value: 'rules_dm_text',
      emoji: '✏️',
      type: 'text',
      long: true
    }]
  },
  premium: {
    titleKey: 'cat_premium_title',
    descKey: 'cat_premium_desc',
    premium: true,
    settings: []
  },
  niveaux: {
    titleKey: 'cat_niveaux_title',
    descKey: 'cat_niveaux_desc',
    settings: [{
      labelKey: 'setting_xp_enabled',
      value: 'xp_enabled',
      emoji: '📈',
      type: 'boolean'
    }, {
      labelKey: 'setting_xp_cooldown',
      value: 'xp_cooldown',
      emoji: '⏱️',
      type: 'number'
    }, {
      labelKey: 'setting_xp_min',
      value: 'xp_min',
      emoji: '🔽',
      type: 'number'
    }, {
      labelKey: 'setting_xp_max',
      value: 'xp_max',
      emoji: '🔼',
      type: 'number'
    }, {
      labelKey: 'setting_xp_voice_enabled',
      value: 'xp_voice_enabled',
      emoji: '🎙️',
      type: 'boolean'
    }, {
      labelKey: 'setting_xp_voice_interval',
      value: 'xp_voice_interval',
      emoji: '🕐',
      type: 'number'
    }, {
      labelKey: 'setting_xp_voice_amount',
      value: 'xp_voice_amount',
      emoji: '🎧',
      type: 'number'
    }, {
      labelKey: 'setting_xp_voice_bonus_minutes',
      value: 'xp_voice_bonus_minutes',
      emoji: '📶',
      type: 'number'
    }, {
      labelKey: 'setting_xp_voice_bonus_amount',
      value: 'xp_voice_bonus_amount',
      emoji: '🚀',
      type: 'number'
    }, {
      labelKey: 'setting_xp_voice_bonus_max',
      value: 'xp_voice_bonus_max',
      emoji: '🔝',
      type: 'number'
    }, {
      labelKey: 'setting_xp_level_channel',
      value: 'xp_level_channel_id',
      emoji: '🎉',
      type: 'channel'
    }]
  },
  reponses_auto: {
    titleKey: 'cat_reponses_auto_title',
    descKey: 'cat_reponses_auto_desc',
    settings: [{
      labelKey: 'setting_autoresponse_enabled',
      value: 'autoresponse_enabled',
      emoji: '💬',
      type: 'boolean'
    }]
  },
  traduction: {
    titleKey: 'cat_traduction_title',
    descKey: 'cat_traduction_desc',
    settings: [{
      labelKey: 'setting_translation_enabled',
      value: 'translation_enabled',
      emoji: '🌐',
      type: 'boolean'
    }, {
      labelKey: 'setting_translation_scope',
      value: 'translation_scope',
      emoji: '🌍',
      type: 'text'
    }, {
      labelKey: 'setting_translation_channel',
      value: 'translation_channel_id',
      emoji: '📌',
      type: 'channel'
    }, {
      labelKey: 'setting_translation_target_lang',
      value: 'translation_target_lang',
      emoji: '🔤',
      type: 'text'
    }]
  }
};
function findCategoryKeyOfSetting(settingValue) {
  for (const [key, cat] of Object.entries(CONFIG_CATEGORIES)) {
    if (cat.settings.some(s => s.value === settingValue)) return key;
  }
  return null;
}
function formatConfigValue(guildId, cfg, setting) {
  const val = cfg[setting.value];
  switch (setting.type) {
    case 'role':
      return val ? `<@&${val}>` : t(guildId, 'not_set');
    case 'channel':
      return val ? `<#${val}>` : t(guildId, 'not_set');
    case 'boolean':
      return val ? `✅ ${t(guildId, 'general_enabled')}` : `❌ ${t(guildId, 'general_disabled')}`;
    case 'number':
      return val !== undefined && val !== null && val !== '' ? `\`${val}\`` : t(guildId, 'not_set');
    case 'text':
      return val ? `\`${String(val).slice(0, 60)}${String(val).length > 60 ? '…' : ''}\`` : t(guildId, 'not_set');
    default:
      return t(guildId, 'not_set');
  }
}
function buildConfigHomeEmbed(guild) {
  const gid = guild.id;
  const totalSettings = Object.values(CONFIG_CATEGORIES).reduce((sum, c) => sum + c.settings.length, 0);
  return new EmbedBuilder().setTitle(t(gid, 'config_home_title')).setColor(0xFFFFFF).setThumbnail(guild.members.me.displayAvatarURL()).addFields({
    name: t(gid, 'config_home_welcome_field'),
    value: t(gid, 'config_home_welcome_value'),
    inline: false
  }, {
    name: t(gid, 'config_home_stats_field'),
    value: `\`\`\`ini\n${t(gid, 'config_settings_count')}   : ${totalSettings}\n${t(gid, 'config_categories_count')} : ${Object.keys(CONFIG_CATEGORIES).length}\n\`\`\``,
    inline: false
  }, {
    name: t(gid, 'config_home_categories_field'),
    value: Object.values(CONFIG_CATEGORIES).map(c => `${t(gid, c.titleKey)} — ${c.settings.length} paramètre(s)`).join('\n'),
    inline: false
  });
}
function buildCategoryEmbed(catKey, cfg, guildId) {
  const cat = CONFIG_CATEGORIES[catKey];
  const embed = new EmbedBuilder().setTitle(`${t(guildId, cat.titleKey)} — ${t(guildId, 'config_title_suffix')}`).setDescription(t(guildId, cat.descKey)).setColor(0xFFFFFF);
  cat.settings.forEach(s => {
    embed.addFields({
      name: `${s.emoji} ${t(guildId, s.labelKey)}`,
      value: formatConfigValue(guildId, cfg, s),
      inline: true
    });
  });
  if (catKey === 'logs') {
    embed.addFields({
      name: '🎨 Style des logs',
      value: cfg.log_style === 'embed' ? '💬 Embed' : '🖼️ Image',
      inline: true
    });
  }
  if (catKey === 'premium') {
    embed.addFields({
      name: '⭐ Tout ce qui est Premium sur CoreLab',
      value: '🎨 **Personnalisation**\n' + '• 👋 Bienvenue / au revoir (message, image, boutons, carte par défaut entièrement modifiable) → boutons ci-dessous\n' + '• 🖼️ Image de l\'annonce de niveau → bouton ci-dessous\n' + '• 🎫 Tickets : apparence, message d\'ouverture, image → `/settings ticket`\n' + '• 📜 `/reglement` et 🗳️ `/vote` : titres, couleurs, images → dans ces commandes\n\n' + '⭐ **Premium**\n' + '• 🖐️ Bouton Claim des tickets → `/settings ticket`\n' + '• 💾 `/backup` (create, load, list, delete, info)\n' + '• 🔔 Notifications suivies illimitées → `/notification`',
      inline: false
    });
  }
  return embed;
}
function buildWelcomeGoodbyeButtonRows(guildId) {
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_welcome_msg_btn').setLabel('👋 Message').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('config_welcome_img_btn').setLabel('👋 Image').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_welcome_links_btn').setLabel('👋 Boutons').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_welcome_card_btn').setLabel('👋 Carte').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_welcome_reset_btn').setLabel('👋 Réinit.').setStyle(ButtonStyle.Danger));
  const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_goodbye_msg_btn').setLabel('🚪 Message').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('config_goodbye_img_btn').setLabel('🚪 Image').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_goodbye_links_btn').setLabel('🚪 Boutons').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_goodbye_card_btn').setLabel('🚪 Carte').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_goodbye_reset_btn').setLabel('🚪 Réinit.').setStyle(ButtonStyle.Danger));
  return [row1, row2];
}
function buildCategorySelectRow(guildId) {
  const select = new StringSelectMenuBuilder().setCustomId('config_category_select').setPlaceholder(t(guildId, 'config_category_select_placeholder')).addOptions(Object.entries(CONFIG_CATEGORIES).map(([key, cat]) => {
    const texteComplet = t(guildId, cat.titleKey);
    const espace = texteComplet.indexOf(' ');
    const emoji = espace > -1 ? texteComplet.slice(0, espace) : null;
    const label = espace > -1 ? texteComplet.slice(espace + 1) : texteComplet;
    const option = new StringSelectMenuOptionBuilder().setLabel(label).setDescription(`${cat.settings.length} paramètre(s)`).setValue(key);
    if (emoji) option.setEmoji(emoji);
    return option;
  }));
  return new ActionRowBuilder().addComponents(select);
}
function buildSettingSelectRow(catKey, guildId) {
  const cat = CONFIG_CATEGORIES[catKey];
  const select = new StringSelectMenuBuilder().setCustomId(`config_setting_select_${catKey}`).setPlaceholder(t(guildId, 'config_setting_select_placeholder')).addOptions(cat.settings.map(s => new StringSelectMenuOptionBuilder().setLabel(t(guildId, s.labelKey)).setValue(s.value).setEmoji(s.emoji)));
  return new ActionRowBuilder().addComponents(select);
}
function buildBackRow(guildId) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_back_home').setLabel(t(guildId, 'config_back_button')).setStyle(ButtonStyle.Secondary));
}

// ── Rendu « style Soutiens » (Container Components V2) ──
function buildLogStyleRow(guildId) {
  const isEmbed = getGuildConfig(guildId).log_style === 'embed';
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_logstyle_embed').setLabel('💬 Embed').setStyle(isEmbed ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('config_logstyle_image').setLabel('🖼️ Image').setStyle(!isEmbed ? ButtonStyle.Success : ButtonStyle.Secondary));
}
function buildCategoryRows(catKey, guildId) {
  const rows = CONFIG_CATEGORIES[catKey].settings.length ? [buildSettingSelectRow(catKey, guildId)] : [];
  if (catKey === 'logs') rows.push(buildLogStyleRow(guildId));
  if (catKey === 'premium') rows.push(...buildWelcomeGoodbyeButtonRows(guildId), buildPremiumButtonsRow());
  if (catKey === 'niveaux') rows.push(buildXpButtonsRow());
  rows.push(buildBackRow(guildId));
  return rows;
}
function buildCategoryPayload(catKey, guild) {
  const gid = guild.id;
  // Carte image (style /protect-settings) : une tuile par paramètre de la catégorie
  return configCardPayload(buildCategoryEmbed(catKey, getGuildConfig(gid), gid), buildCategoryRows(catKey, gid), {
    guild,
    file: `config-${catKey}.png`
  });
}

// ── Système d'XP : boutons regroupés dans la catégorie Niveaux ──
function buildXpButtonsRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_xp_add_btn').setLabel('➕ Ajout XP').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('config_xp_remove_btn').setLabel('➖ Retrait XP').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('config_xp_reset_btn').setLabel('♻️ Reset XP').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('config_xp_roles_btn').setLabel('🏆 Rôles XP').setStyle(ButtonStyle.Primary));
}
// ── Boutons de personnalisation regroupés dans la catégorie Premium ──
function buildPremiumButtonsRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_xp_img_btn').setLabel('🖼️ Image annonce de niveau').setStyle(ButtonStyle.Secondary));
}
function buildXpRolesEmbed(guildId, cfg) {
  const roles = (cfg.xp_roles || []).slice().sort((a, b) => a.level - b.level);
  const list = roles.length ? roles.map(r => `Niveau **${r.level}** → <@&${r.roleId}>`).join('\n') : 'Aucun rôle de récompense configuré.';
  const replace = cfg.xp_roles_mode === 'replace';
  const modeText = replace ? '🔁 **Remplacement** : le membre ne garde que le rôle du palier le plus haut atteint.' : '📚 **Cumulatif** : le membre garde tous les rôles des paliers atteints.';
  const description = `${modeText}\n\nTu peux ajouter plusieurs rôles (même sur un même niveau).\n\n${list}`.slice(0, 4000);
  return new EmbedBuilder().setTitle('🏆 Rôles de récompense XP').setDescription(description).setColor(0xFFFFFF);
}
function buildXpRolesRows(guildId, cfg, guild) {
  const rows = [];
  const addRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_xp_role_add_btn').setLabel('➕ Ajouter un rôle').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('config_xp_roles_mode_btn').setLabel(cfg.xp_roles_mode === 'replace' ? '🔁 Mode : Remplacement' : '📚 Mode : Cumulatif').setStyle(ButtonStyle.Secondary));
  rows.push(addRow);
  const roles = (cfg.xp_roles || []).slice().sort((a, b) => a.level - b.level);
  if (roles.length) {
    const select = new StringSelectMenuBuilder().setCustomId('config_xp_role_remove_select').setPlaceholder('Retirer un rôle de récompense').addOptions(roles.slice(0, 25).map(r => new StringSelectMenuOptionBuilder().setLabel(`Niveau ${r.level} — ${guild?.roles?.cache?.get(r.roleId)?.name || r.roleId}`.slice(0, 100)).setValue(`${r.level}:${r.roleId}`)));
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_xp_back_btn').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)));
  return rows;
}
async function executePanneau(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: 'Cette commande doit être utilisée dans un serveur.',
      ephemeral: true
    });
  }
  const gid = interaction.guild.id;
  const homeEmbed = buildConfigHomeEmbed(interaction.guild);
  const catRow = buildCategorySelectRow(gid);
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  await interaction.editReply(configPayload(homeEmbed, [catRow]));
  const replyMessage = await interaction.fetchReply();
  const collector = replyMessage.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id && (i.customId === 'config_category_select' || i.customId === 'config_back_home' || i.customId.startsWith('config_setting_select_') || i.customId.startsWith('config_set_role_') || i.customId.startsWith('config_set_channel_') || i.customId === 'config_welcome_msg_btn' || i.customId === 'config_welcome_img_btn' || i.customId === 'config_welcome_links_btn' || i.customId === 'config_welcome_card_btn' || i.customId === 'config_goodbye_card_btn' || i.customId === 'config_welcome_reset_btn' || i.customId === 'config_goodbye_msg_btn' || i.customId === 'config_goodbye_img_btn' || i.customId === 'config_goodbye_links_btn' || i.customId === 'config_goodbye_reset_btn' || i.customId === 'config_xp_add_btn' || i.customId === 'config_xp_remove_btn' || i.customId === 'config_xp_reset_btn' || i.customId === 'config_xp_roles_btn' || i.customId === 'config_logstyle_embed' || i.customId === 'config_logstyle_image' || i.customId === 'config_xp_img_btn' || i.customId === 'config_xp_role_add_btn' || i.customId === 'config_xp_role_remove_select' || i.customId === 'config_xp_back_btn' || i.customId === 'config_xp_roles_mode_btn' || i.customId === 'config_xp_role_pick' || i.customId.startsWith('config_xp_select_')),
    time: 300000
  });
  collector.on('collect', async i => {
    // Accusé de réception IMMÉDIAT pour la sélection de catégorie et
    // le retour à l'accueil : ces deux cas se terminent toujours par
    // safeComponentUpdate() (jamais de modal ni de nouveau message),
    // donc on peut deferUpdate() sans attendre. Avant ce correctif,
    // seul le setTimeout(2000ms) ci-dessous protégeait ce chemin :
    // en cas de réseau lent côté hébergeur, la marge d'1s restante
    // ne suffisait pas toujours et Discord affichait "CoreLab n'a
    // pas répondu à temps" alors que la commande finissait par
    // fonctionner côté serveur.
    if (i.customId === 'config_category_select' || i.customId === 'config_back_home') {
      await i.deferUpdate().catch(() => { });
    }

    // Filet de sécurité : si rien n'a accusé réception au bout de 2s
    // (event loop bloquée par une écriture disque synchrone ailleurs,
    // hébergement lent, etc.), on defer pour éviter le "n'a pas
    // répondu à temps" côté Discord. safeComponentUpdate() prendra
    // ensuite le relais via editReply() si l'interaction est déjà deferred.
    const autoDeferTimer = setTimeout(() => {
      if (!i.deferred && !i.replied) {
        i.deferUpdate().catch(() => { });
      }
    }, 2000);
    try {
      // ── Retour à l'accueil ──────────────────────────
      if (i.customId === 'config_back_home') {
        const embed = buildConfigHomeEmbed(interaction.guild);
        return await safeComponentUpdate(i, configPayload(embed, [buildCategorySelectRow(gid)]));
      }

      // ── Sélection de catégorie ───────────────────
      if (i.customId === 'config_category_select') {
        const catKey = i.values[0];
        const targetCat = CONFIG_CATEGORIES[catKey];
        if (targetCat?.premium && !isPremium(i.user.id)) {
          const premiumEmbed = new EmbedBuilder().setTitle(t(gid, 'config_premium_category_title')).setDescription(t(gid, 'config_premium_category_desc')).setColor(0xFFFFFF);
          return await i.reply(configPayload(premiumEmbed, [buildSubscriptionRow()], {
            ephemeral: true
          }));
        }

        // ── Panneaux boutons dédiés ──
        if (catKey === 'traduction') {
          return await safeComponentUpdate(i, translationPayload(interaction.guild, [buildBackRow(gid)]));
        }
        if (catKey === 'reponses_auto') {
          return await safeComponentUpdate(i, autoresponsePayload(interaction.guild, [buildBackRow(gid)]));
        }
        return await safeComponentUpdate(i, buildCategoryPayload(catKey, interaction.guild));
      }

      // ── Logs : style d'affichage (Embed / Image) ──
      if (i.customId === 'config_logstyle_embed' || i.customId === 'config_logstyle_image') {
        const logCfg = getGuildConfig(interaction.guild.id);
        logCfg.log_style = i.customId === 'config_logstyle_embed' ? 'embed' : 'image';
        persist('config');
        return await safeComponentUpdate(i, buildCategoryPayload('logs', interaction.guild));
      }

      // ── Sélection d'un paramètre dans une catégorie ──
      if (i.customId.startsWith('config_setting_select_')) {
        const catKey = i.customId.replace('config_setting_select_', '');
        const settingKey = i.values[0];
        const cat = CONFIG_CATEGORIES[catKey];
        const setting = cat.settings.find(s => s.value === settingKey);
        if (!setting) return;
        const settingLabel = t(gid, setting.labelKey);
        if (setting.premium && !isPremium(i.user.id)) {
          const premiumEmbed = new EmbedBuilder().setTitle(t(gid, 'config_premium_setting_title')).setDescription(t(gid, 'config_premium_setting_desc', {
            setting: settingLabel
          })).setColor(0xFFFFFF);
          return await i.reply(configPayload(premiumEmbed, [buildSubscriptionRow()], {
            ephemeral: true
          }));
        }
        const cfg = getGuildConfig(interaction.guild.id);
        if (setting.type === 'role') {
          const roleSelect = new RoleSelectMenuBuilder().setCustomId(`config_set_role_${settingKey}`).setPlaceholder(`${settingLabel}`);
          await i.reply({
            content: t(gid, 'config_choosing_role', {
              setting: settingLabel
            }),
            components: [new ActionRowBuilder().addComponents(roleSelect)],
            flags: MessageFlags.Ephemeral
          });
          try {
            const roleInteraction = await i.channel.awaitMessageComponent({
              filter: ri => ri.customId === `config_set_role_${settingKey}` && ri.user.id === interaction.user.id,
              time: 120000
            });
            const role = roleInteraction.roles.first();
            if (!role) {
              await roleInteraction.reply({
                content: '❌ Aucun rôle sélectionné.',
                flags: MessageFlags.Ephemeral
              });
              return;
            }
            const gcfg = getGuildConfig(interaction.guild.id);
            gcfg[settingKey] = role.id;
            persist('config');
            await roleInteraction.reply({
              content: t(gid, 'config_role_set', {
                role: role.toString()
              }),
              flags: MessageFlags.Ephemeral
            });
            await interaction.editReply(buildCategoryPayload(catKey, interaction.guild)).catch(() => { });
          } catch (e) {
            // Délai du sélecteur dépassé — ignoré silencieusement
          }
          return;
        }
        if (setting.type === 'channel') {
          const channelSelect = new ChannelSelectMenuBuilder().setCustomId(`config_set_channel_${settingKey}`).setPlaceholder(`${settingLabel}`).addChannelTypes(ChannelType.GuildText);
          await i.reply({
            content: t(gid, 'config_choosing_channel', {
              setting: settingLabel
            }),
            components: [new ActionRowBuilder().addComponents(channelSelect)],
            flags: MessageFlags.Ephemeral
          });
          try {
            const channelInteraction = await i.channel.awaitMessageComponent({
              filter: ci => ci.customId === `config_set_channel_${settingKey}` && ci.user.id === interaction.user.id,
              time: 120000
            });
            const channel = channelInteraction.channels.first();
            const gcfg = getGuildConfig(interaction.guild.id);
            gcfg[settingKey] = channel.id;
            persist('config');
            await channelInteraction.reply({
              content: t(gid, 'config_channel_set', {
                channel: channel.toString()
              }),
              flags: MessageFlags.Ephemeral
            });
            await interaction.editReply(buildCategoryPayload(catKey, interaction.guild)).catch(() => { });
          } catch (e) {
            // Délai du sélecteur dépassé — ignoré silencieusement
          }
          return;
        }
        if (setting.type === 'boolean') {
          cfg[settingKey] = !cfg[settingKey];
          persist('config');
          const stateLabel = cfg[settingKey] ? t(gid, 'general_enabled') : t(gid, 'general_disabled');
          await i.reply({
            content: t(gid, 'config_boolean_set', {
              setting: settingLabel,
              value: stateLabel
            }),
            flags: MessageFlags.Ephemeral
          });
          return await interaction.editReply(buildCategoryPayload(catKey, interaction.guild)).catch(() => { });
        }
        if (setting.type === 'text' || setting.type === 'number') {
          const modal = new ModalBuilder().setCustomId(`config_modal_${settingKey}`).setTitle(settingLabel.slice(0, 45));
          const input = new TextInputBuilder().setCustomId('value').setLabel(settingLabel.slice(0, 45)).setStyle(setting.type === 'text' && setting.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(true).setMaxLength(setting.type === 'number' ? 6 : 1500);
          const current = cfg[settingKey];
          if (current !== undefined && current !== null && current !== '') {
            input.setValue(String(current).slice(0, 1500));
          }
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await i.showModal(modal);
          try {
            const modalSubmit = await i.awaitModalSubmit({
              time: 120000,
              filter: mi => mi.customId === `config_modal_${settingKey}` && mi.user.id === interaction.user.id
            });
            const raw = modalSubmit.fields.getTextInputValue('value').trim();
            if (setting.type === 'number') {
              const num = parseInt(raw, 10);
              if (isNaN(num) || num < 0) {
                return await modalSubmit.reply({
                  content: t(gid, 'config_invalid_number'),
                  flags: MessageFlags.Ephemeral
                });
              }
              cfg[settingKey] = num;
            } else {
              cfg[settingKey] = raw;
            }
            persist('config');
            await modalSubmit.reply({
              content: t(gid, 'config_setting_updated', {
                setting: settingLabel
              }),
              flags: MessageFlags.Ephemeral
            });
            await interaction.editReply(buildCategoryPayload(catKey, interaction.guild)).catch(() => { });
          } catch (e) {
            // Délai du modal dépassé — ignoré silencieusement
          }
          return;
        }
      }

      // (les blocs "config_set_role_" / "config_set_channel_" sont gérés
      // directement au moment de l'affichage du sélecteur, ci-dessous —
      // le collecteur d'origine ne voit jamais ces interactions car elles
      // arrivent sur un NOUVEAU message éphémère, pas sur replyMessage)

      // ── Bienvenue / Au revoir : message (titre, message, couleur) ──
      if (i.customId === 'config_welcome_msg_btn' || i.customId === 'config_goodbye_msg_btn') {
        if (!(await requireCustomization(i))) return;
        const isWelcome = i.customId === 'config_welcome_msg_btn';
        const modalCustomId = isWelcome ? 'config_msgmodal_welcome' : 'config_msgmodal_goodbye';
        const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(isWelcome ? 'Message de bienvenue' : 'Message d\'au revoir');
        const cfg = getGuildConfig(interaction.guild.id);
        const appearance = (isWelcome ? cfg.welcome_appearance : cfg.goodbye_appearance) || {};
        const titreInput = new TextInputBuilder().setCustomId('titre').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
        if (appearance.title) titreInput.setValue(String(appearance.title).slice(0, 256));
        const titreLabel = new LabelBuilder().setLabel('Titre').setDescription('{user.mention} {user.name} {user.id} {user.joined_at} {server.name} {server.member_count}').setTextInputComponent(titreInput);
        const messageInput = new TextInputBuilder().setCustomId('message').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500);
        if (appearance.description) messageInput.setValue(String(appearance.description).slice(0, 1500));
        const messageLabel = new LabelBuilder().setLabel('Message').setDescription('{user.mention} {user.name} {user.id} {user.joined_at} {server.name} {server.member_count}').setTextInputComponent(messageInput);
        const {
          couleurLabel,
          couleurHexLabel
        } = buildCouleurLabelComponents(appearance.color);
        modal.addLabelComponents(titreLabel, messageLabel, couleurLabel, couleurHexLabel);
        await i.showModal(modal);
        try {
          const modalSubmit = await i.awaitModalSubmit({
            time: 120000,
            filter: mi => mi.customId === modalCustomId && mi.user.id === interaction.user.id
          });
          const titre = modalSubmit.fields.getTextInputValue('titre').trim();
          const message = modalSubmit.fields.getTextInputValue('message').trim();
          const couleur = resoudreCouleurDepuisModal(modalSubmit);
          if (couleur === null) {
            return await modalSubmit.reply({
              content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `FC964B`.',
              flags: MessageFlags.Ephemeral
            });
          }
          const gcfg = getGuildConfig(interaction.guild.id);
          const key = isWelcome ? 'welcome_appearance' : 'goodbye_appearance';
          if (!gcfg[key]) gcfg[key] = {};
          if (titre) gcfg[key].title = titre;
          if (message) gcfg[key].description = message;
          if (couleur !== undefined) gcfg[key].color = couleur;
          persist('config');
          await modalSubmit.reply({
            content: isWelcome ? '✅ Message de bienvenue personnalisé !' : '✅ Message d\'au revoir personnalisé !',
            flags: MessageFlags.Ephemeral
          });
          await interaction.editReply(buildCategoryPayload('premium', interaction.guild)).catch(() => { });
        } catch (e) {
          // Délai du modal dépassé — ignoré silencieusement
        }
        return;
      }

      // ── Bienvenue / Au revoir : image personnalisée ──────
      if (i.customId === 'config_welcome_img_btn' || i.customId === 'config_goodbye_img_btn') {
        if (!(await requireCustomization(i))) return;
        const isWelcome = i.customId === 'config_welcome_img_btn';
        const dirName = isWelcome ? 'welcome_images' : 'goodbye_images';
        const label = isWelcome ? 'bienvenue' : 'au revoir';
        await i.reply({
          content: '📸 Envoyez une image dans ce salon (60 secondes) pour la définir.',
          flags: MessageFlags.Ephemeral
        });
        const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
        const imgCollector = interaction.channel.createMessageCollector({
          filter,
          time: 60000,
          max: 1
        });
        imgCollector.on('collect', async m => {
          const attachment = m.attachments.first();
          if (!attachment.contentType?.startsWith('image/')) {
            return i.followUp({
              content: '❌ Ce n\'est pas une image valide.',
              flags: MessageFlags.Ephemeral
            });
          }
          const MAX_SIZE = 8 * 1024 * 1024; // 8 Mo — marge de sécurité sous la limite d'upload Discord
          if (attachment.size > MAX_SIZE) {
            return i.followUp({
              content: `❌ Image trop lourde (${(attachment.size / 1024 / 1024).toFixed(1)} Mo). Utilise une image de 8 Mo maximum, sinon le message de ${label} ne pourra pas être envoyé.`,
              flags: MessageFlags.Ephemeral
            });
          }
          try {
            const res = await fetch(attachment.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            const dir = dossierPersistant(dirName);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
              recursive: true
            });

            // Détermine la vraie extension (gif compris, pour garder l'animation)
            const extFromType = {
              'image/gif': 'gif',
              'image/png': 'png',
              'image/jpeg': 'jpg',
              'image/webp': 'webp'
            }[attachment.contentType] || 'png';

            // Nettoie les anciennes versions (autres extensions) pour ce serveur
            for (const oldExt of ['gif', 'png', 'jpg', 'jpeg', 'webp']) {
              const oldPath = path.join(dir, `${interaction.guild.id}.${oldExt}`);
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            fs.writeFileSync(path.join(dir, `${interaction.guild.id}.${extFromType}`), buffer);
            await i.followUp({
              content: `✅ Image de ${label} enregistrée !${extFromType === 'gif' ? ' (GIF animé)' : ''}`,
              flags: MessageFlags.Ephemeral
            });
          } catch (e) {
            console.error(`Erreur lors de l'enregistrement de l'image de ${label} :`, e.message);
            await i.followUp({
              content: '❌ Erreur lors de l\'enregistrement.',
              flags: MessageFlags.Ephemeral
            });
          }
        });
        imgCollector.on('end', collected => {
          if (collected.size === 0) {
            i.followUp({
              content: '⏱️ Temps écoulé, aucune image reçue.',
              flags: MessageFlags.Ephemeral
            }).catch(() => { });
          }
        });
        return;
      }

      // ── Bienvenue / Au revoir : éditeur de la carte (image par défaut) ──
      if (i.customId === 'config_welcome_card_btn' || i.customId === 'config_goodbye_card_btn') {
        if (!(await requireCustomization(i))) return;
        await openCardEditor(i, i.customId === 'config_welcome_card_btn' ? 'welcome' : 'goodbye');
        return;
      }

      // ── Bienvenue / Au revoir : boutons de lien personnalisés ──
      if (i.customId === 'config_welcome_links_btn' || i.customId === 'config_goodbye_links_btn') {
        if (!(await requireCustomization(i))) return;
        const isWelcome = i.customId === 'config_welcome_links_btn';
        const modalCustomId = isWelcome ? 'config_linksmodal_welcome' : 'config_linksmodal_goodbye';
        const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(isWelcome ? 'Boutons — Bienvenue' : 'Boutons — Au revoir');
        const cfg = getGuildConfig(interaction.guild.id);
        const appearance = (isWelcome ? cfg.welcome_appearance : cfg.goodbye_appearance) || {};
        const labels = buildLinkButtonsLabelComponents(appearance.buttons || []);
        modal.addLabelComponents(...labels);
        await i.showModal(modal);
        try {
          const modalSubmit = await i.awaitModalSubmit({
            time: 120000,
            filter: mi => mi.customId === modalCustomId && mi.user.id === interaction.user.id
          });
          const {
            buttons,
            erreurs
          } = parseLinkButtonsFromModal(modalSubmit);
          const gcfg = getGuildConfig(interaction.guild.id);
          const key = isWelcome ? 'welcome_appearance' : 'goodbye_appearance';
          if (!gcfg[key]) gcfg[key] = {};
          gcfg[key].buttons = buttons;
          persist('config');
          const label = isWelcome ? 'de bienvenue' : 'd\'au revoir';
          const confirmation = buttons.length ? `✅ ${buttons.length} bouton(s) ${label} enregistré(s) !` : `✅ Boutons ${label} supprimés (aucun champ valide).`;
          const avertissement = erreurs.length ? `\n⚠️ Champ(s) invalide(s) ignoré(s) : Bouton ${erreurs.join(', Bouton ')}. Format attendu : \`Texte | https://lien\`.` : '';
          await modalSubmit.reply({
            content: confirmation + avertissement,
            flags: MessageFlags.Ephemeral
          });
          await interaction.editReply(buildCategoryPayload('premium', interaction.guild)).catch(() => { });
        } catch (e) {
          // Délai du modal dépassé — ignoré silencieusement
        }
        return;
      }

      // ── Bienvenue / Au revoir : réinitialisation ─────────
      if (i.customId === 'config_welcome_reset_btn' || i.customId === 'config_goodbye_reset_btn') {
        if (!(await requireCustomization(i))) return;
        const isWelcome = i.customId === 'config_welcome_reset_btn';
        const gcfg = getGuildConfig(interaction.guild.id);
        delete gcfg[isWelcome ? 'welcome_appearance' : 'goodbye_appearance'];
        delete gcfg[isWelcome ? 'welcome_card' : 'goodbye_card'];
        for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
          const bgPath = path.join(dossierPersistant('card_backgrounds'), `${interaction.guild.id}_${isWelcome ? 'welcome' : 'goodbye'}.${ext}`);
          if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        }
        persist('config');
        const dirName = isWelcome ? 'welcome_images' : 'goodbye_images';
        const dir = dossierPersistant(dirName);
        for (const ext of ['gif', 'png', 'jpg', 'jpeg', 'webp']) {
          const imgPath = path.join(dir, `${interaction.guild.id}.${ext}`);
          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
        await i.reply({
          content: isWelcome ? '✅ Message de bienvenue réinitialisé (texte + image par défaut).' : '✅ Message d\'au revoir réinitialisé (texte + image par défaut).',
          flags: MessageFlags.Ephemeral
        });
        await interaction.editReply(buildCategoryPayload('premium', interaction.guild)).catch(() => { });
        return;
      }

      // ── XP : ajouter / retirer / réinitialiser l'XP d'un membre ──
      if (i.customId === 'config_xp_add_btn' || i.customId === 'config_xp_remove_btn' || i.customId === 'config_xp_reset_btn') {
        const mode = i.customId === 'config_xp_add_btn' ? 'add' : i.customId === 'config_xp_remove_btn' ? 'remove' : 'reset';
        const userSelect = new UserSelectMenuBuilder().setCustomId(`config_xp_select_${mode}`).setPlaceholder('Choisir un membre').setMinValues(1).setMaxValues(1);
        const label = mode === 'add' ? 'à qui ajouter de l\'XP' : mode === 'remove' ? 'à qui retirer de l\'XP' : 'dont réinitialiser l\'XP';
        const selMsg = await i.reply({
          content: `Sélectionnez le membre ${label} :`,
          components: [new ActionRowBuilder().addComponents(userSelect)],
          flags: MessageFlags.Ephemeral,
          fetchReply: true
        });
        let sel;
        try {
          sel = await selMsg.awaitMessageComponent({
            filter: si => si.user.id === interaction.user.id && si.customId === `config_xp_select_${mode}`,
            time: 120000
          });
        } catch {
          return;
        }
        const targetUser = sel.users.first();
        if (mode === 'reset') {
          const bucket = getGuildBucket(interaction.guild.id, 'xpData', {});
          delete bucket[String(targetUser.id)];
          persist('xpData');
          await sel.update({
            content: `✅ L'XP de ${targetUser} a été réinitialisée.`,
            components: []
          }).catch(() => { });
          return;
        }
        const modalCustomId = `config_xp_amount_modal_${mode}_${targetUser.id}`;
        const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(mode === 'add' ? 'Ajouter de l\'XP' : 'Retirer de l\'XP');
        const amountInput = new TextInputBuilder().setCustomId('montant').setLabel('Quantité d\'XP').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        await sel.showModal(modal);
        try {
          const modalSubmit = await sel.awaitModalSubmit({
            time: 120000,
            filter: mi => mi.customId === modalCustomId && mi.user.id === interaction.user.id
          });
          const raw = modalSubmit.fields.getTextInputValue('montant').trim();
          const amount = parseInt(raw, 10);
          if (isNaN(amount) || amount < 0) {
            return await modalSubmit.reply({
              content: '❌ Quantité invalide.',
              flags: MessageFlags.Ephemeral
            });
          }
          const bucket = getGuildBucket(interaction.guild.id, 'xpData', {});
          const uid = String(targetUser.id);
          if (mode === 'add') {
            bucket[uid] = (bucket[uid] || 0) + amount;
          } else {
            bucket[uid] = Math.max(0, (bucket[uid] || 0) - amount);
          }
          persist('xpData');
          try {
            const tMember = await interaction.guild.members.fetch(uid);
            await require('../handlers/xpEngine').applyRoleRewards(tMember, getGuildConfig(interaction.guild.id), require('../handlers/xpEngine').getLevelFromXp(bucket[uid]).level);
          } catch (e) { /* rôles non appliqués (membre absent / permissions) */ }
          await modalSubmit.reply({
            content: mode === 'add' ? `✅ ${amount} XP ajouté à ${targetUser}.` : `✅ ${amount} XP retiré à ${targetUser}.`,
            flags: MessageFlags.Ephemeral
          });
        } catch (e) {
          // Délai du modal dépassé — ignoré silencieusement
        }
        return;
      }

      // ── XP : gestion des rôles de récompense ─────────────
      if (i.customId === 'config_xp_roles_btn') {
        const cfg = getGuildConfig(interaction.guild.id);
        const embed = buildXpRolesEmbed(gid, cfg);
        const rolesRows = buildXpRolesRows(gid, cfg, interaction.guild);
        return await safeComponentUpdate(i, configPayload(embed, rolesRows));
      }
      if (i.customId === 'config_xp_roles_mode_btn') {
        const mcfg = getGuildConfig(interaction.guild.id);
        mcfg.xp_roles_mode = mcfg.xp_roles_mode === 'replace' ? 'stack' : 'replace';
        persist('config');
        return await safeComponentUpdate(i, configPayload(buildXpRolesEmbed(gid, mcfg), buildXpRolesRows(gid, mcfg, interaction.guild)));
      }
      if (i.customId === 'config_xp_back_btn') {
        const cfg = getGuildConfig(interaction.guild.id);
        return await safeComponentUpdate(i, buildCategoryPayload('niveaux', interaction.guild));
      }
      if (i.customId === 'config_xp_role_add_btn') {
        const roleSelect = new RoleSelectMenuBuilder().setCustomId('config_xp_role_pick').setPlaceholder('Choisir le rôle à attribuer');
        const roleMsg = await i.reply({
          content: 'Sélectionnez le rôle de récompense :',
          components: [new ActionRowBuilder().addComponents(roleSelect)],
          flags: MessageFlags.Ephemeral,
          fetchReply: true
        });
        let pick;
        try {
          pick = await roleMsg.awaitMessageComponent({
            filter: pi => pi.user.id === interaction.user.id && pi.customId === 'config_xp_role_pick',
            time: 120000
          });
        } catch {
          return;
        }
        const role = pick.roles.first();
        if (!role) {
          return await pick.reply({
            content: '❌ Aucun rôle sélectionné.',
            flags: MessageFlags.Ephemeral
          });
        }
        const modalCustomId = `config_xp_role_level_modal_${role.id}`;
        const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle('Niveau requis');
        const levelInput = new TextInputBuilder().setCustomId('niveau').setLabel('Niveau requis pour obtenir ce rôle').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4);
        modal.addComponents(new ActionRowBuilder().addComponents(levelInput));
        await pick.showModal(modal);
        try {
          const modalSubmit = await pick.awaitModalSubmit({
            time: 120000,
            filter: mi => mi.customId === modalCustomId && mi.user.id === interaction.user.id
          });
          const raw = modalSubmit.fields.getTextInputValue('niveau').trim();
          const level = parseInt(raw, 10);
          if (isNaN(level) || level < 1) {
            return await modalSubmit.reply({
              content: '❌ Niveau invalide.',
              flags: MessageFlags.Ephemeral
            });
          }
          const gcfg = getGuildConfig(interaction.guild.id);
          gcfg.xp_roles = (gcfg.xp_roles || []).filter(r => !(r.level === level && r.roleId === role.id));
          if (gcfg.xp_roles.length >= 25) {
            return await modalSubmit.reply({
              content: '❌ Maximum 25 rôles de récompense.',
              flags: MessageFlags.Ephemeral
            });
          }
          gcfg.xp_roles.push({
            level,
            roleId: role.id
          });
          gcfg.xp_roles.sort((a, b) => a.level - b.level);
          persist('config');
          const me = interaction.guild.members.me;
          const warn = role.managed || role.position >= me.roles.highest.position ? '\n⚠️ Je ne pourrai pas attribuer ce rôle : place le rôle de CoreLab **au-dessus** dans la liste des rôles du serveur.' : '';
          await modalSubmit.reply({
            content: `✅ ${role} sera attribué au niveau ${level}.${warn}`,
            flags: MessageFlags.Ephemeral
          });
          await interaction.editReply(configPayload(buildXpRolesEmbed(gid, gcfg), buildXpRolesRows(gid, gcfg, interaction.guild))).catch(() => { });
        } catch (e) {
          // Délai du modal dépassé — ignoré silencieusement
        }
        return;
      }
      if (i.customId === 'config_xp_role_remove_select') {
        const [lvlRaw, rid] = String(i.values[0]).split(':');
        const level = parseInt(lvlRaw, 10);
        const gcfg = getGuildConfig(interaction.guild.id);
        gcfg.xp_roles = (gcfg.xp_roles || []).filter(r => !(r.level === level && (rid === undefined || r.roleId === rid)));
        persist('config');
        const embed = buildXpRolesEmbed(gid, gcfg);
        const rolesRows = buildXpRolesRows(gid, gcfg, interaction.guild);
        return await safeComponentUpdate(i, configPayload(embed, rolesRows, {
          notice: `✅ Récompense du niveau ${level} retirée.`
        }));
      }

      // ── XP : image personnalisée (annonce de montée de niveau) ──
      if (i.customId === 'config_xp_img_btn') {
        if (!(await requireCustomization(i))) return;
        await i.reply({
          content: '📸 Envoyez une image dans ce salon (60 secondes) pour l\'utiliser en illustration de l\'annonce de montée de niveau. Tapez `supprimer` pour retirer l\'image actuelle.',
          flags: MessageFlags.Ephemeral
        });
        const filter = m => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.trim().toLowerCase() === 'supprimer');
        const imgCollector = interaction.channel.createMessageCollector({
          filter,
          time: 60000,
          max: 1
        });
        imgCollector.on('collect', async m => {
          const dir = dossierPersistant('xp_images');
          if (m.content.trim().toLowerCase() === 'supprimer') {
            if (fs.existsSync(dir)) {
              for (const ext of XP_IMAGE_EXTENSIONS) {
                const oldPath = path.join(dir, `${interaction.guild.id}.${ext}`);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
              }
            }
            return i.followUp({
              content: '✅ Image XP supprimée.',
              flags: MessageFlags.Ephemeral
            });
          }
          const attachment = m.attachments.first();
          if (!attachment.contentType?.startsWith('image/')) {
            return i.followUp({
              content: '❌ Ce n\'est pas une image valide.',
              flags: MessageFlags.Ephemeral
            });
          }
          const MAX_SIZE = 8 * 1024 * 1024; // 8 Mo — marge de sécurité sous la limite d'upload Discord
          if (attachment.size > MAX_SIZE) {
            return i.followUp({
              content: `❌ Image trop lourde (${(attachment.size / 1024 / 1024).toFixed(1)} Mo). Utilise une image de 8 Mo maximum.`,
              flags: MessageFlags.Ephemeral
            });
          }
          try {
            const res = await fetch(attachment.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
              recursive: true
            });
            const extFromType = {
              'image/gif': 'gif',
              'image/png': 'png',
              'image/jpeg': 'jpg',
              'image/webp': 'webp'
            }[attachment.contentType] || 'png';
            for (const oldExt of XP_IMAGE_EXTENSIONS) {
              const oldPath = path.join(dir, `${interaction.guild.id}.${oldExt}`);
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            fs.writeFileSync(path.join(dir, `${interaction.guild.id}.${extFromType}`), buffer);
            await i.followUp({
              content: `✅ Image XP enregistrée !${extFromType === 'gif' ? ' (GIF animé)' : ''}`,
              flags: MessageFlags.Ephemeral
            });
          } catch (e) {
            console.error('Erreur lors de l\'enregistrement de l\'image XP :', e.message);
            await i.followUp({
              content: '❌ Erreur lors de l\'enregistrement.',
              flags: MessageFlags.Ephemeral
            });
          }
        });
        imgCollector.on('end', collected => {
          if (collected.size === 0) {
            i.followUp({
              content: '⏱️ Temps écoulé, aucune image reçue.',
              flags: MessageFlags.Ephemeral
            }).catch(() => { });
          }
        });
        return;
      }
      // ── Boutons Traduction / Réponses automatiques ──────
      // Ces interactions sont gérées globalement dans index.js,
      // pas via le collecteur local du panneau /settings.
    } catch (e) {
      console.error('Erreur dans le collecteur /settings :', e);
      if (e?.errors) console.error('Détail de la validation :', JSON.stringify(e.errors, null, 2));
      if (e?.rawError) console.error('Détail API Discord :', JSON.stringify(e.rawError, null, 2));
      await i.followUp({
        content: '❌ Une erreur est survenue, merci de réessayer.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    } finally {
      clearTimeout(autoDeferTimer);
    }
  });
  collector.on('end', () => {
    interaction.editReply({
      components: []
    }).catch(() => { });
  });
}

// Ancienne commande /ticket, /langue et /reglement : conservées comme fonctions
// réutilisables, exécutées désormais via /settings ticket, /settings language, /settings rules.
async function executeTicket(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const { buildTicketConfigPayload } = require('../handlers/ticket');
  await safeReply(interaction, await buildTicketConfigPayload(cfg, interaction.channel.id, interaction.guild, { ephemeral: true }));
}
async function executeVocalTemp(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.tempvoice_enabled = true;
  persist('configuration');
  await interaction.reply({
    content: '✅ Salons vocaux temporaires activés.',
    flags: MessageFlags.Ephemeral
  });
}

// ── Jeu de Comptage (sous-commandes de /settings counting) ──
async function executeComptageSalon(interaction) {
  const salon = interaction.options.getChannel('cible');
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.counting_channel_id = salon.id;
  cfg.counting_enabled = true;
  persist('configuration');

  const state = getCountingState(interaction.guild.id);
  state.current = 0;
  state.lastUserId = null;
  setCountingState(interaction.guild.id, state);

  await salon.send({
    embeds: [new EmbedBuilder()
      .setTitle('🔢 Jeu de Comptage activé !')
      .setDescription('La communauté compte à la suite dans ce salon.\nÀ vous de jouer : commencez par **1** !')
      .setColor(0xFFFFFF)]
  }).catch(() => { });

  return interaction.reply({
    content: `✅ Jeu de comptage activé dans ${salon}.`,
    flags: MessageFlags.Ephemeral
  });
}
async function executeComptageStop(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.counting_enabled = false;
  persist('configuration');
  return interaction.reply({ content: '🔴 Jeu de comptage désactivé.', flags: MessageFlags.Ephemeral });
}
async function executeComptageStats(interaction) {
  return interaction.reply({ embeds: [buildComptageStatsEmbed(interaction.guild)], flags: MessageFlags.Ephemeral });
}
async function executeComptageReset(interaction) {
  const state = getCountingState(interaction.guild.id);
  state.current = 0;
  state.lastUserId = null;
  setCountingState(interaction.guild.id, state);
  return interaction.reply({ content: '♻️ Le compte a été remis à **0**.', flags: MessageFlags.Ephemeral });
}
function clonerOptionsDans(builder, cmd) {
  if (cmd?.data?.options) {
    for (const opt of cmd.data.options) builder.options.push(opt);
  }
  return builder;
}

const {
  starboardSettingsCmd
} = require('./starboard');
const {
  reglementCmd
} = require('./reglement');
const { ouvrirEditionReglement } = require('../core/reglement');
const {
  notificationCmd,
  partenariatConfigCmd,
  partenariatListeCmd,
  partenariatStatistiquesCmd,
  partenariatRetirerCmd,
  partenariatReinitialiserCmd,
  partenariatAutoCmd,
  configAnnonceCmd
} = require('./general');

// ════════════════════════════════════════════════
// /settings — commande consolidée avec sous-commandes.
// Regroupe ce qui était auparavant : /ticket, /langue, /reglement,
// /starboard-settings, /protect-settings, /vocal-temp-configurer,
// /notification, /config-annonce, /partenariat-config, /partenariat-liste,
// /partenariat-statistiques, /partenariat-retirer, /partenariat-reinitialiser
// et /partenariat (configurer) — pour libérer des emplacements de commandes
// (Discord limite à 100 commandes slash par serveur/application).
// ⚠️ Ces sous-commandes étaient pour la plupart en Manage Server (ticket,
// starboard, protection, langue) : elles passent maintenant en Administrator,
// le niveau déjà requis par /settings lui-même.
// ════════════════════════════════════════════════
const config = {
  data: (() => {
    const cmd = new SlashCommandBuilder().setName('config').setDescription('Ouvrir le panneau de configuration complet du serveur').setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    cmd.addSubcommand(sub => clonerOptionsDans(sub.setName('annonce').setDescription('Définir le salon pour les annonces globales'), configAnnonceCmd));
    cmd.addSubcommand(sub => sub.setName('langue').setDescription('Changer la langue du bot sur ce serveur'));
    cmd.addSubcommand(sub => sub.setName('ticket').setDescription('Configurer les tickets ou publier le panneau'));
    cmd.addSubcommand(sub => clonerOptionsDans(sub.setName('reglement').setDescription('Configurer le règlement du serveur'), reglementCmd));
    cmd.addSubcommand(sub => sub.setName('reglement-edit').setDescription('Modifier le règlement déjà publié'));
    cmd.addSubcommand(sub => sub.setName('starboard').setDescription('Panneau de configuration du StarBoard'));
    cmd.addSubcommand(sub => sub.setName('vocal-temp').setDescription('Configurer les salons vocaux temporaires'));
    cmd.addSubcommand(sub => sub.setName('comptage').setDescription('Définir le salon du jeu de comptage et l\'activer').addChannelOption(o => o.setName('cible').setDescription('Salon où la commu va compter').addChannelTypes(ChannelType.GuildText).setRequired(true)));
    cmd.addSubcommand(sub => sub.setName('comptage-stop').setDescription('Désactiver le jeu de comptage'));
    cmd.addSubcommand(sub => sub.setName('comptage-stats').setDescription('Voir le compte actuel et le record du serveur'));
    cmd.addSubcommand(sub => sub.setName('comptage-reset').setDescription('Remettre le compte à 0 (le record n\'est pas touché)'));
    cmd.addSubcommandGroup(group => {
      group.setName('notifications').setDescription('Gérer les notifications YouTube, Twitch, Blog, Medal, TikTok');
      for (const sub of notificationCmd.data.options) group.options.push(sub);
      return group;
    });
    // /settings partnership — configuration principale (les options de partenariatConfigCmd sont clonées directement)
    cmd.addSubcommand(sub => {
      sub.setName('partenariat').setDescription('Configurer le partenariat (titre, description, image, rôle)');
      if (partenariatConfigCmd.data?.options) {
        for (const opt of partenariatConfigCmd.data.options) sub.options.push(opt);
      }
      return sub;
    });
    cmd.addSubcommand(sub => sub.setName('partenariat-liste').setDescription('Voir les partenaires enregistrés'));
    cmd.addSubcommand(sub => sub.setName('partenariat-statistiques').setDescription('Voir les statistiques du partenariat'));
    cmd.addSubcommand(sub => clonerOptionsDans(sub.setName('partenariat-retirer').setDescription('Retirer un partenaire'), partenariatRetirerCmd));
    cmd.addSubcommand(sub => sub.setName('partenariat-reinitialiser').setDescription('Réinitialiser les statistiques à zéro'));
    cmd.addSubcommand(sub => {
      sub.setName('partenariat-auto').setDescription('Configurer la détection automatique de lien d\'invitation');
      const inner = partenariatAutoCmd.data.options[0];
      if (inner?.options) for (const opt of inner.options) sub.options.push(opt);
      return sub;
    });
    return cmd;
  })(),
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group === 'notifications') return notificationCmd.execute(interaction);
    if (sub === 'partenariat') return partenariatConfigCmd.execute(interaction);
    if (sub === 'partenariat-liste') return partenariatListeCmd.execute(interaction);
    if (sub === 'partenariat-statistiques') return partenariatStatistiquesCmd.execute(interaction);
    if (sub === 'partenariat-retirer') return partenariatRetirerCmd.execute(interaction);
    if (sub === 'partenariat-reinitialiser') return partenariatReinitialiserCmd.execute(interaction);
    if (sub === 'partenariat-auto') return partenariatAutoCmd.execute(interaction);
    if (sub === 'comptage') return executeComptageSalon(interaction);
    if (sub === 'comptage-stop') return executeComptageStop(interaction);
    if (sub === 'comptage-stats') return executeComptageStats(interaction);
    if (sub === 'comptage-reset') return executeComptageReset(interaction);
    if (sub === 'annonce') return configAnnonceCmd.execute(interaction);
    if (sub === 'langue') return langue.execute(interaction);
    if (sub === 'ticket') return executeTicket(interaction);
    if (sub === 'reglement') return reglementCmd.execute(interaction);
    if (sub === 'reglement-edit') return ouvrirEditionReglement(interaction);
    if (sub === 'starboard') return starboardSettingsCmd.execute(interaction);
    if (sub === 'vocal-temp') return executeVocalTemp(interaction);
    return executePanneau(interaction);
  }
};
const configPanneau = {
  data: new SlashCommandBuilder().setName('config-panel').setDescription('Ouvrir le panneau de configuration complet du serveur').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    return executePanneau(interaction);
  }
};
const tempban = {
  data: new SlashCommandBuilder().setName('bannissement-temporaire').setDescription('Bannir temporairement un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('jours').setDescription('Durée en jours').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const days = interaction.options.getInteger('jours');
    const reason = interaction.options.getString('raison') || 'Aucune';
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    try {
      await member.ban({
        reason
      });
    } catch {
      return interaction.editReply(t(interaction.guild.id, 'tempban_failed'));
    }
    const gid = String(interaction.guild.id);
    const uid = String(member.id);
    if (!store.tempBans[gid]) store.tempBans[gid] = {};
    store.tempBans[gid][uid] = {
      guild_id: interaction.guild.id,
      end_time: new Date(Date.now() + days * 86400000).toISOString(),
      reason: reason
    };
    persist('tempBans');
    setTimeout(async () => {
      try {
        await interaction.guild.members.unban(member.id);
      } catch { }
      if (store.tempBans[gid]?.[uid]) {
        delete store.tempBans[gid][uid];
        persist('tempBans');
      }
    }, days * 86400000);
    await interaction.editReply(t(interaction.guild.id, 'tempban_success', {
      member: member.toString(),
      days
    }));
  }
};
const tempmute = {
  data: new SlashCommandBuilder().setName('muet-temporaire').setDescription('Rendre muet temporairement').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Durée en minutes').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('raison') || 'Aucune';
    const cfg = getGuildConfig(interaction.guild.id);
    const role = interaction.guild.roles.cache.get(cfg.mute_role);
    if (!role) return interaction.reply({
      content: t(interaction.guild.id, 'mute_role_missing'),
      flags: MessageFlags.Ephemeral
    });
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    await member.roles.add(role, reason);
    const gid = String(interaction.guild.id);
    const uid = String(member.id);
    if (!store.tempMutes[gid]) store.tempMutes[gid] = {};
    store.tempMutes[gid][uid] = {
      guild_id: interaction.guild.id,
      end_time: new Date(Date.now() + minutes * 60000).toISOString(),
      reason: reason
    };
    persist('tempMutes');
    setTimeout(async () => {
      try {
        await member.roles.remove(role);
      } catch { }
      if (store.tempMutes[gid]?.[uid]) {
        delete store.tempMutes[gid][uid];
        persist('tempMutes');
      }
    }, minutes * 60000);
    await interaction.editReply(t(interaction.guild.id, 'tempmute_success', {
      member: member.toString(),
      minutes
    }));
  }
};
const unmute = {
  data: new SlashCommandBuilder().setName('muet-retirer').setDescription('Rendre la parole à un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const cfg = getGuildConfig(interaction.guild.id);
    const role = interaction.guild.roles.cache.get(cfg.mute_role);
    if (!role) return interaction.reply({
      content: t(interaction.guild.id, 'mute_role_missing'),
      flags: MessageFlags.Ephemeral
    });
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    if (!member.roles.cache.has(role.id)) {
      return interaction.editReply(t(interaction.guild.id, 'unmute_not_muted', {
        member: member.toString()
      }));
    }
    await member.roles.remove(role);
    const gid = String(interaction.guild.id);
    const uid = String(member.id);
    if (store.tempMutes[gid]?.[uid]) {
      delete store.tempMutes[gid][uid];
      persist('tempMutes');
    }
    await interaction.editReply(t(interaction.guild.id, 'unmute_success', {
      member: member.toString()
    }));
  }
};
const timeout = {
  data: new SlashCommandBuilder().setName('timeout').setDescription('Mettre un membre en timeout').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(false).setMinValue(1)).addIntegerOption(o => o.setName('heures').setDescription('Heures').setRequired(false).setMinValue(1)).addIntegerOption(o => o.setName('jours').setDescription('Jours').setRequired(false).setMinValue(1)).addIntegerOption(o => o.setName('mois').setDescription('Mois (≈ 30 jours)').setRequired(false).setMinValue(1)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const minutes = interaction.options.getInteger('minutes') || 0;
    const heures = interaction.options.getInteger('heures') || 0;
    const jours = interaction.options.getInteger('jours') || 0;
    const mois = interaction.options.getInteger('mois') || 0;
    const reason = interaction.options.getString('raison') || 'Aucune';
    if (!minutes && !heures && !jours && !mois) {
      return interaction.reply({
        content: '❌ Spécifie au moins une durée (minutes, heures, jours ou mois).',
        flags: MessageFlags.Ephemeral
      });
    }
    const durationMs = (mois * 30 * 24 * 60 + jours * 24 * 60 + heures * 60 + minutes) * 60_000;
    const MAX_MS = 28 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_MS) {
      return interaction.reply({
        content: '❌ La durée maximale d\'un timeout est **28 jours**.',
        flags: MessageFlags.Ephemeral
      });
    }
    const parts = [];
    if (mois) parts.push(`${mois} mois`);
    if (jours) parts.push(`${jours} jour${jours > 1 ? 's' : ''}`);
    if (heures) parts.push(`${heures} heure${heures > 1 ? 's' : ''}`);
    if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    const dureeStr = parts.join(', ');
    await member.timeout(durationMs, reason);

    // DM au membre
    try {
      const dmEmbed = new EmbedBuilder().setColor(0xFF5C5C).setTitle('🔇 Tu as été mis en timeout').addFields({
        name: '🏠 Serveur',
        value: interaction.guild.name,
        inline: true
      }, {
        name: '⏱️ Durée',
        value: dureeStr,
        inline: true
      }, {
        name: '📋 Raison',
        value: reason,
        inline: false
      }).setTimestamp();
      await member.send(toCV2Payload({
        embeds: [dmEmbed]
      }));
    } catch {
      // DM désactivés — on ignore silencieusement
    }
    await interaction.reply({
      content: `✅ ${member} a été mis en timeout pendant **${dureeStr}**.\n📋 Raison : ${reason}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
const untimeout = {
  data: new SlashCommandBuilder().setName('untimeout').setDescription('Retirer le timeout').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    await member.timeout(null);
    await interaction.reply({
      content: t(interaction.guild.id, 'untimeout_success', {
        member: member.toString()
      }),
      flags: MessageFlags.Ephemeral
    });
  }
};
const addrole = {
  data: new SlashCommandBuilder().setName('role-ajouter').setDescription('Ajouter un rôle à un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const role = interaction.options.getRole('role');
    try {
      await member.roles.add(role);
      await interaction.reply({
        content: t(interaction.guild.id, 'addrole_success', {
          role: role.name,
          member: member.toString()
        }),
        flags: MessageFlags.Ephemeral
      });
    } catch (e) {
      await interaction.reply({
        content: t(interaction.guild.id, 'addrole_failed', {
          role: role.name
        }),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
const removerole = {
  data: new SlashCommandBuilder().setName('role-retirer').setDescription('Retirer un rôle à un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const role = interaction.options.getRole('role');
    try {
      await member.roles.remove(role);
      await interaction.reply({
        content: t(interaction.guild.id, 'removerole_success', {
          role: role.name,
          member: member.toString()
        }),
        flags: MessageFlags.Ephemeral
      });
    } catch (e) {
      await interaction.reply({
        content: t(interaction.guild.id, 'removerole_failed', {
          role: role.name
        }),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
const resetwarn = {
  data: new SlashCommandBuilder().setName('avertissement-reinitialiser').setDescription('Retirer tous les avertissements d\'un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const uid = String(member.id);
    if (store.warns[uid]) {
      delete store.warns[uid];
      persist('warns');
      await interaction.reply({
        content: t(interaction.guild.id, 'resetwarn_success', {
          member: member.toString()
        }),
        flags: MessageFlags.Ephemeral
      });
    } else {
      await interaction.reply({
        content: t(interaction.guild.id, 'resetwarn_none', {
          member: member.toString()
        }),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
const anniversaire = {
  data: new SlashCommandBuilder().setName('anniversaire').setDescription('Enregistrer votre date d\'anniversaire').addStringOption(o => o.setName('date').setDescription('Format : JJ/MM/AAAA').setRequired(true)),
  async execute(interaction) {
    const date = interaction.options.getString('date');
    const match = /^\d{1,2}\/\d{1,2}\/((\d{2})|(\d{4}))$/.exec(date);
    if (!match) return interaction.reply({
      content: t(interaction.guild.id, 'birthday_invalid_format'),
      flags: MessageFlags.Ephemeral
    });
    try {
      const [day, month, yearStr] = date.split('/');
      const dayN = Number(day);
      const monthN = Number(month);
      let year = Number(yearStr);
      if (year < 100) year += year <= 30 ? 2000 : 1900;
      const parsed = new Date(year, monthN - 1, dayN);
      if (parsed.getFullYear() !== year || parsed.getMonth() !== monthN - 1 || parsed.getDate() !== dayN) {
        throw new Error();
      }
      store.birthdays[String(interaction.user.id)] = `${String(dayN).padStart(2, '0')}/${String(monthN).padStart(2, '0')}/${year}`;
      persist('birthdays');
      const formatted = `${String(dayN).padStart(2, '0')}/${String(monthN).padStart(2, '0')}/${year}`;
      await interaction.reply({
        content: t(interaction.guild.id, 'birthday_saved', {
          date: formatted
        }),
        flags: MessageFlags.Ephemeral
      });
    } catch {
      await interaction.reply({
        content: t(interaction.guild.id, 'birthday_invalid_date'),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
// Récupère l'historique d'infractions d'un membre (tableau), en migrant
// silencieusement l'ancien format (simple compteur nombre) vers un tableau.
function getInfractionHistory(gid, uid) {
  const guildStore = store.infractions[gid];
  const existing = guildStore?.[uid];
  if (Array.isArray(existing)) return existing;
  if (typeof existing === 'number' && existing > 0) {
    // Ancien format : on reconstitue un tableau de taille équivalente, sans raison connue.
    return Array.from({
      length: existing
    }, () => ({
      reason: null,
      moderator: null,
      date: null
    }));
  }
  return [];
}
const infractions = {
  data: new SlashCommandBuilder().setName('infractions').setDescription('Voir les infractions d\'un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const gid = interaction.guild.id;
    const history = getInfractionHistory(gid, String(member.id));
    const count = history.length;
    const sanctions = {
      0: t(gid, 'infractions_none'),
      1: t(gid, 'infractions_next_mute10'),
      2: t(gid, 'infractions_next_mute1h'),
      3: t(gid, 'infractions_next_kick'),
      4: t(gid, 'infractions_next_ban')
    };
    const embed = new EmbedBuilder().setTitle(t(gid, 'infractions_title', {
      member: member.displayName
    })).addFields({
      name: t(gid, 'infractions_total'),
      value: String(count),
      inline: true
    }, {
      name: t(gid, 'infractions_next'),
      value: sanctions[count] || t(gid, 'infractions_ban_label'),
      inline: true
    }).setColor(0xFFFFFF);
    if (count > 0) {
      const recent = history.slice(-5).reverse().map((inf, i) => {
        const n = count - i;
        const raison = inf.reason || t(gid, 'infractions_no_reason');
        const date = inf.date ? `<t:${Math.floor(new Date(inf.date).getTime() / 1000)}:d>` : '—';
        return `**#${n}** — ${raison} (${date})`;
      }).join('\n');
      embed.addFields({
        name: t(gid, 'infractions_recent'),
        value: recent
      });
    }
    await interaction.reply(toCV2Payload({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    }));
  }
};
const infraction_add = {
  data: new SlashCommandBuilder().setName('infraction-ajouter').setDescription('Ajouter une infraction à un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const gid = String(interaction.guild.id);
    const uid = String(member.id);
    const reason = interaction.options.getString('raison');
    if (!store.infractions[gid]) store.infractions[gid] = {};
    const history = getInfractionHistory(gid, uid);
    history.push({
      reason,
      moderator: interaction.user.id,
      date: new Date().toISOString()
    });
    store.infractions[gid][uid] = history;
    persist('infractions');
    const cfg = getGuildConfig(interaction.guild.id);
    const logChannel = cfg.infraction_channel_id ? interaction.guild.channels.cache.get(cfg.infraction_channel_id) : null;
    const logEmbed = new EmbedBuilder().setAuthor({
      name: '📋 Infraction',
      iconURL: interaction.guild.iconURL()
    }).setColor(0xFFFFFF).setThumbnail(member.user.displayAvatarURL({
      size: 256
    })).addFields({
      name: '👤 Membre',
      value: `${member}\n\`${member.id}\``,
      inline: true
    }, {
      name: '🛡️ Modérateur',
      value: `${interaction.user}`,
      inline: true
    }, {
      name: '\u200B',
      value: '\u200B',
      inline: true
    }, {
      name: '📝 Raison',
      value: reason,
      inline: false
    }, {
      name: 'Total',
      value: String(history.length),
      inline: true
    }).setFooter({
      text: interaction.guild.name,
      iconURL: interaction.guild.iconURL()
    }).setTimestamp();
    if (logChannel) {
      await logChannel.send(toCV2Payload({
        embeds: [logEmbed]
      })).catch(() => { });
    }
    await interaction.reply({
      content: t(gid, 'infraction_add_success', {
        member: member.toString(),
        count: history.length
      }),
      flags: MessageFlags.Ephemeral
    });
  }
};
const infractions_reset = {
  data: new SlashCommandBuilder().setName('infractions-reinitialiser').setDescription('Réinitialiser les infractions d\'un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const gid = String(interaction.guild.id);
    const uid = String(member.id);
    if (store.infractions[gid]?.[uid]) {
      delete store.infractions[gid][uid];
      persist('infractions');
    }
    await interaction.reply({
      content: t(interaction.guild.id, 'infractions_reset_success', {
        member: member.toString()
      }),
      flags: MessageFlags.Ephemeral
    });
  }
};

// Commandes réservées au propriétaire / en MP (stats, premium) s'exécutent hors
// contexte de serveur, elles gardent donc un texte anglais statique — il n'y a
// pas de langue de serveur à appliquer.
const stats = {
  data: new SlashCommandBuilder().setName('statistiques').setDescription('Statistiques du bot (propriétaire)'),
  async execute(interaction) {
    if (interaction.guild) return interaction.reply({
      content: '❌ Commande réservée aux messages privés.',
      flags: MessageFlags.Ephemeral
    });
    if (interaction.user.id !== '1252736157285093397') return interaction.reply({
      content: '❌ Non autorisé.',
      flags: MessageFlags.Ephemeral
    });
    const guilds = interaction.client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);
    const totalMembers = guilds.reduce((acc, g) => acc + g.memberCount, 0);
    const lines = guilds.map((g, index) => `\`${index + 1}.\` **${g.name}** — ${g.memberCount} membres | ID : \`${g.id}\``);
    const embed = new EmbedBuilder().setTitle('📊 Statistiques CoreLab').setDescription(lines.slice(0, 25).join('\n')).addFields({
      name: '🌍 Serveurs',
      value: String(guilds.size),
      inline: true
    }, {
      name: '👥 Total des membres',
      value: String(totalMembers),
      inline: true
    }).setColor(0xFFFFFF);
    await interaction.reply(toCV2Payload({
      embeds: [embed]
    }));
  }
};
// /message : message classique (texte, 2000 car. max) + image optionnelle + jusqu'à 10 boutons-liens.
// Boutons : « Texte|https://lien » séparés par « ; » (ou un retour à la ligne).
// Ex : Discord|https://discord.gg/xxx ; Site|https://exemple.fr ; Boutique|https://exemple.fr/shop
const MESSAGE_MAX_BUTTONS = 10; // 2 lignes de 5 (limite Discord)
function parseMessageButtons(raw) {
  const buttons = [];
  const invalid = [];
  const parts = String(raw || '').split(/\s*;\s*|\r?\n/).map(x => x.trim()).filter(Boolean);
  parts.forEach((part, idx) => {
    const parsed = parseLinkButtonField(part);
    if (parsed) buttons.push(parsed); else invalid.push(idx + 1);
  });
  return { buttons, invalid, tooMany: buttons.length > MESSAGE_MAX_BUTTONS };
}
function buildMessageButtonRows(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length && rows.length < 2; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5).map(b => new ButtonBuilder().setLabel(b.label).setStyle(ButtonStyle.Link).setURL(b.url))));
  }
  return rows;
}
const message = {
  data: new SlashCommandBuilder().setName('message').setDescription('Envoyer un message dans un salon').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(o => o.setName('salon').setDescription('Salon de destination').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o => o.setName('texte').setDescription('Texte à envoyer').setMaxLength(2000).setRequired(true)).addAttachmentOption(o => o.setName('image').setDescription('Image à joindre (optionnel)').setRequired(false)).addStringOption(o => o.setName('boutons').setDescription('Boutons-liens : Texte|https://lien ; Texte2|https://lien2 (jusqu\'à 10, séparés par ;)').setRequired(false)),
  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const text = interaction.options.getString('texte');
    const image = interaction.options.getAttachment('image');
    const rawButtons = interaction.options.getString('boutons');

    // ── Validation (rien n'est envoyé si un bouton ou l'image est invalide) ──
    if (image && !(image.contentType || '').startsWith('image/')) {
      return interaction.reply({
        content: '❌ Le fichier joint doit être une image (png, jpg, gif, webp).',
        flags: MessageFlags.Ephemeral
      });
    }
    const { buttons, invalid, tooMany } = parseMessageButtons(rawButtons);
    if (invalid.length) {
      return interaction.reply({
        content: `❌ Bouton(s) n°${invalid.join(', ')} invalide(s). Format attendu : \`Texte|https://lien\` (séparés par \`;\`).`,
        flags: MessageFlags.Ephemeral
      });
    }
    if (tooMany) {
      return interaction.reply({
        content: `❌ Maximum ${MESSAGE_MAX_BUTTONS} boutons.`,
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    try {
      // Message classique (ni embed ni Components V2) : texte + image en pièce jointe + boutons-liens.
      // L'image est renvoyée par le bot (pas de dépendance au lien CDN de la commande).
      const payload = {
        content: text
      };
      if (image) {
        const ext = path.extname(new URL(image.url).pathname) || '.png';
        payload.files = [new AttachmentBuilder(image.url, {
          name: `message${ext}`
        })];
      }
      const rows = buildMessageButtonRows(buttons);
      if (rows.length) payload.components = rows;
      await channel.send(payload);
      await interaction.editReply({
        content: t(interaction.guild.id, 'message_sent', {
          channel: channel.toString()
        })
      });
    } catch (e) {
      console.error('[/message] Envoi impossible :', e.message);
      await interaction.editReply({
        content: `❌ Impossible d'envoyer le message dans ${channel} (permissions manquantes ou image trop lourde ?).`
      }).catch(() => { });
    }
  }
};
const premium = {
  data: new SlashCommandBuilder().setName('premium').setDescription('Liste des membres Premium (propriétaire)'),
  async execute(interaction) {
    if (interaction.guild) return interaction.reply({
      content: '❌ Commande réservée aux messages privés.',
      flags: MessageFlags.Ephemeral
    });
    if (interaction.user.id !== '1252736157285093397') return interaction.reply({
      content: '❌ Non autorisé.',
      flags: MessageFlags.Ephemeral
    });
    const users = store.premium.users || {};
    const lines = Object.entries(users).map(([id, entry]) => {
      const active = entry.active && (!entry.expires_at || new Date(entry.expires_at) > new Date());
      const expires = entry.expires_at ? formatDate(entry.expires_at) : 'Aucune date';
      return `• <@${id}> — ${active ? '✅ actif' : '❌ inactif'} — ${expires}`;
    });
    const embed = new EmbedBuilder().setTitle('⭐ Liste des membres Premium').setDescription(lines.length ? lines.join('\n') : 'Aucun membre premium enregistré.').setColor(0xFFFFFF);
    await interaction.reply(toCV2Payload({
      embeds: [embed]
    }));
  }
};
const langue = {
  data: new SlashCommandBuilder().setName('langue').setDescription('Changer la langue du bot sur ce serveur').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const cfg = getGuildConfig(interaction.guild.id);
    const currentInfo = LANGUAGES[cfg.language] || LANGUAGES.fr;
    const embed = new EmbedBuilder().setTitle(`🌐 ${t(interaction.guild.id, 'lang_select_placeholder')}`).setDescription(`**${t(interaction.guild.id, 'current_language')}**: ${currentInfo.flag} ${currentInfo.name}`).setColor(0xFFFFFF);
    const row = buildLanguageRow(interaction.guild.id);
    await interaction.reply(toCV2Payload({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    }));
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id && i.customId === 'welcome_language_select',
      time: 60000
    });
    collector.on('collect', async i => {
      const newLang = i.values[0];
      const gcfg = getGuildConfig(interaction.guild.id);
      gcfg.language = newLang;
      persist('config');
      const info = LANGUAGES[newLang];
      const confirmEmbed = new EmbedBuilder().setTitle(`✅ ${t(interaction.guild.id, 'lang_changed')}`).setDescription(`${info.flag} ${info.name}`).setColor(0xFFFFFF);
      await safeComponentUpdate(i, toCV2Payload({
        embeds: [confirmEmbed],
        components: []
      }));
    });
    collector.on('end', () => {
      interaction.editReply({
        components: []
      }).catch(() => { });
    });
  }
};
// ticket et langue ne sont plus enregistrées en top-level : absorbées dans /settings
// (leurs fonctions/objets restent utilisés en interne par le dispatcher de /settings).
module.exports = [setnick, resetnick, annonce, config, configPanneau, tempban, tempmute, unmute, timeout, untimeout, addrole, removerole, resetwarn, anniversaire, infractions, infraction_add, infractions_reset, message, premium];