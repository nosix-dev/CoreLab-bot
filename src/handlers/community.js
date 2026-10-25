'use strict';

const games = require('./communityGames');
const social = require('./communitySocial');
const lfg = require('./communityLfg');

// ─────────────────────────────────────────────────────────────────────────
// Point d'entrée unique : mini-jeux + social (mariage/amis/clans) + LFG.
// À appeler une seule fois dans index.js : registerCommunityHandlers(client);
// ─────────────────────────────────────────────────────────────────────────
function registerCommunityHandlers(client) {
  // Boutons des 3 systèmes (préfixes jeu_ / soc_ / lfg_, aucun conflit avec l'existant)
  client.on('interactionCreate', interaction => {
    try {
      if (!interaction.isButton()) return;
      const id = interaction.customId || '';
      if (id.startsWith('jeu_')) return void games.traiterInteraction(interaction);
      if (id.startsWith('soc_')) return void social.traiterInteraction(interaction);
      if (id.startsWith('lfg_')) return void lfg.traiterInteraction(interaction);
    } catch (e) {
      console.error('[Communauté] Erreur interaction :', e.message);
    }
  });

  // Messages : pendu, devine le nombre, mots enchaînés
  client.on('messageCreate', async message => {
    try {
      await games.traiterMessage(message);
    } catch (e) {
      console.error('[Communauté] Erreur message :', e.message);
    }
  });

  // Un membre quitte le serveur : on nettoie mariage, amis et clan
  client.on('guildMemberRemove', member => {
    social.nettoyerMembre(member.guild, member.id).catch(e => console.error('[Communauté] Nettoyage membre :', e.message));
  });

  // Expiration des annonces LFG + nettoyage des vocaux
  lfg.demarrerTache(client);

  console.log('✅ Systèmes communauté chargés (mini-jeux, social, LFG)');
}

module.exports = { registerCommunityHandlers };
