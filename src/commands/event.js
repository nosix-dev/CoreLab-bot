// src/commands/event.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');
const {
  createEvent,
  listEvents,
  cancelEvent
} = require('../core/eventManager');

const event = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Créer et gérer des événements')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Créer un événement (annonce + inscriptions + rappels)')
      .addStringOption(o => o.setName('nom').setDescription('Nom de l\'événement').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('JJ/MM/AAAA HH:MM (heure de Paris)').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type (couleur dans /agenda, défaut : événement)').setRequired(false)
        .addChoices(
          { name: 'Convoi', value: 'convoi' },
          { name: 'Réunion', value: 'reunion' },
          { name: 'Événement', value: 'event' }
        ))
      .addStringOption(o => o.setName('description').setDescription('Description').setRequired(false))
      .addChannelOption(o => o.setName('vocal').setDescription('Salon vocal de l\'événement').addChannelTypes(ChannelType.GuildVoice).setRequired(false))
      .addStringOption(o => o.setName('lieu').setDescription('Lieu (si pas de salon vocal)').setRequired(false))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à mentionner').setRequired(false))
      .addIntegerOption(o => o.setName('places').setDescription('Nombre de places max').setMinValue(1).setRequired(false))
      .addIntegerOption(o => o.setName('duree').setDescription('Durée en minutes (défaut : 120)').setMinValue(15).setMaxValue(1440).setRequired(false))
      .addChannelOption(o => o.setName('salon').setDescription('Salon d\'annonce (défaut : salon d\'annonces configuré)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Voir les événements à venir'))
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Annuler un événement')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro (voir /event list)').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createEvent(interaction);
    if (sub === 'list') return listEvents(interaction);
    if (sub === 'cancel') return cancelEvent(interaction);
  }
};

module.exports = [event];