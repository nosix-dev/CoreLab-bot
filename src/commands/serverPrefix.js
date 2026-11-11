const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guildPrefix = require('../core/guildPrefix');

const MOTS_RESET = ['reset', 'default', 'defaut', 'défaut'];

const data = new SlashCommandBuilder()
  .setName('prefix')
  .setDescription('🔧 Voir ou changer le préfixe des commandes texte du bot sur ce serveur')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o
    .setName('nouveau')
    .setDescription(`Nouveau préfixe (1 à ${guildPrefix.LONGUEUR_MAX} caractères, sans espace) — « reset » pour revenir à !`)
    .setMaxLength(10)
    .setRequired(false));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  const guildId = interaction.guild.id;
  const nouveau = interaction.options.getString('nouveau');
  const actuel = guildPrefix.get(guildId);

  // Sans argument : on affiche simplement le préfixe actuel.
  if (nouveau === null) {
    return interaction.reply({
      content: `🔧 Le préfixe actuel est **\`${actuel}\`** (ex. \`${actuel}help\`).\nPour le changer : \`/prefix nouveau:<préfixe>\` (1 à ${guildPrefix.LONGUEUR_MAX} caractères, sans espace).`,
      flags: MessageFlags.Ephemeral
    });
  }

  const perms = interaction.memberPermissions;
  if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur** pour changer le préfixe.', flags: MessageFlags.Ephemeral });
  }

  const valeur = MOTS_RESET.includes(nouveau.trim().toLowerCase()) ? guildPrefix.DEFAUT : nouveau.trim();
  const r = guildPrefix.set(guildId, valeur);
  if (!r.ok) {
    return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    content: `✅ Préfixe changé : **\`${r.prefix}\`** (ex. \`${r.prefix}help\`). Les slash commands ne changent pas.`,
    flags: MessageFlags.Ephemeral
  });
}

module.exports = { data, execute };