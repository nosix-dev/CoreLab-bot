'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Cœur des systèmes "cartes Pokémon" : combats PvP et marché / enchères.
//
//  - Accès à l'inventaire et au porte-monnaie de /economy (même bucket
//    "economyData" que src/commands/economy.js → rien à modifier là-bas)
//  - Statistiques de combat d'une carte, calculées à partir de sa rareté
//    (+ une petite variation fixe par Pokémon : la même carte a toujours les
//    mêmes stats)
//  - Stockage : pokemon_combat.json (classement + mises en séquestre) et
//    pokemon_marche.json (annonces et enchères en cours)
// ─────────────────────────────────────────────────────────────────────────

const { getGuildBucket, persist } = require('./config');
const { chargerDonnees, sauvegarderDonnees } = require('./data');
const { getItem, getRarity } = require('./collectionItems');

// ── Économie (même structure que economy.js) ────────────────────────────
const ecoDefaut = () => ({
  settings: { enabled: true, currencyName: 'Scarabée', currencyEmoji: '💠' },
  accounts: {},
});

function bucket(guildId) {
  const b = getGuildBucket(guildId, 'economyData', ecoDefaut());
  if (!b.settings) b.settings = ecoDefaut().settings;
  if (!b.accounts) b.accounts = {};
  return b;
}

function compte(guildId, userId) {
  const b = bucket(guildId);
  const uid = String(userId);
  if (!b.accounts[uid]) {
    b.accounts[uid] = { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0, lastFish: 0, lastSpin: 0, inventory: {} };
  }
  const c = b.accounts[uid];
  if (!c.inventory || typeof c.inventory !== 'object') c.inventory = {};
  return c;
}

const ecoActive = guildId => bucket(guildId).settings.enabled !== false;
const emoji = guildId => bucket(guildId).settings.currencyEmoji || '💠';
const solde = (guildId, userId) => Math.floor(compte(guildId, userId).wallet || 0);
const sauverEco = () => persist('economyData');

function fmt(guildId, n) {
  return `${Math.floor(n).toLocaleString('fr-FR')} ${emoji(guildId)}`;
}

// Retire de l'argent (false si le solde est insuffisant). Ne sauvegarde pas : appeler sauverEco().
function debiter(guildId, userId, montant) {
  const c = compte(guildId, userId);
  montant = Math.floor(montant);
  if (!(montant >= 0) || (c.wallet || 0) < montant) return false;
  c.wallet = (c.wallet || 0) - montant;
  return true;
}

function crediter(guildId, userId, montant) {
  const c = compte(guildId, userId);
  c.wallet = (c.wallet || 0) + Math.max(0, Math.floor(montant));
}

// ── Inventaire ──────────────────────────────────────────────────────────
function nbCartes(guildId, userId, itemId) {
  return compte(guildId, userId).inventory[itemId] || 0;
}

function donnerCarte(guildId, userId, itemId, qte = 1) {
  const inv = compte(guildId, userId).inventory;
  inv[itemId] = (inv[itemId] || 0) + qte;
}

function retirerCarte(guildId, userId, itemId, qte = 1) {
  const inv = compte(guildId, userId).inventory;
  if ((inv[itemId] || 0) < qte) return false;
  inv[itemId] -= qte;
  if (inv[itemId] <= 0) delete inv[itemId];
  return true;
}

// Cartes possédées, des plus fortes aux plus faibles : [{ item, count }]
function cartesPossedees(guildId, userId) {
  return Object.entries(compte(guildId, userId).inventory)
    .map(([id, count]) => ({ item: getItem(id), count }))
    .filter(e => e.item && e.count > 0)
    .sort((a, b) =>
      getRarity(b.item.rarity).order - getRarity(a.item.rarity).order
      || puissance(b.item) - puissance(a.item)
      || a.item.name.localeCompare(b.item.name, 'fr'));
}

// ── Statistiques de combat ──────────────────────────────────────────────
const BASE = {
  commun:     { pv: 60,  atk: 12, def: 8,  vit: 10 },
  peu_commun: { pv: 70,  atk: 15, def: 10, vit: 12 },
  rare:       { pv: 85,  atk: 19, def: 13, vit: 15 },
  epique:     { pv: 100, atk: 24, def: 17, vit: 19 },
  legendaire: { pv: 125, atk: 30, def: 22, vit: 24 },
  mythique:   { pv: 150, atk: 36, def: 27, vit: 30 },
};

