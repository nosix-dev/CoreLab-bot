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
  PermissionFlagsBits,
  AttachmentBuilder,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const {
  getGuildConfig,
  getGuildBucket,
  setGuildBucket,
  persist
} = require('../core/config');
const {
  buildSettingsPayload
} = require('../core/settingsCard');
const {
  generateStarboardCard
} = require('../core/starboardCard');
const {
  containerAccent
} = require('../core/cardTheme');

// ────────────────────────────────────────────────
// Système StarBoard générique et configurable
// (indépendant de l'ancien système "photo" codé en dur
// dans index.js — celui-ci fonctionne sur n'importe quel
// message, dans n'importe quel salon, avec un émoji et un
// seuil personnalisables par serveur).
// ────────────────────────────────────────────────

// ── Parsing / affichage de l'émoji ──
function parseEmojiInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const customMatch = trimmed.match(/^<a?:\w+:(\d+)>$/);
  if (customMatch) {
    return {
      raw: trimmed,
      id: customMatch[1]
    };
  }

  // Émoji unicode simple (rejette tout ce qui ressemble à du texte classique
  // ou à une mention/rôle/canal mal collée dans le champ).
  if (trimmed.length <= 8 && !/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return {
      raw: trimmed,
      id: null
    };
  }
  return null;
}
function reactionMatchesStarboard(reaction, cfg) {
  if (cfg.starboard_emoji_id) return String(reaction.emoji.id) === String(cfg.starboard_emoji_id);
  return reaction.emoji.name === cfg.starboard_emoji_raw;
}

// ── Dashboard ──
function buildStarboardDashboard(guild) {
  const cfg = getGuildConfig(guild.id);
  const on = v => v ? '🟢 Activé' : '🔴 Désactivé';
  const chan = id => id ? `<#${id}>` : '❌ Non configuré';
  const ignored = (cfg.starboard_ignored_channels || []).length ? cfg.starboard_ignored_channels.map(id => `<#${id}>`).join(', ') : 'Aucun';
  return new EmbedBuilder().setTitle('⭐ Panneau de configuration — StarBoard').setDescription('Configure ici le système de StarBoard : les messages qui reçoivent assez de réactions sont republiés dans un salon dédié.').setColor(0xFFFFFF).addFields({
    name: 'Statut',
    value: on(cfg.starboard_enabled),
    inline: true
  }, {
    name: 'Émoji',
    value: cfg.starboard_emoji_customized ? cfg.starboard_emoji_raw : '❤️ Par défaut (cœur)',
    inline: true
  }, {
    name: 'Seuil',
    value: `**${cfg.starboard_threshold}** réaction(s)`,
    inline: true
  }, {
    name: 'Salon de destination',
    value: chan(cfg.starboard_channel_id),
    inline: true
  }, {
    name: 'Auto-star (self-star)',
    value: on(cfg.starboard_allow_self_star),
    inline: true
  }, {
    name: 'Ignorer les salons NSFW',
    value: on(cfg.starboard_ignore_nsfw),
    inline: true
  }, {
    name: 'Retrait si sous le seuil',
    value: on(cfg.starboard_remove_on_unstar),
    inline: true
  }, {
    name: 'Salons ignorés',
    value: ignored,
    inline: false
  }).setFooter({
    text: 'CoreLab • StarBoard'
  });
}
function buildStarboardRows(guild) {
  const cfg = getGuildConfig(guild.id);
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('starboard_toggle_btn').setLabel(cfg.starboard_enabled ? '🟢 Activé' : '🔴 Désactivé').setStyle(cfg.starboard_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_emoji_btn').setLabel('✨ Émoji').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_emoji_reset_btn').setLabel('🔄 Réinitialiser').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_threshold_btn').setLabel('🔢 Seuil').setStyle(ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('starboard_channel_select').setPlaceholder('Choisis le salon de destination').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1));
  const row3 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('starboard_ignored_select').setPlaceholder('Choisis les salons à ignorer (optionnel)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(25));
  const row4 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('starboard_selfstar_btn').setLabel('🙋 Auto-star').setStyle(cfg.starboard_allow_self_star ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_nsfw_btn').setLabel('🔞 Ignorer NSFW').setStyle(cfg.starboard_ignore_nsfw ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_removeonunstar_btn').setLabel('🗑️ Retrait auto').setStyle(cfg.starboard_remove_on_unstar ? ButtonStyle.Success : ButtonStyle.Secondary));
  return [row1, row2, row3, row4];
}
// Panneau complet = carte image (comme /protect-settings) + boutons/menus, en Components V2.
// À utiliser partout à la place de { embeds:[buildStarboardDashboard()], components: buildStarboardRows() }.
function buildStarboardPayload(guild) {
  return buildSettingsPayload({
    guild,
    embed: buildStarboardDashboard(guild),
    rows: buildStarboardRows(guild),
    file: 'starboard.png',
    scale: 1,
    cols: 2
  });
}
async function refreshDashboard(interaction) {
  return interaction.update(buildStarboardPayload(interaction.guild));
}

