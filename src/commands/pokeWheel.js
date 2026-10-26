'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { runEco } = require('./economy');

// /poke-wheel : la roue (anciennement /eco roue). Même logique, même coût, même cooldown :
// on réutilise directement le code de la sous-commande 'roue' de l'économie.
const data = new SlashCommandBuilder()
  .setName('poke-wheel')
  .setDescription('🎡 Tourner la roue pour obtenir un objet, un lieu, une carte...')
  .addIntegerOption(o => o.setName('tours').setDescription('Nombre de tours à la suite (1 à 10)').setRequired(false).setMinValue(1).setMaxValue(10));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  return runEco(interaction, 'roue');
}

module.exports = { data, execute };
