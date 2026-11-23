// src/core/dashboardSanction.js : sanctions lancées depuis le dashboard (dossier de signalement).
// Actions : warn, timeout, mute, kick, ban. Enregistrées dans l'historique (page Infractions / Sanctions),
// avec le nom du modérateur du dashboard. Retourne { ok } ou { error, reason }.

const { PermissionFlagsBits } = require('discord.js');
const sanctionsLog = require('./sanctionsLog');
const reports = require('./reports');

const ACTIONS = ['warn', 'timeout', 'mute', 'kick', 'ban'];
const PERM = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers
};
const LIBELLE = { warn: 'Avertissement', timeout: 'Timeout', mute: 'Mute', kick: 'Expulsion', ban: 'Bannissement' };
const MAX_TIMEOUT_MIN = 28 * 24 * 60;
const MAX_SUPPR_SEC = 7 * 24 * 3600;

const err = (error, reason) => ({ error, reason });

function dureeTexte(min) {
  if (min >= 1440) return `${Math.round(min / 1440)} j`;
  if (min >= 60) return `${Math.round(min / 60)} h`;
  return `${min} min`;
}

async function prevenirMembre(user, guild, action, raison, duree) {
  try {
    const verbe = { warn: 'avertissement', timeout: `mise en timeout (${duree})`, mute: 'mise en sourdine', kick: 'expulsion', ban: 'bannissement' }[action];
    await user.send(`Une sanction a été prise contre toi sur **${guild.name}** : ${verbe}.\nRaison : ${String(raison).slice(0, 500)}`);
  } catch { /* MP fermés */ }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {{id: string, username: string}} modo utilisateur du dashboard
 * @param {{member: string, action: string, reason?: string, minutes?: number, deleteSeconds?: number, resolve?: boolean}} body
 */
async function appliquer(guild, modo, body) {
  const action = String(body.action || '');
  if (!ACTIONS.includes(action)) return err('invalid', 'Action inconnue.');
  const uid = String(body.member || '').replace(/\D/g, '');
  if (!uid) return err('invalid', 'Membre invalide.');
  const raison = String(body.reason || '').trim().slice(0, 400) || 'Aucune raison';
  const me = guild.members.me;

  if (uid === guild.client.user.id) return err('invalid', 'Impossible de sanctionner le bot.');
  if (uid === String(guild.ownerId)) return err('invalid', 'Impossible de sanctionner le propriétaire du serveur.');
  if (uid === String(modo.id)) return err('invalid', 'Tu ne peux pas te sanctionner toi-même.');

  // Droits du modérateur sur le serveur (le dashboard demande déjà Administrateur ou Gérer le serveur)
  const acteur = guild.members.cache.get(String(modo.id)) || await guild.members.fetch(String(modo.id)).catch(() => null);
  if (!acteur) return err('forbidden', 'Tu dois être membre du serveur pour sanctionner.');
  const proprio = String(guild.ownerId) === acteur.id;
  if (!proprio && !acteur.permissions.has(PERM[action])) return err('forbidden', `Il te manque la permission nécessaire pour : ${LIBELLE[action].toLowerCase()}.`);
  if (!me?.permissions.has(PERM[action])) return err('bot_perm', `CoreLab n'a pas la permission nécessaire pour : ${LIBELLE[action].toLowerCase()}.`);

  const membre = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(() => null);
  if (!membre && action !== 'ban') return err('member_not_found', 'Ce membre a quitté le serveur : seul le bannissement est possible.');

  if (membre) {
    if (!proprio && acteur.roles.highest.comparePositionTo(membre.roles.highest) <= 0) return err('hierarchy', 'Ce membre a un rôle égal ou supérieur au tien.');
    if (action === 'kick' && !membre.kickable) return err('bot_hierarchy', 'CoreLab ne peut pas expulser ce membre (rôle trop haut).');
    if (action === 'ban' && !membre.bannable) return err('bot_hierarchy', 'CoreLab ne peut pas bannir ce membre (rôle trop haut).');
    if (action === 'timeout' && !membre.moderatable) return err('bot_hierarchy', 'CoreLab ne peut pas mettre ce membre en timeout (rôle trop haut).');
  }

  const raisonAudit = `Dashboard — ${modo.username} : ${raison}`.slice(0, 500);
  const cible = membre || { id: uid, username: null };
  let duree = '';

  try {
    if (action === 'warn') {
      const { store, persist } = require('./data');
      if (!store.warns[uid]) store.warns[uid] = [];
      store.warns[uid].push({ reason: raison, moderator: String(modo.id), date: new Date().toISOString(), guild_id: guild.id });
      persist('warns');
      require('./discipline').apresStrike(guild, uid, { reason: raison }).catch(() => {});
      if (membre) require('../handlers/logs').logWarn(guild, { target: membre.user, moderator: acteur.user, reason: raison }).catch(() => {});
      if (membre) await prevenirMembre(membre.user, guild, action, raison);
    } else if (action === 'timeout') {
      const min = Math.floor(Number(body.minutes));
      if (!Number.isFinite(min) || min < 1 || min > MAX_TIMEOUT_MIN) return err('invalid', 'Durée de timeout invalide (1 minute à 28 jours).');
      duree = dureeTexte(min);
      await prevenirMembre(membre.user, guild, action, raison, duree);
      await membre.timeout(min * 60 * 1000, raisonAudit);
      sanctionsLog.enregistrer(guild.id, { type: 'timeout', member: membre, moderator: acteur.user, reason: `${raison} (${duree})` });
    } else if (action === 'mute') {
      const { getGuildConfig } = require('./config');
      const role = guild.roles.cache.get(String(getGuildConfig(guild.id).mute_role || ''));
      if (!role) return err('no_mute_role', 'Aucun rôle de mute configuré sur ce serveur.');
      if (me.roles.highest.comparePositionTo(role) <= 0) return err('bot_hierarchy', 'Le rôle de mute est au-dessus du rôle de CoreLab.');
      if (membre.roles.cache.has(role.id)) return err('already', 'Ce membre est déjà en sourdine.');
      await membre.roles.add(role, raisonAudit);
      sanctionsLog.enregistrer(guild.id, { type: 'mute', member: membre, moderator: acteur.user, reason: raison });
      await prevenirMembre(membre.user, guild, action, raison);
    } else if (action === 'kick') {
      await prevenirMembre(membre.user, guild, action, raison);
      await membre.kick(raisonAudit);
      sanctionsLog.enregistrer(guild.id, { type: 'kick', member: membre, moderator: acteur.user, reason: raison });
    } else if (action === 'ban') {
      const sec = Math.min(MAX_SUPPR_SEC, Math.max(0, Math.floor(Number(body.deleteSeconds) || 0)));
      if (membre) await prevenirMembre(membre.user, guild, action, raison);
      await guild.members.ban(uid, { reason: raisonAudit, deleteMessageSeconds: sec });
      sanctionsLog.enregistrer(guild.id, { type: 'ban', member: cible, moderator: acteur.user, reason: raison });
    }
  } catch (e) {
    console.error(`[dashboardSanction] ${action} :`, e.message);
    return err('discord', 'Discord a refusé l\'action (permissions ou hiérarchie des rôles).');
  }

  // Traiter les signalements ouverts du membre dans la foulée (et prévenir les signaleurs)
  let traites = 0;
  if (body.resolve) {
    const ids = reports.idsOuvertsDuMembre(guild.id, uid);
    if (ids.length) {
      const r = reports.decider(guild.id, ids, 'resolve', { id: modo.id, name: modo.username });
      if (r.ok) {
        traites = r.count;
        require('./reportNotify').notifierSignaleurs(guild, 'resolve', r.decided).catch(() => {});
      }
    }
  }
  return { ok: true, action, label: LIBELLE[action], resolved: traites };
}

module.exports = { appliquer, ACTIONS };
