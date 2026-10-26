'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const market = require('../handlers/cardMarket');
const { toCV2Payload } = require('../core/componentsV2');

const data = new SlashCommandBuilder()
  .setName('marche')
  .setDescription('🏪 Marché & enchères de cartes Pokémon entre membres')
  .addSubcommand(sub => sub
    .setName('vendre')
    .setDescription('🏷️ Mettre une carte en vente à prix fixe (7 jours)')
    .addStringOption(o => o.setName('carte').setDescription('La carte à vendre').setAutocomplete(true).setRequired(true))
    .addIntegerOption(o => o.setName('prix').setDescription('Prix demandé en Scarabées').setMinValue(1).setMaxValue(market.PRIX_MAX).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('enchere')
    .setDescription('🔨 Mettre une carte aux enchères')
    .addStringOption(o => o.setName('carte').setDescription('La carte à mettre aux enchères').setAutocomplete(true).setRequired(true))
    .addIntegerOption(o => o.setName('prix-depart').setDescription('Prix de départ en Scarabées').setMinValue(1).setMaxValue(market.PRIX_MAX).setRequired(true))
    .addIntegerOption(o => o.setName('duree').setDescription('Durée de l\'enchère (défaut : 24 h)').addChoices(
      { name: '1 heure', value: 1 },
      { name: '6 heures', value: 6 },
      { name: '12 heures', value: 12 },
      { name: '24 heures', value: 24 },
      { name: '48 heures', value: 48 },
      { name: '72 heures', value: 72 },
    ))
    .addIntegerOption(o => o.setName('achat-immediat').setDescription('Prix d\'achat immédiat (optionnel, > prix de départ)').setMinValue(2).setMaxValue(market.PRIX_MAX)))
  .addSubcommand(sub => sub
    .setName('liste')
    .setDescription('📜 Voir les annonces en cours')
    .addStringOption(o => o.setName('type').setDescription('Type d\'annonce (défaut : tout)').addChoices(
      { name: '📜 Tout', value: 'tout' },
      { name: '🏷️ Prix fixe', value: 'fixe' },
      { name: '🔨 Enchères', value: 'enchere' },
    ))
    .addStringOption(o => o.setName('recherche').setDescription('Filtrer par nom de Pokémon'))
    .addIntegerOption(o => o.setName('page').setDescription('Numéro de page').setMinValue(1)))
  .addSubcommand(sub => sub
    .setName('acheter')
    .setDescription('🛒 Acheter une annonce à prix fixe')
    .addIntegerOption(o => o.setName('id').setDescription('Numéro de l\'annonce').setAutocomplete(true).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('encherir')
    .setDescription('💰 Placer une enchère')
    .addIntegerOption(o => o.setName('id').setDescription('Numéro de l\'annonce').setAutocomplete(true).setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Ton enchère en Scarabées').setMinValue(1).setMaxValue(market.PRIX_MAX).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('annuler')
    .setDescription('🚫 Retirer une de tes annonces (la carte te revient)')
    .addIntegerOption(o => o.setName('id').setDescription('Numéro de l\'annonce').setAutocomplete(true).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('mes-annonces')
    .setDescription('📦 Voir tes annonces et les enchères où tu es en tête'));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'vendre') return market.vendre(interaction);
  if (sub === 'enchere') return market.mettreAuxEncheres(interaction);
  if (sub === 'acheter') return market.actionAcheter(interaction, interaction.options.getInteger('id', true));
  if (sub === 'encherir') return market.actionEncherir(interaction, interaction.options.getInteger('id', true), interaction.options.getInteger('montant', true));
  if (sub === 'annuler') return market.actionAnnuler(interaction, interaction.options.getInteger('id', true));

  let embed;
  if (sub === 'liste') {
    embed = market.embedListe(interaction, {
      type: interaction.options.getString('type') || 'tout',
      recherche: interaction.options.getString('recherche'),
      page: interaction.options.getInteger('page') || 1,
    });
  } else {
    embed = market.embedMesAnnonces(interaction);
  }
  const payload = toCV2Payload({ embeds: [embed], allowedMentions: { parse: [] } });
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

module.exports = { data, execute, autocomplete: market.autocomplete };
