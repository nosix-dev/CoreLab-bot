'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const store = require('../core/communityStore');
const games = require('../handlers/communityGames');

const data = new SlashCommandBuilder()
  .setName('jeu')
  .setDescription('🎮 Mini-jeux : quiz, pendu, devine le nombre, 8balls, mots enchaînés')
  .addSubcommand(sub => sub
    .setName('quiz')
    .setDescription('🧠 Quiz à boutons : questions aléatoires générées par l\'IA')
    .addIntegerOption(o => o.setName('manches').setDescription('Nombre de questions (défaut : 5)').setMinValue(1).setMaxValue(15))
    .addStringOption(o => o.setName('theme').setDescription('Thème des questions (défaut : mélange)').addChoices(
      { name: '🎲 Mélange', value: 'melange' },
      { name: '🌍 Culture générale', value: 'general' },
      { name: '🎮 Jeux vidéo', value: 'jeux' },
      { name: '💬 Discord & dev', value: 'discord' },
    )))
  .addSubcommand(sub => sub
    .setName('pendu')
    .setDescription('🪢 Pendu collaboratif : tout le salon joue ensemble'))
  .addSubcommand(sub => sub
    .setName('devine')
    .setDescription('🔢 Devine le nombre mystérieux (⬆️ plus grand / ⬇️ plus petit)')
    .addIntegerOption(o => o.setName('max').setDescription('Nombre maximum (défaut : 1000)').setMinValue(10).setMaxValue(100000)))
  .addSubcommand(sub => sub
    .setName('8balls')
    .setDescription('🎱 Pose une question à la boule magique')
    .addStringOption(o => o.setName('question').setDescription('Ta question (réponse oui / non)').setMaxLength(500).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('stop')
    .setDescription('🛑 Arrêter le jeu en cours dans ce salon'))
  .addSubcommand(sub => sub
    .setName('classement')
    .setDescription('🏆 Voir le classement d\'un jeu')
    .addStringOption(o => o.setName('jeu').setDescription('Quel jeu ? (défaut : quiz)').addChoices(
      { name: '🧠 Quiz (points)', value: 'quiz' },
      { name: '🪢 Pendu (victoires)', value: 'pendu' },
      { name: '🔢 Devine le nombre (victoires)', value: 'devine' },
      { name: '🔗 Mots enchaînés (mots)', value: 'mots' },
    )))
  .addSubcommand(sub => sub
    .setName('mots-salon')
    .setDescription('🔗 Admin • Activer les mots enchaînés dans un salon')
    .addChannelOption(o => o.setName('salon').setDescription('Salon du jeu').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(sub => sub
    .setName('mots-stop')
    .setDescription('🔗 Admin • Désactiver les mots enchaînés'))
  .addSubcommand(sub => sub
    .setName('mots-reset')
    .setDescription('🔗 Admin • Remettre la chaîne à zéro (le record est conservé)'));

function refuser(interaction, texte) {
  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}
function estAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function execute(interaction) {
  if (!interaction.guild) return refuser(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const sub = interaction.options.getSubcommand();

  if (sub === 'quiz') {
    return games.lancerQuiz(interaction, {
      manches: interaction.options.getInteger('manches') || 5,
      theme: interaction.options.getString('theme') || 'melange',
    });
  }
  if (sub === 'pendu') return games.lancerPendu(interaction);
  if (sub === 'devine') return games.lancerDevine(interaction, { max: interaction.options.getInteger('max') || 1000 });
  if (sub === '8balls') return games.lancer8balls(interaction, { question: interaction.options.getString('question', true) });
  if (sub === 'stop') return games.arreterJeu(interaction);

  if (sub === 'classement') {
    const type = interaction.options.getString('jeu') || 'quiz';
    const payload = await games.construireClassement(interaction.guild, type);
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  // ── Administration des mots enchaînés ──
  if (['mots-salon', 'mots-stop', 'mots-reset'].includes(sub)) {
    if (!estAdmin(interaction)) return refuser(interaction, '❌ Permission requise : **Gérer le serveur**.');
    const mots = store.jeux(interaction.guild.id).mots;

    if (sub === 'mots-salon') {
      const salon = interaction.options.getChannel('salon', true);
      mots.enabled = true;
      mots.channelId = salon.id;
      mots.chain = 0;
      mots.lastWord = null;
      mots.lastUserId = null;
      mots.used = [];
      store.sauverJeux();
      return refuser(interaction,
        `✅ Mots enchaînés activés dans ${salon}.\n**Règle :** chaque mot commence par la dernière lettre du mot précédent, sans répétition, et on ne joue pas deux fois de suite. Les messages qui ne sont pas un mot seul sont ignorés (on peut discuter).`);
    }
    if (sub === 'mots-stop') {
      mots.enabled = false;
      store.sauverJeux();
      return refuser(interaction, '🔴 Mots enchaînés désactivés.');
    }
    mots.chain = 0;
    mots.lastWord = null;
    mots.lastUserId = null;
    mots.used = [];
    store.sauverJeux();
    return refuser(interaction, `✅ Chaîne remise à zéro (record conservé : **${mots.record}**).`);
  }

  return refuser(interaction, '❌ Sous-commande inconnue.');
}

module.exports = { data, execute };
