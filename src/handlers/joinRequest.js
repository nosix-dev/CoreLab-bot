// ────────────────────────────────────────────────
// joinRequest.js — Candidatures d'arrivée (membre « en attente »)
// Quand quelqu'un rejoint un serveur qui utilise l'écran de validation Discord
// (membre « pending »), les membres ayant un des rôles choisis via /candidature
// reçoivent un MP avec les boutons ✅ Accepter / ❌ Refuser.
//
//  • Accepter : donne le rôle d'acceptation (optionnel) et prévient le candidat
//  • Refuser  : expulse le candidat et le prévient
//  • Dès qu'un destinataire répond, les MP des autres sont mis à jour
//
// Config (getGuildConfig) : join_request_enabled, join_request_role_ids[],
// join_request_accept_role_id
// ────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { verifierRole } = require('./autoRoleHandler');

const MAX_ROLES = 5;
const MAX_DESTINATAIRES = 25;
const PREFIX = 'cand_';

// Demandes en cours : "guildId:membreId" → { statut, messages: [{ userId, channelId, messageId }] }
const demandes = new Map();

function lireConfigCandidature(guildId) {
  const cfg = getGuildConfig(guildId);
  if (cfg.join_request_enabled === undefined) cfg.join_request_enabled = false;
  if (!Array.isArray(cfg.join_request_role_ids)) cfg.join_request_role_ids = [];
  if (cfg.join_request_accept_role_id === undefined) cfg.join_request_accept_role_id = null;
  return cfg;
}

function construireEmbed(membre, statut = null) {
  const user = membre.user;
  const embed = new EmbedBuilder()
    .setTitle(`📥 Nouvelle candidature — ${membre.guild.name}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '👤 Utilisateur', value: `${user.tag}\n\`${user.id}\``, inline: true },
      { name: '📅 Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '🚪 Arrivé', value: `<t:${Math.floor((membre.joinedTimestamp || Date.now()) / 1000)}:R>`, inline: true },
    )
    .setDescription(statut || '⏳ En attente de validation (règlement du serveur non accepté).')
    .setColor(statut ? (statut.startsWith('✅') ? 0x2ECC71 : 0xE74C3C) : 0xFFFFFF)
    .setTimestamp();
  return embed;
}

function construireBoutons(guildId, membreId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}ok_${guildId}_${membreId}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}no_${guildId}_${membreId}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
}

// Membres (non bots) qui possèdent un des rôles choisis.
async function trouverDestinataires(guild, roleIds) {
  await guild.members.fetch().catch(() => { });
  const ids = new Set();
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    for (const m of role.members.values()) {
      if (!m.user.bot) ids.add(m.id);
    }
  }
  return [...ids].slice(0, MAX_DESTINATAIRES);
}

async function notifierCandidature(membre) {
  if (membre.user.bot || !membre.pending) return;
  const guild = membre.guild;
  const cfg = lireConfigCandidature(guild.id);
  if (!cfg.join_request_enabled || !cfg.join_request_role_ids.length) return;

  const cle = `${guild.id}:${membre.id}`;
  if (demandes.has(cle)) return;
  const demande = { statut: 'attente', messages: [] };
  demandes.set(cle, demande);

  const destinataires = await trouverDestinataires(guild, cfg.join_request_role_ids);
  for (const userId of destinataires) {
    try {
      const user = await guild.client.users.fetch(userId);
      const msg = await user.send({
        embeds: [construireEmbed(membre)],
        components: [construireBoutons(guild.id, membre.id)],
      });
      demande.messages.push({ userId, channelId: msg.channelId, messageId: msg.id });
    } catch (e) {
      console.warn(`[Candidature] MP impossible pour ${userId} : ${e.message}`);
    }
  }
}