// ── Boutons simples (toggle) ──
async function toggleStarboardEnabled(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  if (!cfg.starboard_channel_id) {
    return interaction.reply({
      content: '❌ Configure d\'abord un salon de destination avant d\'activer le StarBoard.',
      flags: MessageFlags.Ephemeral
    });
  }
  cfg.starboard_enabled = !cfg.starboard_enabled;
  persist('configuration');
  return refreshDashboard(interaction);
}
async function toggleSelfStar(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_allow_self_star = !cfg.starboard_allow_self_star;
  persist('configuration');
  return refreshDashboard(interaction);
}
async function toggleIgnoreNsfw(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_ignore_nsfw = !cfg.starboard_ignore_nsfw;
  persist('configuration');
  return refreshDashboard(interaction);
}
async function toggleRemoveOnUnstar(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_remove_on_unstar = !cfg.starboard_remove_on_unstar;
  persist('configuration');
  return refreshDashboard(interaction);
}
function isGuildOwner(interaction) {
  return interaction.user.id === interaction.guild.ownerId;
}

// ── Modals ──
async function openEmojiModal(interaction) {
  if (!isGuildOwner(interaction)) {
    return interaction.reply({
      content: '❌ Seul le fondateur du serveur peut changer l\'émoji du StarBoard.',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId('starboard_emoji_modal').setTitle('✨ Émoji du StarBoard');
  const input = new TextInputBuilder().setCustomId('emoji_value').setLabel('Émoji (unicode ou emoji perso)').setStyle(TextInputStyle.Short).setPlaceholder('⭐ ou colle un émoji personnalisé').setValue(cfg.starboard_emoji_raw || '⭐').setRequired(true).setMaxLength(64);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}
async function submitEmojiModal(interaction) {
  if (!isGuildOwner(interaction)) {
    return interaction.reply({
      content: '❌ Seul le fondateur du serveur peut changer l\'émoji du StarBoard.',
      flags: MessageFlags.Ephemeral
    });
  }
  const raw = interaction.fields.getTextInputValue('emoji_value');
  const parsed = parseEmojiInput(raw);
  if (!parsed) {
    return interaction.reply({
      content: '❌ Émoji invalide. Colle un émoji unicode (⭐) ou un émoji personnalisé du serveur.',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_emoji_raw = parsed.raw;
  cfg.starboard_emoji_id = parsed.id;
  cfg.starboard_emoji_customized = true;
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}
async function resetEmoji(interaction) {
  if (!isGuildOwner(interaction)) {
    return interaction.reply({
      content: '❌ Seul le fondateur du serveur peut changer l\'émoji du StarBoard.',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_emoji_raw = '⭐';
  cfg.starboard_emoji_id = null;
  cfg.starboard_emoji_customized = false;
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}
// ── Sélecteur d'émojis du serveur (liste paginée, 25 par page) ──
const EMOJI_PAGE_SIZE = 25;
function getSortedGuildEmojis(guild) {
  return [...guild.emojis.cache.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', {
    sensitivity: 'base'
  }));
}
function buildEmojiPickerPayload(guild, page = 0) {
  const cfg = getGuildConfig(guild.id);
  const emojis = getSortedGuildEmojis(guild);
  const totalPages = Math.max(1, Math.ceil(emojis.length / EMOJI_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = emojis.slice(p * EMOJI_PAGE_SIZE, (p + 1) * EMOJI_PAGE_SIZE);
  const current = cfg.starboard_emoji_customized ? cfg.starboard_emoji_raw : '❤️ Par défaut (cœur)';
  const select = new StringSelectMenuBuilder().setCustomId('starboard_emoji_pick').setPlaceholder(`Choisis un émoji du serveur (${emojis.length})`).setMinValues(1).setMaxValues(1).addOptions(slice.map(e => {
    const opt = {
      label: e.name.slice(0, 100),
      value: e.id,
      emoji: {
        id: e.id,
        name: e.name,
        animated: !!e.animated
      },
      default: String(cfg.starboard_emoji_id) === e.id
    };
    if (e.animated) opt.description = 'Émoji animé';
    return opt;
  }));
  const navRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`starboard_emoji_page_${p - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p <= 0), new ButtonBuilder().setCustomId('starboard_emoji_page_noop').setLabel(`${p + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId(`starboard_emoji_page_${p + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1), new ButtonBuilder().setCustomId('starboard_emoji_manual_btn').setLabel('⌨️ Unicode').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('starboard_emoji_back_btn').setLabel('↩️ Retour').setStyle(ButtonStyle.Primary));
  const container = new ContainerBuilder().setAccentColor(containerAccent(guild.id, 0xFFFFFF));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ✨ Émoji du StarBoard\nÉmoji actuel : ${current}\n\nChoisis un émoji du serveur dans la liste ci-dessous.\n-# ${emojis.length} émoji(s) sur le serveur • page ${p + 1}/${totalPages} • « ⌨️ Unicode » pour saisir un émoji classique`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select), navRow);
  return {
    components: [container],
    files: [],
    attachments: [],
    flags: MessageFlags.IsComponentsV2
  };
}
function ownerOnlyReply(interaction) {
  return interaction.reply({
    content: '❌ Seul le fondateur du serveur peut changer l\'émoji du StarBoard.',
    flags: MessageFlags.Ephemeral
  });
}
async function openEmojiPicker(interaction, page = 0) {
  if (!isGuildOwner(interaction)) return ownerOnlyReply(interaction);
  if (!interaction.guild.emojis.cache.size) await interaction.guild.emojis.fetch().catch(() => { });
  // Aucun émoji perso sur le serveur : on garde la saisie manuelle (unicode)
  if (!interaction.guild.emojis.cache.size) return openEmojiModal(interaction);
  return interaction.update(buildEmojiPickerPayload(interaction.guild, page));
}
async function pickServerEmoji(interaction) {
  if (!isGuildOwner(interaction)) return ownerOnlyReply(interaction);
  const emoji = interaction.guild.emojis.cache.get(interaction.values[0]);
  if (!emoji) {
    return interaction.reply({
      content: '❌ Cet émoji n\'existe plus sur le serveur.',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_emoji_raw = emoji.toString();
  cfg.starboard_emoji_id = emoji.id;
  cfg.starboard_emoji_customized = true;
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}
async function changeEmojiPage(interaction) {
  if (!isGuildOwner(interaction)) return ownerOnlyReply(interaction);
  const page = parseInt(interaction.customId.replace('starboard_emoji_page_', ''), 10);
  if (!Number.isInteger(page)) return interaction.deferUpdate().catch(() => { });
  return interaction.update(buildEmojiPickerPayload(interaction.guild, page));
}
async function openThresholdModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId('starboard_threshold_modal').setTitle('🔢 Seuil du StarBoard');
  const input = new TextInputBuilder().setCustomId('threshold_value').setLabel('Nombre de réactions requises').setStyle(TextInputStyle.Short).setValue(String(cfg.starboard_threshold || 3)).setRequired(true).setMaxLength(3);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}
async function submitThresholdModal(interaction) {
  const value = parseInt(interaction.fields.getTextInputValue('threshold_value'), 10);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    return interaction.reply({
      content: '❌ Seuil invalide (nombre entier entre 1 et 500).',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_threshold = value;
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}

// ── Select menus ──
async function saveStarboardChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_channel_id = interaction.values[0];
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}
async function saveIgnoredChannels(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.starboard_ignored_channels = interaction.values || [];
  persist('configuration');
  return interaction.update(buildStarboardPayload(interaction.guild));
}

// ── Construction du message republié ──
function buildStarboardEmbed(message) {
  const embed = new EmbedBuilder().setColor(0xFFFFFF).setFooter({
    text: `ID: ${message.id}`
  }).setTimestamp(message.createdAt);
  const image = message.attachments.find(a => a.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);
  return embed;
}
async function countEffectiveStars(reaction, cfg, authorId) {
  let users;
  try {
    users = await reaction.users.fetch();
  } catch (e) {
    return reaction.count || 0;
  }
  let count = 0;
  for (const [, u] of users) {
    if (u.bot) continue;
    if (!cfg.starboard_allow_self_star && u.id === authorId) continue;
    count++;
  }
  return count;
}
// Texte du message nettoyé (mentions lisibles, émojis perso → :nom:)
function cleanStarContent(message) {
  const t = message.cleanContent || message.content || '';
  return t.replace(/<a?:(\w+):\d+>/g, ':$1:').trim();
}

// Première image du message (pièce jointe, sinon image/miniature d'un embed)
function pickStarImageUrl(message) {
  const att = message.attachments?.find(a => a.contentType?.startsWith('image/'));
  if (att) return att.url;
  const emb = message.embeds?.find(e => e.image?.url || e.thumbnail?.url);
  return emb ? emb.image?.url || emb.thumbnail?.url : null;
}

// Carte verte StarBoard (null si la génération échoue → fallback sur l'ancien embed)
async function buildStarboardCardFile(message, cfg, count) {
  try {
    const buffer = await generateStarboardCard({
      guildId: message.guild?.id,
      author: message.member?.displayName || message.author?.globalName || message.author?.username || 'Inconnu',
      score: count,
      threshold: cfg.starboard_threshold,
      content: cleanStarContent(message),
      imageUrl: pickStarImageUrl(message)
    });
    return new AttachmentBuilder(buffer, {
      name: `starboard_${message.id}_${count}.png`
    });
  } catch (e) {
    console.error('Erreur de génération de la carte StarBoard :', e.message);
    return null;
  }
}
async function upsertStarboardPost(guild, cfg, message, count) {
  const channel = guild.channels.cache.get(String(cfg.starboard_channel_id));
  if (!channel?.isTextBased?.()) return;
  const bucket = getGuildBucket(guild.id, 'starboardMessages', {});
  const existing = bucket[message.id];

  // Score inchangé et déjà au nouveau format : rien à refaire
  if (existing && existing.count === count) return;
  const authorMention = message.member ? `<@${message.author.id}>` : message.author ? `@${message.author.username}` : 'Inconnu';
  const content = `${cfg.starboard_emoji_raw} **${count}** | sent by ${authorMention}`;
  const linkRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Jump to Message').setStyle(ButtonStyle.Link).setURL(message.url));
  const file = await buildStarboardCardFile(message, cfg, count);
  const payload = file ? {
    content,
    embeds: [],
    files: [file],
    components: [linkRow],
    allowedMentions: { parse: [] }
  } : {
    content,
    embeds: [buildStarboardEmbed(message)],
    components: [linkRow],
    allowedMentions: { parse: [] }
  };
  if (existing) {
    const starMsg = await channel.messages.fetch(existing.starboardMessageId).catch(() => null);
    if (starMsg) {
      // attachments: [] remplace l'ancienne image par la nouvelle carte
      const ok = await starMsg.edit({
        ...payload,
        attachments: []
      }).then(() => true).catch(() => false);
      if (ok) {
        existing.count = count;
        setGuildBucket(guild.id, 'starboardMessages', bucket);
      }
      return;
    }
  }
  const sent = await channel.send(payload).catch(() => null);
  if (sent) {
    bucket[message.id] = {
      starboardMessageId: sent.id,
      authorId: message.author?.id || null,
      channelId: message.channel.id,
      count
    };
    setGuildBucket(guild.id, 'starboardMessages', bucket);
  }
}
async function removeStarboardPost(guild, cfg, message) {
  const bucket = getGuildBucket(guild.id, 'starboardMessages', {});
  const existing = bucket[message.id];
  if (!existing) return;
  const channel = guild.channels.cache.get(String(cfg.starboard_channel_id));
  if (channel?.isTextBased?.()) {
    const starMsg = await channel.messages.fetch(existing.starboardMessageId).catch(() => null);
    if (starMsg) await starMsg.delete().catch(() => { });
  }
  delete bucket[message.id];
  setGuildBucket(guild.id, 'starboardMessages', bucket);
}

// ── Traitement d'un ajout/retrait de réaction ──
async function handleStarboardReactionChange(reaction, user) {
  try {
    if (user.bot) return;
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    let message = reaction.message;
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch {
        return;
      }
    }
    if (!message.guild) return;
    const guild = message.guild;
    const cfg = getGuildConfig(guild.id);
    if (!cfg.starboard_enabled || !cfg.starboard_channel_id) return;
    if (!reactionMatchesStarboard(reaction, cfg)) return;
    if (message.channel.id === String(cfg.starboard_channel_id)) return;
    if ((cfg.starboard_ignored_channels || []).includes(message.channel.id)) return;
    if (cfg.starboard_ignore_nsfw && message.channel.nsfw) return;
    const count = await countEffectiveStars(reaction, cfg, message.author?.id);
    if (count >= cfg.starboard_threshold) {
      await upsertStarboardPost(guild, cfg, message, count);
    } else if (cfg.starboard_remove_on_unstar) {
      await removeStarboardPost(guild, cfg, message);
    }
  } catch (e) {
    console.error('Erreur StarBoard :', e.message);
  }
}
function registerStarboardHandlers(client) {
  client.on('messageReactionAdd', (reaction, user) => {
    handleStarboardReactionChange(reaction, user);
  });
  client.on('messageReactionRemove', (reaction, user) => {
    handleStarboardReactionChange(reaction, user);
  });
}

// ── Routing des interactions ──
async function routeStarboardInteraction(interaction) {
  try {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ Réservé au staff (permission Gérer le serveur requise).',
        flags: MessageFlags.Ephemeral
      });
    }
    const id = interaction.customId || '';
    if (interaction.isButton()) {
      if (id === 'starboard_toggle_btn') return toggleStarboardEnabled(interaction);
      if (id === 'starboard_emoji_btn') return openEmojiPicker(interaction);
      if (id === 'starboard_emoji_manual_btn') return openEmojiModal(interaction);
      if (id === 'starboard_emoji_back_btn') return refreshDashboard(interaction);
      if (id.startsWith('starboard_emoji_page_')) return changeEmojiPage(interaction);
      if (id === 'starboard_emoji_reset_btn') return resetEmoji(interaction);
      if (id === 'starboard_threshold_btn') return openThresholdModal(interaction);
      if (id === 'starboard_selfstar_btn') return toggleSelfStar(interaction);
      if (id === 'starboard_nsfw_btn') return toggleIgnoreNsfw(interaction);
      if (id === 'starboard_removeonunstar_btn') return toggleRemoveOnUnstar(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (id === 'starboard_emoji_pick') return pickServerEmoji(interaction);
    }
    if (interaction.isChannelSelectMenu()) {
      if (id === 'starboard_channel_select') return saveStarboardChannel(interaction);
      if (id === 'starboard_ignored_select') return saveIgnoredChannels(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (id === 'starboard_emoji_modal') return submitEmojiModal(interaction);
      if (id === 'starboard_threshold_modal') return submitThresholdModal(interaction);
    }
  } catch (e) {
    console.error('Erreur routeStarboardInteraction :', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Une erreur est survenue.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
  }
}
module.exports = {
  registerStarboardHandlers,
  routeStarboardInteraction,
  buildStarboardDashboard,
  buildStarboardRows,
  buildStarboardPayload
};
