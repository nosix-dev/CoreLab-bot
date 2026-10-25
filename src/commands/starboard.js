const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const {
  buildStarboardPayload
} = require('../handlers/starboard');
function makeCommand(name, description, builder, execute, perms = null) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  if (builder) builder(data);
  if (perms) data.setDefaultMemberPermissions(perms);
  return {
    data,
    execute
  };
}
const starboardSettings = makeCommand('starboard-settings', '✩ Panneau de configuration du StarBoard', null, async interaction => {
  const payload = buildStarboardPayload(interaction.guild);
  return interaction.reply({
    ...payload,
    flags: payload.flags | MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.ManageGuild);
// N'est plus enregistrée en top-level : absorbée dans /settings starboard (voir extended.js).
module.exports = { starboardSettingsCmd: starboardSettings };