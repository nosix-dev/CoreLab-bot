const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { buildHelpData } = require('../core/helpCategories');
const { displayCommandName } = require('../core/commandLocalizations');

// ⚠️ À remplacer par votre vrai lien si besoin.
const SUPPORT_URL = 'https://discord.gg/WecpyxrSBT';

function buildOverviewEmbed(client, categories, totalCommands, totalCategories, requestedBy) {
  const catList = categories
    .map(c => `${c.emoji} **${c.label}**\n${c.resolvedCommands.length + c.resolvedPrefixCommands.length} commande(s)`)
    .join('\n\n');
  return new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setAuthor({ name: 'CoreLab • Menu d\'aide', iconURL: client.user.displayAvatarURL() })
    .setThumbnail(client.user.displayAvatarURL())
    .setDescription('👋 **Bienvenue dans le menu d\'aide !**\nSélectionnez une catégorie dans le menu ci-dessous pour explorer les commandes.')
    .addFields(
      { name: '📊 Statistiques', value: `\`\`\`Commandes : ${totalCommands}\nCatégories : ${totalCategories}\`\`\`` },
      { name: '📁 Catégories', value: catList || 'Aucune catégorie.' },
    )
    .setFooter({ text: `Demandé par ${requestedBy.tag}`, iconURL: requestedBy.displayAvatarURL() })
    .setTimestamp();
}

function buildCategoryEmbed(client, cat, requestedBy) {
  const lignesSlash = cat.resolvedCommands.map(c => `**/${displayCommandName(c.data.name)}** — ${c.data.description || 'Aucune description'}`);
  const lignesPrefix = cat.resolvedPrefixCommands.map(n => `**!${n}**`);
  const corps = [...lignesSlash, ...lignesPrefix].join('\n') || 'Aucune commande dans cette catégorie.';
  // L'emoji de catégorie va dans la description (et non dans l'auteur) : Discord
  // n'affiche jamais un emoji custom dans author.name (texte brut cassé), alors
  // qu'il s'affiche normalement dans la description — ça évite le retour à
  // l'emoji unicode par défaut selon l'endroit où on clique dans le panneau.
  const entete = `### ${cat.emoji} ${cat.label}\n\n`;
  const description = (entete + corps).slice(0, 4096);
  return new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setAuthor({ name: 'CoreLab • Menu d\'aide', iconURL: client.user.displayAvatarURL() })
    .setDescription(description)
    .setFooter({ text: `Demandé par ${requestedBy.tag}`, iconURL: requestedBy.displayAvatarURL() })
    .setTimestamp();
}

function buildComponents(categories, selectedKey) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('help_category_select')
    .setPlaceholder('Sélectionner une catégorie...')
    .addOptions(categories.map(c => ({
      label: c.label,
      value: c.key,
      emoji: c.emoji,
      description: `${c.resolvedCommands.length + c.resolvedPrefixCommands.length} commande(s)`,
      default: c.key === selectedKey,
    })));
  const selectRow = new ActionRowBuilder().addComponents(select);
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_home').setLabel('Accueil').setEmoji('🏠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Support').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
  );
  return [selectRow, buttonsRow];
}

async function sendHelpPanel(target, client) {
  const { categories, totalCommands, totalCategories } = buildHelpData(client);
  const requestedBy = target.author ?? target.user;
  const embed = buildOverviewEmbed(client, categories, totalCommands, totalCategories, requestedBy);
  const components = buildComponents(categories, null);
  return target.channel.send({ embeds: [embed], components });
}

function registerHelpHandler(client) {
  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId === 'help_category_select') {
        const { categories } = buildHelpData(client);
        const cat = categories.find(c => c.key === interaction.values[0]);
        if (!cat) return;
        const embed = buildCategoryEmbed(client, cat, interaction.user);
        return interaction.update({ embeds: [embed], components: buildComponents(categories, cat.key) });
      }
      if (interaction.isButton() && interaction.customId === 'help_home') {
        const { categories, totalCommands, totalCategories } = buildHelpData(client);
        const embed = buildOverviewEmbed(client, categories, totalCommands, totalCategories, interaction.user);
        return interaction.update({ embeds: [embed], components: buildComponents(categories, null) });
      }
    } catch (e) {
      console.error('Erreur panneau d\'aide :', e.message);
    }
  });
}

module.exports = { registerHelpHandler, sendHelpPanel };