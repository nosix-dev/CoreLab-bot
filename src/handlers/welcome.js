const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AuditLogEvent,
  AttachmentBuilder
} = require('discord.js');
const path = require('path');
const {
  getGuildConfig
} = require('../core/config');
const {
  persist
} = require('../core/data');
const {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  t
} = require('../core/i18n');
const {
  toCV2Payload
} = require("../core/componentsV2");
const CHEMIN_BANNIERE = path.join(__dirname, '..', '..', 'assets', 'scarabot_banner.gif');
const NOM_FICHIER_BANNIERE = 'scarabot_banner.gif';
function formatUptime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms % 3600000 / 60000);
  return `${hours}h ${minutes}m`;
}

// ────────────────────────────────────────────────
// Essaie de trouver qui a invité le bot (recherche dans les logs d'audit,
// même schéma que la notification DM sur guildCreate dans logs.js)
// ────────────────────────────────────────────────
async function findInviter(guild, client) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 5
    });
    const entry = auditLogs.entries.find(e => e.target?.id === client.user.id);
    return entry?.executor ?? null;
  } catch {
    return null; // permission de logs d'audit manquante, ou logs expirés
  }
}

// ────────────────────────────────────────────────
// Construction de l'embed / des composants
// ────────────────────────────────────────────────
function buildWelcomeEmbed(guild, client, inviter, { dm = false, destinataire = null } = {}) {
  const embed = new EmbedBuilder().setColor(0xFFFFFF).setAuthor({
    name: client.user.username,
    iconURL: client.user.displayAvatarURL()
  }).setTitle(t(guild.id, 'welcome_title')).setDescription(`${t(guild.id, 'welcome_greeting', {
    guild: (dm ? (destinataire ?? inviter) : inviter)?.username ?? guild.name
  })}\n\n` + `${t(guild.id, 'welcome_intro', {
    count: client.guilds.cache.size
  })}\n\n` + `${t(guild.id, 'welcome_lang_info')}\n\n` + `${t(guild.id, 'welcome_help_info')}`).addFields({
    name: t(guild.id, 'stats_title'),
    value: `\`\`\`ini\n${t(guild.id, 'stats_servers')} : ${client.guilds.cache.size}\n${t(guild.id, 'stats_uptime')} : ${formatUptime(client.uptime)}\n${t(guild.id, 'stats_members')} : ${guild.memberCount}\n\`\`\``,
    inline: false
  }).setThumbnail(client.user.displayAvatarURL({
    size: 256
  })).setImage(`attachment://${NOM_FICHIER_BANNIERE}`).setTimestamp();
  const footerText = inviter ? (dm ? `${t(guild.id, 'added_by')} ${inviter.username} • ${guild.name}` : `${t(guild.id, 'added_by')} ${inviter.username}`) : guild.name;
  embed.setFooter({
    text: footerText,
    iconURL: guild.iconURL() || undefined
  });
  return embed;
}
function buildLanguageRow(guildId) {
  const select = new StringSelectMenuBuilder().setCustomId('welcome_language_select').setPlaceholder(t(guildId, 'lang_select_placeholder')).addOptions(Object.entries(LANGUAGES).map(([code, info]) => new StringSelectMenuOptionBuilder().setLabel(info.name).setEmoji(info.flag).setValue(code)));
  return new ActionRowBuilder().addComponents(select);
}
function buildDeleteRow(guildId) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('welcome_delete_msg').setLabel(t(guildId, 'delete_button')).setEmoji('🗑️').setStyle(ButtonStyle.Danger), new ButtonBuilder().setLabel(t(guildId, 'support_button')).setEmoji('🛠️').setStyle(ButtonStyle.Link).setURL('https://discord.gg/WecpyxrSBT') // ← remplace par ton URL de serveur support
  );
}

