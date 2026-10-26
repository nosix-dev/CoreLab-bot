'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Stockage de la réputation (/reputation).
// Fichier JSON dédié à la racine du bot : community_reputation.json
// (écritures asynchrones sérialisées via sauvegarderDonnees → pas de freeze).
//   guildId -> {
//     users:     { userId: { rep, donnees } },   // rep reçue / rep donnée
//     cooldowns: { giverId: timestamp du dernier +1 donné }
//   }
// ─────────────────────────────────────────────────────────────────────────

const { chargerDonnees, sauvegarderDonnees } = require('./data');

const FICHIER = 'community_reputation.json';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 rep par jour et par donneur

const donnees = chargerDonnees(FICHIER, {});

// Sauvegarde différée : plusieurs modifications rapprochées = 1 seule écriture.
let timer = null;
function sauver() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    sauvegarderDonnees(FICHIER, donnees);
  }, 1500);
}

function guilde(guildId) {
  const id = String(guildId);
  if (!donnees[id]) donnees[id] = { users: {}, cooldowns: {} };
  if (!donnees[id].users) donnees[id].users = {};
  if (!donnees[id].cooldowns) donnees[id].cooldowns = {};
  return donnees[id];
}

function profil(guildId, userId) {
  const g = guilde(guildId);
  const uid = String(userId);
  if (!g.users[uid]) g.users[uid] = { rep: 0, donnees: 0 };
  return g.users[uid];
}

/** Millisecondes restantes avant que `giverId` puisse redonner de la rep (0 = disponible). */
function cooldownRestant(guildId, giverId) {
  const dernier = guilde(guildId).cooldowns[String(giverId)] || 0;
  return Math.max(0, dernier + COOLDOWN_MS - Date.now());
}

/** Donne +1 rep. Le contrôle du cooldown est fait avant par l'appelant. */
function donner(guildId, giverId, targetId) {
  const g = guilde(guildId);
  const cible = profil(guildId, targetId);
  const donneur = profil(guildId, giverId);
  cible.rep += 1;
  donneur.donnees += 1;
  g.cooldowns[String(giverId)] = Date.now();
  sauver();
  return cible.rep;
}

function repDe(guildId, userId) {
  return guilde(guildId).users[String(userId)]?.rep || 0;
}

/** Classement trié par rep décroissante : [[userId, rep], ...] (rep > 0 uniquement). */
function classement(guildId) {
  return Object.entries(guilde(guildId).users)
    .map(([uid, p]) => [uid, p.rep || 0])
    .filter(([, rep]) => rep > 0)
    .sort((a, b) => b[1] - a[1]);
}

module.exports = { COOLDOWN_MS, profil, cooldownRestant, donner, repDe, classement };
