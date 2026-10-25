'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { executerLfg } = require('../handlers/communityLfg');

const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('🎮 Recherche de joueurs : trouve une équipe en 2 clics')
  .addSubcommand(sub => sub
    .setName('creer')
    .setDescription('📣 Publier une annonce de recherche de joueurs')
    .addStringOption(o => o.setName('jeu').setDescription('Le jeu (ex : ETS2, ATS, Minecraft…)').setRequired(true).setMaxLength(60))
    .addIntegerOption(o => o.setName('places').setDescription('Nombre total de joueurs (toi inclus)').setRequired(true).setMinValue(2).setMaxValue(25))
    .addStringOption(o => o.setName('description').setDescription('Détails : mode, niveau, ambiance…').setMaxLength(300))
    .addStringOption(o => o.setName('quand').setDescription('Quand ? (ex : ce soir 21h, maintenant)').setMaxLength(60))
    .addIntegerOption(o => o.setName('duree').setDescription('Durée de l\'annonce en minutes (défaut : 60)').setMinValue(5).setMaxValue(1440))
    .addBooleanOption(o => o.setName('vocal').setDescription('Créer un vocal privé quand l\'équipe est complète ?')))
  .addSubcommand(sub => sub
    .setName('liste')
    .setDescription('📋 Voir les annonces ouvertes'))
  .addSubcommand(sub => sub
    .setName('annuler')
    .setDescription('🔒 Fermer toutes tes annonces ouvertes'))
  .addSubcommand(sub => sub
    .setName('config')
    .setDescription('⚙️ Admin • Salon des annonces et rôle à pinger')
    .addChannelOption(o => o.setName('salon').setDescription('Salon où publier les annonces').addChannelTypes(ChannelType.GuildText))
    .addRoleOption(o => o.setName('role').setDescription('Rôle pingé à chaque nouvelle annonce'))
    .addBooleanOption(o => o.setName('reinitialiser').setDescription('Remettre la config par défaut')));

async function execute(interaction) {
  return executerLfg(interaction);
}

module.exports = { data, execute };
