const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const {
  setupIaChannel
} = require('../handlers/aiChat');

const configIa = {
  data: new SlashCommandBuilder()
    .setName('config-ia')
    .setDescription("🤖 Crée la catégorie et le salon de l'assistant IA CoreLab")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  execute: async interaction => setupIaChannel(interaction)
};

module.exports = { commands: [configIa] };
