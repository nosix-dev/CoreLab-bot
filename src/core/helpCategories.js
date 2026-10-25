'use strict';

// ────────────────────────────────────────────────
// Catégories affichées dans le panneau `!help` / `!aide`
// (mêmes 6 catégories que le style demandé : Administration,
// Auto-Modération, Management, Modération, Network, Public)
// ────────────────────────────────────────────────

const HELP_CATEGORIES = [
  {
    key: 'administration',
    label: 'Administration',
    emoji: '🛡️',
    commands: ['config', 'parametres', 'config-ia', 'backup', 'serverstats-setup', 'langue-bot', 'tickets', 'annonces', 'tableau-etoiles', 'vocaux-temp', 'premium', 'statistiques'],
  },
  {
    key: 'automod',
    label: 'Auto-Modération',
    emoji: '🤖',
    commands: ['report'],
    prefixCommands: ['automod-setup', 'automod-cleanup'],
  },
  {
    key: 'management',
    label: 'Management',
    emoji: '📁',
    commands: [
      'formulaire', 'formulaire-modifier', 'roles-reaction',
      'role-temporaire', 'role-temporaire-liste', 'role-temporaire-retirer',
      'planifier', 'planification-liste', 'planification-retirer',
      'rappel', 'rappels', 'rappel-retirer',
      'purge-temp', 'purge-temp-liste', 'purge-temp-retirer',
      'evenement-creer', 'evenements', 'evenement-retirer',
      'message', 'annonce',
      'pseudo-definir', 'pseudo-reinitialiser', 'anniversaire',
    ],
  },
  {
    key: 'moderation',
    label: 'Modération',
    emoji: '⚖️',
    commands: [
      'kick', 'ban', 'warn', 'warninfos', 'purge', 'purgeuser', 'mute', 'deletechannels',
      'bannissement-temporaire', 'muet-temporaire', 'muet-retirer', 'timeout', 'untimeout',
      'role-ajouter', 'role-retirer', 'avertissement-reinitialiser',
      'infractions', 'infraction-ajouter', 'infractions-reinitialiser',
      'verrouiller', 'deverrouiller', 'verrouillage-total', 'deverrouillage-total',
    ],
  },
  {
    key: 'economie',
    label: 'Économie',
    emoji: '💠',
    commands: [
      'porte-monnaie', 'daily', 'travailler', 'pecher', 'pile-ou-face', 'machine-a-sous',
      'blackjack', 'donner', 'deposer', 'retirer', 'classement-argent',
      'collection', 'vendre', 'echanger',
      'parametre-economie',
    ],
  },
  {
    key: 'poke',
    label: 'Pokémon',
    emoji: '🃏',
    commands: ['poke-fight', 'poke-wheel', 'marche'],
  },
  {
    key: 'communaute',
    label: 'Communauté',
    emoji: '🎉',
    commands: ['jeu', 'social', 'lfg', 'reputation'],
  },
  {
    key: 'network',
    label: 'Network',
    emoji: '🌐',
    commands: ['invite', 'vote', 'top-gg', 'bot-infos'],
  },
  {
    key: 'public',
    label: 'Public',
    emoji: '☀️',
    commands: [
      'niveau', 'classement', 'sondage', 'sondage-fermer', 'sondage-liste',
      'concours', 'concours-liste', 'concours-retirage', 'suggestion', 'texte-vocal',
      'serveur-statistiques', 'membre-statistiques', 'avatar', 'banniere',
    ],
  },
];

// Construit la répartition réelle à partir des commandes chargées par le bot
// (client.commands), afin que les compteurs restent toujours exacts même si
// des commandes sont ajoutées/retirées plus tard sans toucher ce fichier.
function buildHelpData(client) {
  const allCommands = [...client.commands.values()];
  const assigned = new Set();

  const categories = HELP_CATEGORIES.map(cat => {
    const resolvedCommands = cat.commands
      .map(name => allCommands.find(c => c.data.name === name))
      .filter(Boolean);
    resolvedCommands.forEach(c => assigned.add(c.data.name));
    const resolvedPrefixCommands = cat.prefixCommands || [];
    return {
      key: cat.key,
      label: cat.label,
      emoji: cat.emoji,
      resolvedCommands,
      resolvedPrefixCommands,
    };
  }).filter(cat => cat.resolvedCommands.length > 0 || cat.resolvedPrefixCommands.length > 0);

  // Toute commande slash non répertoriée manuellement atterrit dans "Autres",
  // pour ne jamais la faire disparaître silencieusement du panneau.
  const uncategorized = allCommands.filter(c => !assigned.has(c.data.name));
  if (uncategorized.length) {
    categories.push({
      key: 'autres',
      label: 'Autres',
      emoji: '📦',
      resolvedCommands: uncategorized,
      resolvedPrefixCommands: [],
    });
  }

  return {
    categories,
    totalCommands: allCommands.length,
    totalCategories: categories.length,
  };
}

module.exports = { HELP_CATEGORIES, buildHelpData };