const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require('discord.js');

// ⚠️ Remplace cette URL par le lien de vote top.gg de CoreLab
// (ex : https://top.gg/bot/TON_CLIENT_ID/vote)
const {
  toCV2Payload
} = require("../core/componentsV2");
const LIEN_TOP_GG = 'https://top.gg/bot/1403513450273177772/vote';
const LIEN_AVIS_TOP_GG = 'https://top.gg/bot/1403513450273177772#reviews';
const LIEN_SUPPORT = 'https://discord.gg/WecpyxrSBT';
const data = new SlashCommandBuilder().setName('top-gg').setDescription('🗳️ Vote pour CoreLab sur top.gg');
async function execute(interaction) {
  const embed = new EmbedBuilder().setTitle('🗳️ Vote pour CoreLab').setDescription('Soutiens **CoreLab** en votant pour lui sur **top.gg** !\n\n' + '> Clique sur **Vote** ci-dessous, ça ne prend que quelques secondes.\n\n' + '⭐ Tu aimes **CoreLab** ? Pense aussi à laisser un **avis** sur top.gg, ça nous aide énormément !').setThumbnail(interaction.client.user.displayAvatarURL()).setColor(0xFFFFFF).setFooter({
    text: 'CoreLab • Merci pour ton soutien !',
    iconURL: interaction.client.user.displayAvatarURL()
  });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Vote').setStyle(ButtonStyle.Link).setURL(LIEN_TOP_GG), new ButtonBuilder().setLabel('Invite').setStyle(ButtonStyle.Link).setURL(`https://discord.com/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&integration_type=0&scope=bot%20applications.commands`), new ButtonBuilder().setLabel('Support Server').setStyle(ButtonStyle.Link).setURL(LIEN_SUPPORT), new ButtonBuilder().setLabel('Laisser un avis').setEmoji('⭐').setStyle(ButtonStyle.Link).setURL(LIEN_AVIS_TOP_GG));
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    components: [row]
  }));
}
module.exports = {
  data,
  execute
};