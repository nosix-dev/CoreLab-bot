// ────────────────────────────────────────────────
// boostHandler.js — Boosts du serveur
//  • Remercie un membre quand il booste le serveur (boost_enabled)
//  • Annonce chaque nouveau niveau de boost du serveur (boost_levelup_enabled)
//  • Donne / retire un rôle « booster » personnalisé (boost_role_id)
//
// Config (getGuildConfig(guild.id)), réglée depuis le dashboard › Bienvenue & départs :
//   boost_enabled, boost_channel_id, boost_title, boost_message,
//   boost_levelup_enabled (défaut : activé), boost_levelup_message, boost_role_id
//
// Variables : {user.mention} {user.name} {user.id} {server.name} {server.member_count}
//             {boost_count} {boost_level}
// ────────────────────────────────────────────────

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { verifierRole } = require('./autoRoleHandler');

const COULEUR_BOOST = 0xF47FFF;
const TITRE_DEFAUT = 'Serveur boosté !';
const MESSAGE_DEFAUT = 'Merci {user.mention} d’avoir boosté **{server.name}** ! Nous en sommes à **{boost_count}** boosts (niveau {boost_level}).';
const MESSAGE_NIVEAU_DEFAUT = '**{server.name}** a débloqué le **niveau {boost_level}** avec **{boost_count}** boosts ! Merci à tous nos boosters.';

// Anti-doublon : un même membre ne déclenche qu'un remerciement par minute.
const recents = new Map();
// Anti-spam des avertissements console : un par serveur toutes les 10 minutes.
const dernierAvertissement = new Map();

function avertir(guild, message) {
  const maintenant = Date.now();
  if (maintenant - (dernierAvertissement.get(guild.id) || 0) < 10 * 60 * 1000) return;
  dernierAvertissement.set(guild.id, maintenant);
  console.warn(`[Boost] ${guild.name} (${guild.id}) : ${message}`);
}

// Remplace les variables. mentionAsName=true pour un titre : Discord n'affiche jamais
// un ping cliquable dans un titre, on y met donc le pseudo.
function remplacer(texte, guild, membre, { mentionAsName = false } = {}) {
  const user = membre?.user;
  return String(texte || '')
    .replace(/\{user\.mention\}/g, user ? (mentionAsName ? user.username : user.toString()) : '')
    .replace(/\{user\.name\}/g, user ? user.username : '')
    .replace(/\{user\.id\}/g, user ? user.id : '')
    .replace(/\{server\.name\}/g, guild.name)
    .replace(/\{server\.member_count\}/g, String(guild.memberCount))
    .replace(/\{boost_count\}/g, String(guild.premiumSubscriptionCount ?? 0))
    .replace(/\{boost_level\}/g, String(guild.premiumTier ?? 0));
}

function salonDeBoost(guild, cfg) {
  const id = cfg.boost_channel_id;
  if (!id) return null;
  const salon = guild.channels.cache.get(String(id));
  if (!salon?.isTextBased?.()) return null;
  const perms = guild.members.me ? salon.permissionsFor(guild.members.me) : null;
  if (!perms || !perms.has(['ViewChannel', 'SendMessages'])) return null;
  return salon;
}

function construireMessage({ titre, description, avatarUrl }) {
  const separator = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const container = new ContainerBuilder().setAccentColor(COULEUR_BOOST);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${titre}`.slice(0, 300)));
  container.addSeparatorComponents(separator());
  const texte = new TextDisplayBuilder().setContent(description.slice(0, 1900));
  if (avatarUrl) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(texte).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );
  } else {
    container.addTextDisplayComponents(texte);
  }
  return container;
}

// Un membre vient de booster : remerciement + rôle booster.
async function membreABooste(membre) {
  const guild = membre.guild;
  const cfg = getGuildConfig(guild.id);

  // Rôle des boosters (indépendant du remerciement)
  if (cfg.boost_role_id) {
    const role = guild.roles.cache.get(String(cfg.boost_role_id));
    if (role) {
      const erreur = verifierRole(guild, role);
      if (erreur) avertir(guild, erreur.replace(/\*\*/g, ''));
      else if (!membre.roles.cache.has(role.id)) {
        await membre.roles.add(role, 'Rôle des boosters').catch(e => avertir(guild, `impossible de donner « ${role.name} » : ${e.message}`));
      }
    }
  }

  if (cfg.boost_enabled !== true) return;
  const salon = salonDeBoost(guild, cfg);
  if (!salon) return;

  const cle = `${guild.id}:${membre.id}`;
  if (Date.now() - (recents.get(cle) || 0) < 60 * 1000) return;
  recents.set(cle, Date.now());

  const titre = remplacer((cfg.boost_title || '').trim() || TITRE_DEFAUT, guild, membre, { mentionAsName: true });
  const description = remplacer((cfg.boost_message || '').trim() || MESSAGE_DEFAUT, guild, membre);
  const container = construireMessage({
    titre,
    description,
    avatarUrl: membre.displayAvatarURL({ extension: 'png', size: 256 }),
  });
  await salon.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [membre.id] },
  });
}

// Un membre n'est plus booster : on retire le rôle des boosters.
async function membreAArreteDeBooster(membre) {
  const guild = membre.guild;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.boost_role_id) return;
  const role = guild.roles.cache.get(String(cfg.boost_role_id));
  if (!role || !membre.roles.cache.has(role.id)) return;
  await membre.roles.remove(role, 'Plus booster').catch(e => avertir(guild, `impossible de retirer « ${role.name} » : ${e.message}`));
}

// Le serveur vient de passer à un niveau de boost supérieur.
async function niveauAtteint(guild) {
  const cfg = getGuildConfig(guild.id);
  if (cfg.boost_levelup_enabled === false) return;
  const salon = salonDeBoost(guild, cfg);
  if (!salon) return;

  const description = remplacer((cfg.boost_levelup_message || '').trim() || MESSAGE_NIVEAU_DEFAUT, guild, null);
  const container = construireMessage({
    titre: `🚀 Niveau ${guild.premiumTier} débloqué !`,
    description,
    avatarUrl: guild.iconURL({ extension: 'png', size: 256 }),
  });
  await salon.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

function registerBoostHandler(client) {
  client.on('guildMemberUpdate', (ancien, nouveau) => {
    // Membre non mis en cache : impossible de savoir s'il y a eu un changement de boost.
    if (ancien.partial) return;
    const avant = !!ancien.premiumSinceTimestamp;
    const apres = !!nouveau.premiumSinceTimestamp;
    if (avant === apres) return;
    const tache = apres ? membreABooste(nouveau) : membreAArreteDeBooster(nouveau);
    tache.catch(e => console.error('[Boost] guildMemberUpdate :', e.message));
  });

  client.on('guildUpdate', (ancien, nouveau) => {
    if ((nouveau.premiumTier ?? 0) <= (ancien.premiumTier ?? 0)) return;
    niveauAtteint(nouveau).catch(e => console.error('[Boost] guildUpdate :', e.message));
  });

  console.log('✅ Système de boosts (remerciements, niveaux, rôle booster) initialisé.');
}

module.exports = { registerBoostHandler };
