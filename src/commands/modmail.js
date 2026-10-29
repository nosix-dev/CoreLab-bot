'use strict';

const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const {
  getCfg,
  save,
  isStaff,
  findThreadByChannel,
  closeThread,
} = require('../handlers/modmail');

const data = new SlashCommandBuilder()
  .setName('modmail')
  .setDescription('📬 Modmail : les membres écrivent au bot en MP, le staff répond depuis un salon')
  .setDMPermission(false)
  .addSubcommand(sub => sub
    .setName('setup')
    .setDescription('⚙️ Admin • Activer et configurer le Modmail')
    .addChannelOption(o => o.setName('categorie').setDescription('Catégorie où seront créés les salons Modmail').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rôle du staff qui voit et répond aux Modmail').setRequired(true))
    .addChannelOption(o => o.setName('logs').setDescription('Salon où envoyer la transcription à la fermeture').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(sub => sub
    .setName('disable')
    .setDescription('⚙️ Admin • Désactiver le Modmail'))
  .addSubcommand(sub => sub
    .setName('close')
    .setDescription('🔒 Fermer le Modmail du salon actuel')
    .addStringOption(o => o.setName('raison').setDescription('Raison (envoyée au membre)').setMaxLength(300)))
  .addSubcommand(sub => sub
    .setName('block')
    .setDescription('⛔ Empêcher un membre d\'utiliser le Modmail')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à bloquer').setRequired(true)))
  .addSubcommand(sub => sub
    .setName('unblock')
    .setDescription('✅ Autoriser de nouveau un membre à utiliser le Modmail')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à débloquer').setRequired(true)));

const reply = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

async function execute(interaction, client) {
  if (!interaction.guild) return reply(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const sub = interaction.options.getSubcommand();
  const cfg = getCfg(interaction.guild.id);
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

  if (sub === 'setup' || sub === 'disable') {
    if (!isAdmin) return reply(interaction, '❌ Il faut la permission **Gérer le serveur**.');
  } else if (!isStaff(interaction.member, cfg)) {
    return reply(interaction, '❌ Réservé au staff du Modmail.');
  }

  if (sub === 'setup') {
    const category = interaction.options.getChannel('categorie');
    const role = interaction.options.getRole('role');
    const logs = interaction.options.getChannel('logs');

    const me = interaction.guild.members.me;
    const perms = category.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
      return reply(interaction, '❌ Je dois avoir **Voir le salon** et **Gérer les salons** dans cette catégorie.');
    }

    cfg.enabled = true;
    cfg.categoryId = category.id;
    cfg.staffRoleId = role.id;
    cfg.logChannelId = logs?.id || null;
    save();
    return reply(interaction,
      `✅ **Modmail activé.**\n` +
      `• Catégorie : ${category}\n• Rôle staff : ${role}\n• Logs : ${logs || '*aucun*'}\n\n` +
      `Les membres n'ont qu'à écrire en MP au bot. Dans un salon Modmail, commence un message par \`//\` pour une note interne.`);
  }

  if (sub === 'disable') {
    cfg.enabled = false;
    save();
    return reply(interaction, '✅ Modmail désactivé. Les salons déjà ouverts restent en place jusqu\'à leur fermeture.');
  }

  if (sub === 'close') {
    if (!findThreadByChannel(interaction.channelId)) {
      return reply(interaction, '❌ Utilise cette commande dans un salon Modmail.');
    }
    const raison = interaction.options.getString('raison');
    await interaction.reply({ content: '🔒 Fermeture en cours…' });
    await closeThread(client, interaction.channel, interaction.user, raison);
    return;
  }

  if (sub === 'block') {
    const user = interaction.options.getUser('membre');
    if (!cfg.blocked.includes(user.id)) cfg.blocked.push(user.id);
    save();
    return reply(interaction, `⛔ ${user} ne peut plus utiliser le Modmail.`);
  }

  if (sub === 'unblock') {
    const user = interaction.options.getUser('membre');
    cfg.blocked = cfg.blocked.filter(id => id !== user.id);
    save();
    return reply(interaction, `✅ ${user} peut de nouveau utiliser le Modmail.`);
  }
}

module.exports = { data, execute };
