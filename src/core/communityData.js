'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Données des mini-jeux : thèmes du quiz (questions générées par l'IA) + mots du pendu.
// ─────────────────────────────────────────────────────────────────────────

const THEMES = {
  general: { label: '🌍 Culture générale', emoji: '🌍', sujet: 'culture générale (géographie, histoire, sciences, arts, littérature, nature, etc.)' },
  jeux: { label: '🎮 Jeux vidéo', emoji: '🎮', sujet: 'jeux vidéo (franchises, consoles, studios, mécaniques, histoire du jeu vidéo, esport)' },
  discord: { label: '💬 Discord & dev', emoji: '💬', sujet: 'Discord et programmation (API Discord, bots, JavaScript, Python, web, culture développeur)' },
};

// Sujets piochés au hasard quand le thème est « mélange » (le quiz est généré par l'IA)
const SUJETS_MELANGE = [
  { nom: 'géographie', emoji: '🌍' }, { nom: 'histoire', emoji: '📜' }, { nom: 'sciences et physique', emoji: '🔬' },
  { nom: 'espace et astronomie', emoji: '🚀' }, { nom: 'animaux', emoji: '🐾' }, { nom: 'nature et environnement', emoji: '🌿' },
  { nom: 'cinéma', emoji: '🎬' }, { nom: 'musique', emoji: '🎵' }, { nom: 'littérature', emoji: '📚' },
  { nom: 'art et peinture', emoji: '🎨' }, { nom: 'sport', emoji: '⚽' }, { nom: 'gastronomie', emoji: '🍽️' },
  { nom: 'jeux vidéo', emoji: '🎮' }, { nom: 'informatique et internet', emoji: '💻' }, { nom: 'Discord et réseaux sociaux', emoji: '💬' },
  { nom: 'mythologie et légendes', emoji: '🏛️' }, { nom: 'corps humain et santé', emoji: '🫀' }, { nom: 'inventions et technologie', emoji: '💡' },
  { nom: 'mathématiques et logique', emoji: '🧮' }, { nom: 'langues et expressions françaises', emoji: '🗣️' }, { nom: 'architecture et monuments', emoji: '🏰' },
  { nom: 'séries et animation', emoji: '📺' }, { nom: 'culture internet et mèmes', emoji: '😂' }, { nom: 'records et faits insolites', emoji: '🏆' },
];

// Mots du pendu (sans accents, en minuscules)
const MOTS_PENDU = [
  // thème camions / jeux
  'camion', 'remorque', 'autoroute', 'chauffeur', 'convoi', 'carburant', 'gazole', 'peage', 'itineraire',
  'livraison', 'chargement', 'cabine', 'volant', 'klaxon', 'garage', 'parking', 'frontiere', 'depanneuse',
  'manette', 'ecran', 'clavier', 'souris', 'serveur', 'joueur', 'partie', 'niveau', 'victoire', 'defaite',
  'aventure', 'trophee', 'equipe', 'mission', 'defi', 'tournoi', 'classement',
  // général
  'soleil', 'montagne', 'riviere', 'foret', 'ocean', 'desert', 'volcan', 'tempete', 'nuage', 'orage',
  'bibliotheque', 'chocolat', 'fromage', 'baguette', 'croissant', 'boulangerie', 'pharmacie', 'hopital',
  'ordinateur', 'telephone', 'television', 'internet', 'message', 'photo', 'musique', 'guitare', 'piano',
  'voyage', 'valise', 'passeport', 'aeroport', 'avion', 'bateau', 'train', 'velo', 'moto', 'voiture',
  'jardin', 'maison', 'fenetre', 'escalier', 'cuisine', 'chambre', 'miroir', 'horloge', 'lumiere', 'bougie',
  'elephant', 'girafe', 'dauphin', 'papillon', 'crocodile', 'hirondelle', 'ecureuil', 'herisson', 'dragon',
  'amitie', 'courage', 'liberte', 'mystere', 'tresor', 'pirate', 'chevalier', 'sorcier', 'fantome', 'robot',
];

module.exports = { THEMES, SUJETS_MELANGE, MOTS_PENDU };