// Met à jour tous les MP d'une demande (sauf celui déjà géré par l'interaction).
async function mettreAJourMessages(client, demande, membre, statut, ignorerMessageId = null) {
  for (const ref of demande.messages) {
    if (ref.messageId === ignorerMessageId) continue;
    try {
      const canal = await client.channels.fetch(ref.channelId);
      const msg = await canal.messages.fetch(ref.messageId);
      await msg.edit({ embeds: [construireEmbed(membre, statut)], components: [] });
    } catch { /* MP supprimé ou fermé */ }
  }
}

async function routerInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return;
  const [, action, guildId, membreId] = interaction.customId.split('_');
  const client = interaction.client;
  const repondre = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return repondre('❌ Serveur introuvable.');

  // Le clic doit venir d'un destinataire (rôle choisi) ou d'un modérateur.
  const cfg = lireConfigCandidature(guildId);
  const clicker = await guild.members.fetch(interaction.user.id).catch(() => null);
  const autorise = clicker && (
    clicker.permissions.has(PermissionFlagsBits.ManageGuild)
    || cfg.join_request_role_ids.some(id => clicker.roles.cache.has(id))
  );
  if (!autorise) return repondre('❌ Tu n\'as plus le droit de traiter les candidatures de ce serveur.');

  const cle = `${guildId}:${membreId}`;
  const demande = demandes.get(cle) || { statut: 'attente', messages: [] };
  if (demande.statut !== 'attente') {
    return interaction.update({ components: [] }).catch(() => { });
  }

  const cible = await guild.members.fetch(membreId).catch(() => null);
  if (!cible) {
    demande.statut = 'parti';
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('📥 Candidature').setDescription('ℹ️ Le candidat a quitté le serveur.').setColor(0x95A5A6)],
      components: [],
    }).catch(() => { });
  }

  let statut;
  let notifCandidat;

  if (action === 'ok') {
    const roleId = cfg.join_request_accept_role_id;
    let infoRole = '';
    if (roleId) {
      const role = guild.roles.cache.get(roleId);
      const erreur = role ? verifierRole(guild, role) : 'Rôle introuvable.';
      if (erreur) {
        infoRole = ` (⚠️ rôle non donné : ${erreur.replace(/\*\*/g, '')})`;
      } else {
        await cible.roles.add(role, `Candidature acceptée par ${interaction.user.tag}`).catch(e => {
          infoRole = ` (⚠️ rôle non donné : ${e.message})`;
        });
      }
    }
    statut = `✅ Acceptée par **${interaction.user.tag}**${infoRole}`;
    notifCandidat = `✅ Ta candidature sur **${guild.name}** a été **acceptée**.`;
  } else if (action === 'no') {
    await cible.send(`❌ Ta candidature sur **${guild.name}** a été **refusée**.`).catch(() => { });
    try {
      await cible.kick(`Candidature refusée par ${interaction.user.tag}`);
      statut = `❌ Refusée par **${interaction.user.tag}** (candidat expulsé)`;
    } catch (e) {
      statut = `❌ Refusée par **${interaction.user.tag}** (⚠️ expulsion impossible : ${e.message})`;
    }
    notifCandidat = null;
  } else {
    return;
  }

  demande.statut = action === 'ok' ? 'accepte' : 'refuse';
  await interaction.update({ embeds: [construireEmbed(cible, statut)], components: [] }).catch(() => { });
  await mettreAJourMessages(client, demande, cible, statut, interaction.message?.id);
  if (notifCandidat) await cible.send(notifCandidat).catch(() => { });
  setTimeout(() => demandes.delete(cle), 24 * 60 * 60 * 1000).unref?.();
}

function registerJoinRequestHandler(client) {
  client.on('guildMemberAdd', (membre) => {
    notifierCandidature(membre).catch(e => console.error('[Candidature] guildMemberAdd :', e.message));
  });
  client.on('interactionCreate', (interaction) => {
    routerInteraction(interaction).catch(e => console.error('[Candidature] interaction :', e.message));
  });
}

module.exports = {
  registerJoinRequestHandler,
  lireConfigCandidature,
  MAX_ROLES,
};
