'use strict';

const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { containerAccent } = require('../core/cardTheme');

// ─────────────────────────────────────────────────────────────────────────
// /avatar et /banniere : affichent l'avatar / la bannière d'un membre en
// grand, avec des boutons-liens pour ouvrir l'image dans chaque format.
// Ce fichier exporte deux commandes (loadCommands gère `commands: [...]`).
// ─────────────────────────────────────────────────────────────────────────

const V2 = MessageFlags.IsComponentsV2;

function sep() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function estAnime(url) {
  return /\/a_[^/]+\.(?:gif|webp|png)/i.test(url) || /\.gif(?:\?|$)/i.test(url);
}

// Boutons-liens : PNG / JPG / WEBP (+ GIF si animé), tous en 4096 px
function boutonsFormats(urlDe) {
  const row = new ActionRowBuilder();
  for (const ext of ['png', 'jpg', 'webp']) {
    row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ext.toUpperCase()).setURL(urlDe(ext)));
  }
  return row;
}

function carte({ guildId, titre, sousTitre, imageUrl, row }) {
  const c = new ContainerBuilder()
    .setAccentColor(containerAccent(guildId, 0xFFFFFF))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${titre}`));
  if (sousTitre) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(sousTitre));
  c.addSeparatorComponents(sep());
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
  if (row) {
    c.addSeparatorComponents(sep());
    c.addActionRowComponents(row);
  }
  return c;
}

async function chargerMembre(interaction, userId) {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

// ── /avatar ─────────────────────────────────────────────────────────────
const avatarData = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('🖼️ Afficher l\'avatar d\'un membre en grand')
  .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)'))
  .addBooleanOption(o => o.setName('serveur').setDescription('Afficher l\'avatar propre à ce serveur (s\'il en a un)'));

async function avatarExecute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: V2 });

  const user = interaction.options.getUser('membre') || interaction.user;
  const veutServeur = interaction.options.getBoolean('serveur') || false;
  const membre = veutServeur ? await chargerMembre(interaction, user.id) : null;

  const avatarServeur = membre?.avatar ? membre.displayAvatarURL({ size: 1024 }) : null;
  const utilise = avatarServeur || user.displayAvatarURL({ size: 1024 });
  const nom = user.globalName || user.username;

  const row = boutonsFormats(ext => (avatarServeur
    ? membre.displayAvatarURL({ size: 4096, extension: ext, forceStatic: true })
    : user.displayAvatarURL({ size: 4096, extension: ext, forceStatic: true })));
  if (estAnime(utilise)) {
    row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('GIF').setURL(
      (avatarServeur ? membre : user).displayAvatarURL({ size: 4096, extension: 'gif' })
    ));
  }

  const sousTitre = veutServeur && !avatarServeur
    ? `-# ${nom} n'a pas d'avatar propre à ce serveur : avatar du profil affiché.`
    : `-# ${avatarServeur ? 'Avatar du serveur' : 'Avatar du profil'} • <@${user.id}>`;

  return interaction.editReply({
    components: [carte({ guildId: interaction.guild.id, titre: `🖼️ Avatar de ${nom}`, sousTitre, imageUrl: utilise, row })],
    flags: V2,
    allowedMentions: { parse: [] },
  });
}

// ── /banniere ───────────────────────────────────────────────────────────
const banniereData = new SlashCommandBuilder()
  .setName('banniere')
  .setDescription('🎨 Afficher la bannière d\'un membre en grand')
  .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)'))
  .addBooleanOption(o => o.setName('serveur').setDescription('Afficher la bannière propre à ce serveur (s\'il en a une)'));

async function banniereExecute(interaction) {
  if (!interaction.guild) return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: V2 });

  const base = interaction.options.getUser('membre') || interaction.user;
  const veutServeur = interaction.options.getBoolean('serveur') || false;

  // La bannière n'est pas dans le cache : il faut forcer un fetch de l'utilisateur
  const user = await interaction.client.users.fetch(base.id, { force: true }).catch(() => base);
  const nom = user.globalName || user.username;

  let membre = null;
  if (veutServeur) membre = await chargerMembre(interaction, user.id);
  const urlServeur = membre?.banner && typeof membre.bannerURL === 'function' ? membre.bannerURL({ size: 1024 }) : null;
  const urlProfil = user.bannerURL({ size: 1024 });
  const utilise = urlServeur || urlProfil;

  if (!utilise) {
    const couleur = user.hexAccentColor;
    const c = new ContainerBuilder()
      .setAccentColor(user.accentColor ?? containerAccent(interaction.guild.id, 0xFFFFFF))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎨 Bannière de ${nom}`))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `❌ **${nom}** n'a pas de bannière.` + (couleur ? `\n🎨 Couleur de profil : \`${couleur}\`` : '')
      ));
    return interaction.editReply({ components: [c], flags: V2, allowedMentions: { parse: [] } });
  }

  const source = urlServeur ? membre : user;
  const row = boutonsFormats(ext => source.bannerURL({ size: 4096, extension: ext, forceStatic: true }));
  if (estAnime(utilise)) {
    row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('GIF').setURL(
      source.bannerURL({ size: 4096, extension: 'gif' })
    ));
  }

  const sousTitre = veutServeur && !urlServeur
    ? `-# ${nom} n'a pas de bannière propre à ce serveur : bannière du profil affichée.`
    : `-# ${urlServeur ? 'Bannière du serveur' : 'Bannière du profil'} • <@${user.id}>`;

  return interaction.editReply({
    components: [carte({ guildId: interaction.guild.id, titre: `🎨 Bannière de ${nom}`, sousTitre, imageUrl: utilise, row })],
    flags: V2,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  commands: [
    { data: avatarData, execute: avatarExecute },
    { data: banniereData, execute: banniereExecute },
  ],
};