// ────────────────────────────────────────────────
// Trouve le premier salon dans lequel le bot peut réellement écrire
// (salon système en premier, puis le salon texte le plus haut auquel il a accès)
// ────────────────────────────────────────────────
function findWelcomeChannel(guild) {
  const me = guild.members.me;
  if (guild.systemChannel && guild.systemChannel.permissionsFor(me)?.has(['SendMessages', 'ViewChannel'])) {
    return guild.systemChannel;
  }
  return guild.channels.cache.filter(c => c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(['SendMessages', 'ViewChannel'])).sort((a, b) => a.position - b.position).first();
}

// ────────────────────────────────────────────────
// Enregistrement de l'évènement guildCreate
// ────────────────────────────────────────────────
// Embed simple envoyé en MP à la personne qui a ajouté le bot
function buildWelcomeDmEmbed(guild, client, inviter, destinataire) {
  const nom = (destinataire ?? inviter)?.username ?? guild.name;
  const footerText = inviter
    ? `${t(guild.id, 'added_by')} ${inviter.username} • ${guild.name}`
    : guild.name;
  return new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(t(guild.id, 'welcome_title'))
    .setDescription(`${t(guild.id, 'welcome_greeting', { guild: nom })}\n\n${t(guild.id, 'welcome_help_info')}`)
    .setFooter({ text: footerText, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
}

// Les logs d'audit mettent parfois quelques secondes à apparaître après l'ajout du bot
async function findInviterAvecRetry(guild, client) {
  let inviter = await findInviter(guild, client);
  if (!inviter) {
    await new Promise(r => setTimeout(r, 2500));
    inviter = await findInviter(guild, client);
  }
  return inviter;
}

function registerWelcomeHandler(client) {
  client.on('guildCreate', async guild => {
    try {
      const cfg = getGuildConfig(guild.id);
      // La langue démarre toujours en anglais ; les admins peuvent la changer via le menu.
      // On ne la définit ici que si elle n'a jamais été configurée, pour que les
      // réinvitations (kick + re-add) gardent la langue déjà choisie.
      if (!cfg.language) {
        cfg.language = DEFAULT_LANGUAGE;
        persist('config');
      }

      // Destinataires par ordre de priorité : la personne qui a ajouté le bot, puis le propriétaire du serveur.
      // Le message n'est JAMAIS posté dans un salon du serveur : uniquement en MP.
      const inviter = await findInviterAvecRetry(guild, client);
      const owner = await guild.fetchOwner().then(m => m.user).catch(() => null);
      const candidats = [inviter, owner].filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);
      if (!candidats.length) return;

      let msg = null;
      let destinataire = null;
      for (const user of candidats) {
        try {
          msg = await user.send({
            embeds: [buildWelcomeDmEmbed(guild, client, inviter, user)],
            components: [buildDeleteRow(guild.id)]
          });
          destinataire = user;
          break;
        } catch (e) {
          // MP fermés (50007) : on essaie le destinataire suivant
          if (e?.code !== 50007) console.error('MP de bienvenue (ajout du bot) non envoyé :', e.message);
        }
      }
      if (!msg) return;

      const collector = msg.createMessageComponentCollector({
        time: 2 * 60 * 60 * 1000 // 2 heures (en MP, la personne lit rarement tout de suite)
      });

      collector.on('collect', async i => {
        try {
          // En MP, seul le destinataire peut interagir
          if (i.user.id !== destinataire.id) return;
          if (i.customId === 'welcome_delete_msg') {
            await i.message.delete().catch(() => {});
          }
        } catch (e) {
          console.error('Erreur d\'interaction sur le message de bienvenue :', e.message);
        }
      });
      collector.on('end', () => {
        msg.edit({ components: [] }).catch(() => {});
      });
    } catch (e) {
      console.error('Erreur guildCreate (message de bienvenue) :', e);
    }
  });
  console.log('✅ Message de bienvenue serveur (guildCreate, envoyé en MP) initialisé.');
}
module.exports = {
  registerWelcomeHandler,
  buildWelcomeEmbed,
  buildLanguageRow,
  buildDeleteRow
};