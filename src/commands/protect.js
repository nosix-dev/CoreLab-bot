const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const {
  getGuildConfig
} = require('../core/config');
const { buildProtectPayload } = require('../core/protectCard');
const {
  toCV2Payload
} = require("../core/componentsV2");
function makeCommand(name, description, builder, execute, perms = null) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  if (builder) builder(data);
  if (perms) data.setDefaultMemberPermissions(perms);
  return {
    data,
    execute
  };
}
const protectSettings = makeCommand('protect-settings', '🛡️ Panneau de configuration du système de protection', null, async interaction => {
  return interaction.reply({
    ...buildProtectPayload(interaction.guild),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}, PermissionFlagsBits.ManageGuild);
const report = makeCommand('report', '🚩 Signaler un membre au staff', data => data.addUserOption(o => o.setName('membre').setDescription('Membre à signaler').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison du signalement').setRequired(true)), async interaction => {
  const cfg = getGuildConfig(interaction.guild.id);
  if (!cfg.signalement_enabled || !cfg.signalement_channel_id) {
    return interaction.reply({
      content: '❌ Les signalements ne sont pas activés sur ce serveur.',
      flags: MessageFlags.Ephemeral
    });
  }
  const channel = interaction.guild.channels.cache.get(String(cfg.signalement_channel_id));
  if (!channel?.isTextBased?.()) {
    return interaction.reply({
      content: '❌ Le salon de signalement configuré est introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  const membre = interaction.options.getUser('membre');
  const raison = interaction.options.getString('raison').trim();
  if (membre.id === interaction.user.id) {
    return interaction.reply({
      content: '❌ Tu ne peux pas te signaler toi-même.',
      flags: MessageFlags.Ephemeral
    });
  }
  const embed = new EmbedBuilder().setTitle('🚩 Nouveau signalement').addFields({
    name: 'Signalé',
    value: `${membre} (\`${membre.id}\`)`,
    inline: true
  }, {
    name: 'Signalé par',
    value: `${interaction.user} (\`${interaction.user.id}\`)`,
    inline: true
  }, {
    name: 'Salon',
    value: `${interaction.channel}`,
    inline: true
  }, {
    name: 'Raison',
    value: raison.slice(0, 1000)
  }).setColor(0xff0000).setThumbnail(membre.displayAvatarURL()).setTimestamp();
  await channel.send(toCV2Payload({
    embeds: [embed]
  })).catch(() => {});
  return interaction.reply({
    content: '✅ Signalement envoyé au staff. Merci !',
    flags: MessageFlags.Ephemeral
  });
});
// protectSettings est de nouveau une commande top-level : /protect-settings.
// report reste une commande indépendante (utilisée par les membres, pas un réglage admin).
module.exports = { commands: [protectSettings, report], protectSettingsCmd: protectSettings };