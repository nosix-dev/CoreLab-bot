// src/handlers/networkAlerts.js
// Alertes réseau : les serveurs qui participent partagent leurs bans pour arnaque ou raid.
// Quand un compte banni ailleurs rejoint un serveur participant, son équipe est prévenue.
// CoreLab ne sanctionne JAMAIS automatiquement : l'équipe choisit (bannir, expulser, ignorer).
// Réglages : net_share_bans, net_receive_alerts. Le nom des serveurs n'est jamais partagé.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { getProtectionLogChannelId } = require('../core/protectionLog');
const store = require('../core/securityStore');

const KIND_LABEL = { scam: 'Arnaque', raid: 'Raid' };

async function onBanAdd(ban) {
  const cfg = getGuildConfig(ban.guild.id);
  if (!cfg.net_share_bans) return;
  let reason = ban.reason;
  if (reason === undefined || reason === null) {
    const full = await ban.fetch().catch(() => null);
    reason = full?.reason;
  }
  const kind = store.classifyBanReason(reason); // seuls les motifs arnaque / raid sont partagés
  if (kind) store.addNetBan(ban.user.id, ban.guild.id, kind);
}

function onBanRemove(ban) {
  // Un débannissement retire le signalement, même si le partage a été coupé depuis
  store.removeNetBan(ban.user.id, ban.guild.id);
}

async function onJoin(member) {
  if (member.user.bot) return;
  const guild = member.guild, cfg = getGuildConfig(guild.id);
  // Réciprocité : on ne reçoit que si on partage aussi ses propres bans
  if (!cfg.net_receive_alerts || !cfg.net_share_bans) return;
  const rep = store.networkReports(member.id, guild.id);
  if (!rep) return;
  const chId = getProtectionLogChannelId(cfg) || cfg.log_channel_id;
  const ch = chId ? guild.channels.cache.get(String(chId)) : null;
  if (!ch?.isTextBased?.()) return;

  const motifs = [rep.scam ? `${KIND_LABEL.scam} (${rep.scam})` : null, rep.raid ? `${KIND_LABEL.raid} (${rep.raid})` : null].filter(Boolean).join(' · ');
  const embed = new EmbedBuilder()
    .setTitle('🌐 Compte signalé par le réseau CoreLab')
    .setColor(rep.score >= 65 ? 0xed4245 : 0xe0a526)
    .setDescription(`${member} (**${member.user.username}**) vient de rejoindre le serveur et a été banni ailleurs.`)
    .addFields(
      { name: 'Motifs', value: motifs || '—', inline: true },
      { name: 'Serveurs ayant signalé', value: String(rep.servers), inline: true },
      { name: 'Score de confiance', value: `${rep.score} / 100`, inline: true },
      { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: 'Aucune sanction automatique : à vous de décider.' })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`na:ban:${member.id}`).setLabel('Bannir').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`na:kick:${member.id}`).setLabel('Expulser').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`na:ignore:${member.id}`).setLabel('Ignorer').setStyle(ButtonStyle.Success)
  );
  await ch.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => { });
}

async function onButton(interaction) {
  const [, action, userId] = interaction.customId.split(':');
  const need = action === 'ban' ? PermissionFlagsBits.BanMembers : action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ModerateMembers;
  if (!interaction.memberPermissions?.has(need) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Tu n’as pas la permission nécessaire pour cette action.', ephemeral: true });
  }
  const done = async text => interaction.update({ embeds: interaction.message.embeds, components: [], content: text, allowedMentions: { parse: [] } });
  try {
    if (action === 'ban') {
      await interaction.guild.members.ban(userId, { reason: `Alerte réseau CoreLab — par ${interaction.user.username}` });
      return done(`🔨 Banni par ${interaction.user.username}.`);
    }
    if (action === 'kick') {
      await interaction.guild.members.kick(userId, `Alerte réseau CoreLab — par ${interaction.user.username}`);
      return done(`👢 Expulsé par ${interaction.user.username}.`);
    }
    return done(`✅ Ignoré par ${interaction.user.username}.`);
  } catch (e) {
    return interaction.reply({ content: `Action impossible : ${e.message}`, ephemeral: true });
  }
}

function registerNetworkAlertsHandler(client) {
  const safe = (name, fn) => (...a) => Promise.resolve(fn(...a)).catch(e => console.error(`[NetAlerts] ${name} :`, e.message));
  client.on('guildBanAdd', safe('ban', onBanAdd));
  client.on('guildBanRemove', safe('unban', onBanRemove));
  client.on('guildMemberAdd', safe('join', onJoin));
  client.on('interactionCreate', i => {
    if (i.isButton?.() && i.customId.startsWith('na:')) safe('bouton', onButton)(i);
  });
}

module.exports = { registerNetworkAlertsHandler };
