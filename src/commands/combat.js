'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const battle = require('../handlers/cardBattle');
const { glassPayload } = require('../core/glassEmbed');

const data = new SlashCommandBuilder()
  .setName('poke-fight')
  .setDescription('⚔️ Combats de cartes Pokémon en duel contre un membre')
  .addSubcommand(sub => sub
    .setName('challenge')
    .setDescription('⚔️ Défier un membre avec ta collection de cartes')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à défier').setRequired(true))
    .addIntegerOption(o => o.setName('mise').setDescription('Mise en Scarabées pour chacun (défaut : 0, sans mise)').setMinValue(0).setMaxValue(battle.MISE_MAX)))
  .addSubcommand(sub => sub
    .setName('stats')
    .setDescription('📊 Voir les statistiques de combat d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre (défaut : toi)')))
  .addSubcommand(sub => sub
    .setName('leaderboard')
    .setDescription('🏆 Classement des meilleurs combattants du serveur'))
  .addSubcommand(sub => sub
    .setName('rules')
    .setDescription('📖 Comment fonctionnent les combats de cartes'));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'challenge') return battle.lancerDefi(interaction);

  let embed;
  let avatar;
  if (sub === 'stats') {
    const cible = interaction.options.getUser('membre') || interaction.user;
    embed = battle.embedStats(interaction.guild, cible);
    avatar = cible.displayAvatarURL({ extension: 'png', size: 256 });
  }
  else if (sub === 'leaderboard') embed = battle.embedClassement(interaction.guild);
  else embed = battle.embedRegles();

  const payload = await glassPayload({ embeds: [embed], allowedMentions: { parse: [] } },
    { guild: interaction.guild, client: interaction.client, badge: 'POKÉ-FIGHT', avatar });
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

module.exports = { data, execute };
