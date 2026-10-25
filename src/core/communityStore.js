'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Stockage des systèmes "communauté" : mini-jeux, social (mariage / amis /
// clans) et recherche de joueurs (LFG).
//
// Indépendant de data.js / constants.js : on n'a donc RIEN à modifier dans
// ces fichiers. Chaque système a son propre fichier JSON à la racine du bot
// (écritures asynchrones sérialisées via sauvegarderDonnees, donc pas de
// freeze de la boucle d'événements sur ton hébergement gratuit).
// ─────────────────────────────────────────────────────────────────────────

const { chargerDonnees, sauvegarderDonnees } = require('./data');
const { getGuildBucket, persist } = require('./config');

const FICHIERS = {
  jeux: 'community_games.json',
  social: 'community_social.json',
  lfg: 'community_lfg.json',
};

const donnees = {
  jeux: chargerDonnees(FICHIERS.jeux, {}),
  social: chargerDonnees(FICHIERS.social, {}),
  lfg: chargerDonnees(FICHIERS.lfg, {}),
};

// Sauvegarde différée : plusieurs modifications rapprochées = 1 seule écriture.
const timers = {};
function sauver(cle) {
  if (timers[cle]) return;
  timers[cle] = setTimeout(() => {
    timers[cle] = null;
    sauvegarderDonnees(FICHIERS[cle], donnees[cle]);
  }, 1500);
}

function guilde(cle, guildId, defaut) {
  const id = String(guildId);
  if (!donnees[cle][id]) donnees[cle][id] = defaut();
  return donnees[cle][id];
}

// ── Mini-jeux ───────────────────────────────────────────────────────────
function jeux(guildId) {
  const g = guilde('jeux', guildId, () => ({
    stats: {},            // userId -> { quizPoints, quizWins, penduWins, devineWins, motsCount }
    mots: {               // jeu des mots enchaînés (persistant, un salon par serveur)
      enabled: false,
      channelId: null,
      chain: 0,
      record: 0,
      lastWord: null,
      lastUserId: null,
      used: [],
    },
  }));
  if (!g.stats) g.stats = {};
  if (!g.mots) g.mots = { enabled: false, channelId: null, chain: 0, record: 0, lastWord: null, lastUserId: null, used: [] };
  return g;
}
function statsJoueur(guildId, userId) {
  const g = jeux(guildId);
  const uid = String(userId);
  if (!g.stats[uid]) g.stats[uid] = { quizPoints: 0, quizWins: 0, penduWins: 0, devineWins: 0, motsCount: 0 };
  return g.stats[uid];
}
function sauverJeux() { sauver('jeux'); }

// ── Social ──────────────────────────────────────────────────────────────
function social(guildId) {
  const g = guilde('social', guildId, () => ({
    couples: {},   // userId -> { partnerId, since }
    amis: {},      // userId -> [userId, ...]
    clans: {},     // clanId -> { ... }
    clanOf: {},    // userId -> clanId
    nextClanId: 1,
  }));
  if (!g.couples) g.couples = {};
  if (!g.amis) g.amis = {};
  if (!g.clans) g.clans = {};
  if (!g.clanOf) g.clanOf = {};
  if (!g.nextClanId) g.nextClanId = 1;
  return g;
}
function sauverSocial() { sauver('social'); }

// ── LFG ─────────────────────────────────────────────────────────────────
function lfg(guildId) {
  const g = guilde('lfg', guildId, () => ({
    channelId: null,
    pingRoleId: null,
    posts: {},     // postId -> { ... }
    nextId: 1,
  }));
  if (!g.posts) g.posts = {};
  if (!g.nextId) g.nextId = 1;
  return g;
}
function sauverLfg() { sauver('lfg'); }

// ── Économie (Scarabées 💠) ─────────────────────────────────────────────
// Même structure que src/commands/economy.js (bucket "economyData"), sans
// rien exporter de ce fichier. Si l'économie est désactivée sur le serveur,
// plus aucun gain/dépense n'est appliqué.
function ecoBucket(guildId) {
  const b = getGuildBucket(guildId, 'economyData', {
    settings: { enabled: true, currencyName: 'Scarabée', currencyEmoji: '💠' },
    accounts: {},
  });
  if (!b.settings) b.settings = { enabled: true, currencyName: 'Scarabée', currencyEmoji: '💠' };
  if (!b.accounts) b.accounts = {};
  return b;
}
function ecoActive(guildId) {
  return ecoBucket(guildId).settings.enabled !== false;
}
function ecoEmoji(guildId) {
  return ecoBucket(guildId).settings.currencyEmoji || '💠';
}
function ecoCompte(guildId, userId) {
  const b = ecoBucket(guildId);
  const uid = String(userId);
  if (!b.accounts[uid]) b.accounts[uid] = { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0, lastFish: 0 };
  return b.accounts[uid];
}
function ecoSolde(guildId, userId) {
  return Math.floor(ecoCompte(guildId, userId).wallet || 0);
}
function ecoAjouter(guildId, userId, montant) {
  if (!ecoActive(guildId) || !(montant > 0)) return false;
  const c = ecoCompte(guildId, userId);
  c.wallet = (c.wallet || 0) + Math.floor(montant);
  persist('economyData');
  return true;
}
function ecoRetirer(guildId, userId, montant) {
  if (!ecoActive(guildId)) return true; // économie off : gratuit
  const c = ecoCompte(guildId, userId);
  if ((c.wallet || 0) < montant) return false;
  c.wallet -= Math.floor(montant);
  persist('economyData');
  return true;
}

module.exports = {
  jeux, statsJoueur, sauverJeux,
  social, sauverSocial,
  lfg, sauverLfg,
  ecoActive, ecoEmoji, ecoSolde, ecoAjouter, ecoRetirer,
};
