const {
  SlashCommandBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { glassPayload } = require('../core/glassEmbed');
const {
  BOT_OWNER_ID
} = require('../core/constants');

const LIEN_TOP_GG = 'https://top.gg/bot/1403513450273177772';
const LIEN_SUPPORT = 'https://discord.gg/WecpyxrSBT';
// ⚠️ Mets ici l'URL de ton site web ; laisse vide pour masquer le bouton.
const LIEN_SITE = '';

const data = new SlashCommandBuilder().setName('bot-infos').setDescription('🤖 Affiche les informations de CoreLab');

async function execute(interaction, client) {
  client = client || interaction.client;

  const serveurs = client.guilds.cache.size;
  const utilisateurs = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
  const commandes = client.commands?.size || 0;
  const creation = client.user.createdAt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const nf = n => n.toLocaleString('fr-FR');

  const lignes = [
    `✨ **Développeur :** <@${BOT_OWNER_ID}>`,
    `📍 **Serveurs :** ${nf(serveurs)}`,
    `👥 **Utilisateurs :** ${nf(utilisateurs)}`,
    `🔧 **Commandes :** ${nf(commandes)}`,
    `⏳ **Date de création :** ${creation}`
  ];
  const embed = new EmbedBuilder()
    .setTitle(`🤖 ${client.user.username}`)
    .setDescription(lignes.join('\n'))
    .setColor(0xFFFFFF);

  const boutons = [
    new ButtonBuilder().setLabel('Ajouter le bot').setEmoji('🚀').setStyle(ButtonStyle.Link).setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&integration_type=0&scope=bot%20applications.commands`)
  ];
  if (LIEN_SITE) {
    boutons.push(new ButtonBuilder().setLabel('Site web').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(LIEN_SITE));
  }
  boutons.push(
    new ButtonBuilder().setLabel('Top.gg').setEmoji('🗳️').setStyle(ButtonStyle.Link).setURL(LIEN_TOP_GG),
    new ButtonBuilder().setLabel('Support Discord').setEmoji('📌').setStyle(ButtonStyle.Link).setURL(LIEN_SUPPORT)
  );

  // Carte « verre fumé » : logo du bot, stats en pastilles, boutons sous la carte.
  const payload = await glassPayload({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(boutons)]
  }, {
    guild: interaction.guild,
    client,
    badge: 'INFORMATIONS DU BOT',
    avatar: client.user.displayAvatarURL({ extension: 'png', size: 256 })
  });
  // Si index.js a déjà « defer » l'interaction (filet de sécurité à 2 s, en éphémère),
  // on supprime l'attente et on renvoie le message en public.
  if (interaction.deferred || interaction.replied) {
    await interaction.deleteReply().catch(() => { });
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

module.exports = {
  data,
  execute
};