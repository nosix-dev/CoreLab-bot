// ────────────────────────────────────────────────
// autoRoleHandler.js — Autorôle à l'arrivée
// Donne automatiquement un ou plusieurs rôles aux nouveaux membres
// (et, séparément, aux bots qui rejoignent le serveur).
//
//  • Rôles « membres » et rôles « bots » configurables séparément
//  • Délai optionnel avant l'attribution (0 à 3600 s)
//  • Option « attendre la validation du règlement » : si le serveur utilise
//    l'écran d'accueil Discord (membre « en attente »), le rôle n'est donné
//    qu'une fois le règlement accepté
//  • Suspendu pour les humains si le système d'authentification (/protect-settings)
//    est actif, pour ne pas contourner la vérification
//  • Sécurité : refuse les rôles gérés par une intégration, placés trop haut,
//    ou qui ont des permissions d'administration / de modération
//
// Config stockée dans getGuildConfig(guild.id) :
//   autorole_enabled, autorole_role_ids[], autorole_bot_role_ids[],
//   autorole_delay_seconds, autorole_wait_screening
// ────────────────────────────────────────────────

const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, persist } = require('../core/config');

const MAX_ROLES = 10;
const MAX_DELAI_SECONDES = 3600;

// Un rôle avec une de ces permissions ne peut jamais être donné automatiquement :
// une erreur de configuration donnerait les pleins pouvoirs à n'importe quel nouvel arrivant.
const PERMISSIONS_INTERDITES = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
];

// Membres dont l'attribution est en cours (évite un double traitement
// si guildMemberAdd et guildMemberUpdate arrivent presque en même temps).
const enCours = new Set();
// Anti-spam des avertissements console : un par serveur toutes les 10 minutes.
const dernierAvertissement = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function avertir(guild, message) {
  const maintenant = Date.now();
  if (maintenant - (dernierAvertissement.get(guild.id) || 0) < 10 * 60 * 1000) return;
  dernierAvertissement.set(guild.id, maintenant);
  console.warn(`[AutoRole] ${guild.name} (${guild.id}) : ${message}`);
}

// Retourne la config du serveur avec les valeurs par défaut de l'autorôle.
function lireConfigAutoRole(guildId) {
  const cfg = getGuildConfig(guildId);
  if (cfg.autorole_enabled === undefined) cfg.autorole_enabled = false;
  if (!Array.isArray(cfg.autorole_role_ids)) cfg.autorole_role_ids = [];
  if (!Array.isArray(cfg.autorole_bot_role_ids)) cfg.autorole_bot_role_ids = [];
  if (typeof cfg.autorole_delay_seconds !== 'number') cfg.autorole_delay_seconds = 0;
  if (cfg.autorole_wait_screening === undefined) cfg.autorole_wait_screening = true;
  return cfg;
}

// Vérifie qu'un rôle peut être utilisé comme autorôle.
// Retourne un message d'erreur (string) ou null si tout est bon.
// `executant` (GuildMember) : la personne qui configure — elle ne peut pas
// choisir un rôle plus haut que le sien (sauf propriétaire du serveur).
function verifierRole(guild, role, executant = null) {
  if (!role) return 'Rôle introuvable.';
  if (role.id === guild.id) return 'Le rôle @everyone ne peut pas être utilisé comme autorôle.';
  if (role.managed) return `Le rôle **${role.name}** est géré par une intégration (bot, boost…), je ne peux pas l'attribuer.`;

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Il me manque la permission **Gérer les rôles** sur ce serveur.';
  }
  if (role.position >= me.roles.highest.position) {
    return `Le rôle **${role.name}** est au-dessus (ou au même niveau que) mon rôle le plus haut. Remonte mon rôle dans la hiérarchie des rôles du serveur.`;
  }
  if (PERMISSIONS_INTERDITES.some(p => role.permissions.has(p))) {
    return `Par sécurité, le rôle **${role.name}** a des permissions d'administration / de modération : il ne peut pas être donné automatiquement.`;
  }
  if (executant && guild.ownerId !== executant.id && role.position >= executant.roles.highest.position) {
    return `Tu ne peux pas choisir le rôle **${role.name}** : il est au-dessus (ou au même niveau que) ton rôle le plus haut.`;
  }
  return null;
}

// Donne les rôles configurés à un membre qui vient d'arriver (ou de valider le règlement).
async function appliquerAutoRole(membre) {
  const guild = membre.guild;
  const cfg = lireConfigAutoRole(guild.id);
  if (!cfg.autorole_enabled) return;

  const estBot = !!membre.user?.bot;
  // Authentification active : on ne donne pas de rôle aux humains avant la vérification.
  if (!estBot && cfg.auth_enabled) return;

  const ids = [...(estBot ? cfg.autorole_bot_role_ids : cfg.autorole_role_ids)];
  if (!ids.length) return;

  // Membre « en attente » (écran d'accueil / règlement Discord) : on attend la validation.
  if (!estBot && membre.pending && cfg.autorole_wait_screening) return;

  const cle = `${guild.id}:${membre.id}`;
  if (enCours.has(cle)) return;
  enCours.add(cle);

  try {
    const delai = estBot ? 0 : Math.min(Math.max(cfg.autorole_delay_seconds || 0, 0), MAX_DELAI_SECONDES);
    if (delai > 0) {
      await sleep(delai * 1000);
      // Le membre a pu partir entre-temps.
      membre = await guild.members.fetch(membre.id).catch(() => null);
      if (!membre) return;
      if (!estBot && membre.pending && cfg.autorole_wait_screening) return;
    }

    const aDonner = [];
    const idsValides = [];
    for (const id of ids) {
      const role = guild.roles.cache.get(id);
      if (!role) continue; // rôle supprimé : nettoyé plus bas
      idsValides.push(id);
      const erreur = verifierRole(guild, role);
      if (erreur) { avertir(guild, erreur.replace(/\*\*/g, '')); continue; }
      if (!membre.roles.cache.has(id)) aDonner.push(role);
    }

    // Nettoyage des rôles supprimés du serveur.
    if (idsValides.length !== ids.length) {
      const cleListe = estBot ? 'autorole_bot_role_ids' : 'autorole_role_ids';
      cfg[cleListe] = cfg[cleListe].filter(id => guild.roles.cache.has(id));
      persist('configuration');
    }

    // Un par un (PUT /roles/:id) : on évite le « set » global de discord.js qui
    // pourrait écraser un rôle ajouté au même moment par un autre module.
    for (const role of aDonner) {
      await membre.roles.add(role, 'Autorôle à l\'arrivée').catch(e => {
        avertir(guild, `impossible de donner « ${role.name} » à ${membre.user.tag} : ${e.message}`);
      });
    }
  } finally {
    enCours.delete(cle);
  }
}

function registerAutoRoleHandler(client) {
  client.on('guildMemberAdd', (membre) => {
    appliquerAutoRole(membre).catch(e => console.error('[AutoRole] guildMemberAdd :', e.message));
  });

  // Membre « en attente » qui vient d'accepter le règlement de l'écran d'accueil.
  client.on('guildMemberUpdate', (ancien, nouveau) => {
    if (ancien.pending === true && nouveau.pending === false) {
      appliquerAutoRole(nouveau).catch(e => console.error('[AutoRole] guildMemberUpdate :', e.message));
    }
  });
}

module.exports = {
  registerAutoRoleHandler,
  appliquerAutoRole,
  lireConfigAutoRole,
  verifierRole,
  MAX_ROLES,
  MAX_DELAI_SECONDES,
};