const ATTAQUES_SPECIALES = [
  'Lance-Flammes', 'Hydrocanon', 'Tonnerre', 'Fouet Lianes', 'Psyko', 'Ombre Nocturne',
  'Poing Météore', 'Éclat Lunaire', 'Vibrobscur', 'Séisme', 'Vol-Vie', 'Ultralaser',
  'Danse-Lames', 'Tempête de Sable', 'Draco-Rage', 'Éclair Fou',
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateur(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cacheStats = new Map();
function statsCarte(item) {
  if (cacheStats.has(item.id)) return cacheStats.get(item.id);
  const b = BASE[item.rarity] || BASE.commun;
  const r = generateur(hash(item.id));
  const v = () => 0.88 + r() * 0.24; // ±12 %, toujours identique pour une même carte
  const s = {
    pv: Math.round(b.pv * v()),
    atk: Math.round(b.atk * v()),
    def: Math.round(b.def * v()),
    vit: Math.round(b.vit * v()),
    special: ATTAQUES_SPECIALES[Math.floor(r() * ATTAQUES_SPECIALES.length)],
  };
  cacheStats.set(item.id, s);
  return s;
}

function puissance(item) {
  const s = statsCarte(item);
  return Math.round(s.pv * 0.5 + s.atk * 3 + s.def * 2 + s.vit);
}

// ── Stockage : combats ──────────────────────────────────────────────────
const FICHIER_COMBAT = 'pokemon_combat.json';
const combat = chargerDonnees(FICHIER_COMBAT, { guilds: {}, escrow: {} });
if (!combat.guilds) combat.guilds = {};
if (!combat.escrow) combat.escrow = {};

let timerCombat = null;
function sauverCombat() {
  if (timerCombat) return;
  timerCombat = setTimeout(() => {
    timerCombat = null;
    sauvegarderDonnees(FICHIER_COMBAT, combat);
  }, 1000);
  timerCombat.unref?.();
}
// Écriture immédiate (mises en séquestre : on ne veut pas les perdre sur un crash)
function sauverCombatMaintenant() {
  if (timerCombat) { clearTimeout(timerCombat); timerCombat = null; }
  return sauvegarderDonnees(FICHIER_COMBAT, combat);
}

function joueurCombat(guildId, userId) {
  const gid = String(guildId);
  if (!combat.guilds[gid]) combat.guilds[gid] = { players: {} };
  if (!combat.guilds[gid].players) combat.guilds[gid].players = {};
  const p = combat.guilds[gid].players;
  const uid = String(userId);
  if (!p[uid]) p[uid] = { wins: 0, losses: 0, draws: 0, streak: 0, best: 0, rating: 1000, gains: 0 };
  return p[uid];
}

function classementCombat(guildId) {
  const gid = String(guildId);
  const p = combat.guilds[gid]?.players || {};
  return Object.entries(p)
    .map(([id, s]) => ({ id, ...s, games: s.wins + s.losses + s.draws }))
    .filter(s => s.games > 0)
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins);
}

// Mise à jour après un combat (Elo, K = 24). winnerId = null → égalité.
function enregistrerResultat(guildId, idA, idB, winnerId) {
  const a = joueurCombat(guildId, idA);
  const b = joueurCombat(guildId, idB);
  const attendu = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const scoreA = winnerId === null ? 0.5 : (winnerId === idA ? 1 : 0);
  const K = 24;
  const dA = Math.round(K * (scoreA - attendu));
  const dB = -dA;
  a.rating += dA; b.rating += dB;
  if (winnerId === null) { a.draws++; b.draws++; a.streak = 0; b.streak = 0; }
  else {
    const w = winnerId === idA ? a : b;
    const l = winnerId === idA ? b : a;
    w.wins++; l.losses++;
    w.streak++; l.streak = 0;
    if (w.streak > w.best) w.best = w.streak;
  }
  sauverCombat();
  return { [idA]: dA, [idB]: dB };
}

// ── Stockage : marché ───────────────────────────────────────────────────
const FICHIER_MARCHE = 'pokemon_marche.json';
const marcheData = chargerDonnees(FICHIER_MARCHE, {});

let timerMarche = null;
function sauverMarche() {
  if (timerMarche) return;
  timerMarche = setTimeout(() => {
    timerMarche = null;
    sauvegarderDonnees(FICHIER_MARCHE, marcheData);
  }, 800);
  timerMarche.unref?.();
}

function marche(guildId) {
  const gid = String(guildId);
  if (!marcheData[gid]) marcheData[gid] = { nextId: 1, listings: {} };
  const m = marcheData[gid];
  if (!m.listings) m.listings = {};
  if (!m.nextId) m.nextId = 1;
  return m;
}

function guildesMarche() { return Object.keys(marcheData); }

module.exports = {
  // économie / inventaire
  ecoActive, emoji, solde, fmt, debiter, crediter, sauverEco,
  nbCartes, donnerCarte, retirerCarte, cartesPossedees,
  // stats de cartes
  statsCarte, puissance,
  // combats
  combat, sauverCombat, sauverCombatMaintenant, joueurCombat, classementCombat, enregistrerResultat,
  // marché
  marche, sauverMarche, guildesMarche,
};
