'use strict';

// ────────────────────────────────────────────────
// Définition des compteurs disponibles pour /serverstats-setup
// (imite le fonctionnement du bot "ServerStats" : des salons vocaux
// verrouillés, dont le nom affiche une statistique du serveur, mis à
// jour périodiquement par src/tasks/serverStats.js)
// ────────────────────────────────────────────────

const TYPES_COMPTEURS = {
  membres: { emoji: '👥', libelle: 'Membres' },
  humains: { emoji: '🧑', libelle: 'Humains' },
  bots: { emoji: '🤖', libelle: 'Bots' },
  en_ligne: { emoji: '🟢', libelle: 'En ligne' },
  salons: { emoji: '💬', libelle: 'Salons' },
  roles: { emoji: '🎭', libelle: 'Rôles' },
  boosts: { emoji: '🚀', libelle: 'Boosts' },
};

// Certains types nécessitent d'avoir le cache des membres complet
// (fetch complet) pour être fiables. On ne fait ce fetch coûteux que si
// au moins un de ces types est activé sur la guilde.
const TYPES_NECESSITANT_FETCH_MEMBRES = new Set(['humains', 'bots', 'en_ligne']);

function necessiteFetchMembres(types) {
  return types.some(t => TYPES_NECESSITANT_FETCH_MEMBRES.has(t));
}

// Calcule la valeur actuelle d'un type de compteur pour une guilde.
// Suppose que guild.members.fetch() a déjà été appelé en amont si
// nécessaire (voir necessiteFetchMembres).
function calculerValeur(guild, type) {
  switch (type) {
    case 'membres':
      return guild.memberCount;
    case 'humains':
      return guild.members.cache.filter(m => !m.user.bot).size;
    case 'bots':
      return guild.members.cache.filter(m => m.user.bot).size;
    case 'en_ligne':
      return guild.members.cache.filter(m => m.presence && m.presence.status !== 'offline').size;
    case 'salons':
      return guild.channels.cache.size;
    case 'roles':
      return guild.roles.cache.size;
    case 'boosts':
      return guild.premiumSubscriptionCount || 0;
    default:
      return 0;
  }
}

function construireNomSalon(type, valeur) {
  const def = TYPES_COMPTEURS[type];
  if (!def) return null;
  return `${def.emoji} ${def.libelle} : ${valeur}`.slice(0, 100);
}

module.exports = {
  TYPES_COMPTEURS,
  necessiteFetchMembres,
  calculerValeur,
  construireNomSalon,
};
