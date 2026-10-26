'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  MessageFlags
} = require('discord.js');
const { getGuildConfig, persist } = require('../core/config');
const {
  TYPES_COMPTEURS,
  necessiteFetchMembres,
  calculerValeur,
  construireNomSalon
} = require('../core/serverStatsCounters');

// ────────────────────────────────────────────────
// /serverstats-setup — salons vocaux verrouillés dont le nom affiche une statistique
// du serveur (Membres, En ligne, Boosts...). Les noms sont ensuite mis à jour toutes les
// 10 min par src/tasks/serverStats.js (config : serverstats_enabled / _category_id / _counters).
// ────────────────────────────────────────────────

const CATEGORY_NAME = '📊 Statistiques';
const PANEL_TIMEOUT = 10 * 60 * 1000;

const data = new SlashCommandBuilder()
  .setName('serverstats-setup')
  .setDescription('Configurer les salons de statistiques du serveur (membres, en ligne, boosts...)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

function lockedOverwrites(guild) {
  return [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel],
    deny: [PermissionFlagsBits.Connect]
  }];
}

async function currentValue(guild, type) {
  if (necessiteFetchMembres([type])) await guild.members.fetch().catch(() => { });
  return calculerValeur(guild, type);
}

// Synchronise les salons avec la sélection (crée les manquants, supprime les retirés)
async function applySelection(guild, cfg, selected) {
  let category = cfg.serverstats_category_id ? guild.channels.cache.get(String(cfg.serverstats_category_id)) : null;
  if (!category && selected.size) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: lockedOverwrites(guild)
    });
    await category.setPosition(0).catch(() => { });
    cfg.serverstats_category_id = category.id;
  }

  const next = [];
  for (const c of cfg.serverstats_counters || []) {
    const ch = guild.channels.cache.get(String(c.channelId));
    if (selected.has(c.type) && ch) next.push(c);
    else if (ch) await ch.delete('ServerStats : compteur retiré').catch(() => { });
  }
  for (const type of Object.keys(TYPES_COMPTEURS)) {
    if (!selected.has(type) || next.some(c => c.type === type)) continue;
    const ch = await guild.channels.create({
      name: construireNomSalon(type, await currentValue(guild, type)),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: lockedOverwrites(guild)
    });
    next.push({ type, channelId: ch.id });
  }

  cfg.serverstats_counters = next;
  cfg.serverstats_enabled = next.length > 0;
  if (!next.length && category) {
    await category.delete('ServerStats : plus aucun compteur').catch(() => { });
    cfg.serverstats_category_id = null;
  }
  persist('config');
}

async function refreshNames(guild, cfg) {
  for (const c of cfg.serverstats_counters || []) {
    const ch = guild.channels.cache.get(String(c.channelId));
    if (!ch) continue;
    const name = construireNomSalon(c.type, await currentValue(guild, c.type));
    if (name && ch.name !== name) await ch.setName(name).catch(() => { });
  }
}

async function removeAll(guild, cfg) {
  for (const c of cfg.serverstats_counters || []) {
    await guild.channels.cache.get(String(c.channelId))?.delete('ServerStats : suppression').catch(() => { });
  }
  if (cfg.serverstats_category_id) {
    await guild.channels.cache.get(String(cfg.serverstats_category_id))?.delete('ServerStats : suppression').catch(() => { });
  }
  cfg.serverstats_counters = [];
  cfg.serverstats_category_id = null;
  cfg.serverstats_enabled = false;
  persist('config');
}

function buildPanel(guild, cfg, selected, confirmReset) {
  const lines = Object.entries(TYPES_COMPTEURS).map(([type, def]) => {
    const active = (cfg.serverstats_counters || []).find(c => c.type === type && guild.channels.cache.has(String(c.channelId)));
    const pending = selected.has(type);
    const state = active && pending ? '✅' : pending ? '🆕' : active ? '🗑️' : '▫️';
    return `${state} ${def.emoji} **${def.libelle}**${active ? ` — <#${active.channelId}>` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('📊 Statistiques du serveur')
    .setDescription(
      `Des salons vocaux verrouillés affichent une statistique, mise à jour toutes les 10 minutes.\n\n${lines.join('\n')}\n\n` +
      '-# ✅ actif • 🆕 sera créé • 🗑️ sera supprimé • Choisis les compteurs puis clique sur **Appliquer**.'
    )
    .setColor(0xFFFFFF);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ss_types')
    .setPlaceholder('Compteurs à afficher…')
    .setMinValues(0)
    .setMaxValues(Object.keys(TYPES_COMPTEURS).length)
    .addOptions(Object.entries(TYPES_COMPTEURS).map(([type, def]) => ({
      label: def.libelle,
      value: type,
      emoji: def.emoji,
      default: selected.has(type)
    })));

  const hasCounters = (cfg.serverstats_counters || []).length > 0;
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ss_apply').setLabel('Appliquer').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ss_refresh').setLabel('Rafraîchir').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(!hasCounters),
        new ButtonBuilder().setCustomId('ss_reset').setLabel(confirmReset ? 'Confirmer ?' : 'Tout supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!hasCounters)
      )
    ]
  };
}

async function execute(interaction) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: '❌ Commande utilisable uniquement sur un serveur.', ...ephemeral });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Il faut la permission **Administrateur**.', ...ephemeral });
  }
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ Il me faut la permission **Gérer les salons** pour créer les compteurs.', ...ephemeral });
  }

  const cfg = getGuildConfig(guild.id);
  const selected = new Set((cfg.serverstats_counters || []).map(c => c.type));
  let confirmReset = false;

  await interaction.reply({ ...buildPanel(guild, cfg, selected, confirmReset), ...ephemeral });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: PANEL_TIMEOUT });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: "❌ Ce panneau n'est pas le tien.", ...ephemeral }).catch(() => { });
    }
    try {
      if (i.customId !== 'ss_reset') confirmReset = false;

      if (i.customId === 'ss_types') {
        selected.clear();
        i.values.forEach(v => { if (TYPES_COMPTEURS[v]) selected.add(v); });
        return i.update(buildPanel(guild, cfg, selected, confirmReset));
      }
      if (i.customId === 'ss_apply') {
        await i.deferUpdate();
        await applySelection(guild, cfg, selected);
        return i.editReply(buildPanel(guild, cfg, selected, confirmReset));
      }
      if (i.customId === 'ss_refresh') {
        await i.deferUpdate();
        await refreshNames(guild, cfg);
        return i.editReply(buildPanel(guild, cfg, selected, confirmReset));
      }
      if (i.customId === 'ss_reset') {
        if (!confirmReset) {
          confirmReset = true;
          return i.update(buildPanel(guild, cfg, selected, confirmReset));
        }
        confirmReset = false;
        await i.deferUpdate();
        await removeAll(guild, cfg);
        selected.clear();
        return i.editReply(buildPanel(guild, cfg, selected, confirmReset));
      }
    } catch (e) {
      console.error('[ServerStatsSetup]', e);
      const msg = { content: `❌ Erreur : ${e.message}`, ...ephemeral };
      if (i.deferred || i.replied) i.followUp(msg).catch(() => { });
      else i.reply(msg).catch(() => { });
    }
  });
  collector.on('end', async () => {
    try { await interaction.editReply({ components: [] }); } catch { }
  });
}

module.exports = { data, execute };