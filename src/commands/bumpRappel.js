// ────────────────────────────────────────────────
// /bump-rappel — configuration du rappel de bump Disboard
//   /bump-rappel activer [salon] [role] [remerciement]
//   /bump-rappel desactiver
//   /bump-rappel statut
// La logique de détection / de rappel est dans handlers/bumpReminder.js
// ────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { persist } = require('../core/config');
const { toCV2Payload } = require('../core/componentsV2');
const { lireConfigBump, DISBOARD_ID } = require('../handlers/bumpReminder');

const data = new SlashCommandBuilder()
  .setName('bump-rappel')
  .setDescription('🔔 Rappel automatique du bump Disboard (toutes les 2 heures)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s
    .setName('activer')
    .setDescription('Activer ou modifier le rappel de bump')
    .addChannelOption(o => o
      .setName('salon')
      .setDescription('Salon du rappel (par défaut : le salon du dernier /bump)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(o => o.setName('role').setDescription('Rôle à mentionner pour le rappel'))
    .addBooleanOption(o => o
      .setName('remerciement')
      .setDescription('Remercier la personne après un bump ? (par défaut : oui)')))
  .addSubcommand(s => s
    .setName('desactiver')
    .setDescription('Désactiver le rappel de bump'))
  .addSubcommand(s => s
    .setName('statut')
    .setDescription('Voir l\'état du rappel et les stats de bump'));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  const cfg = lireConfigBump(guild.id);

  // ── activer ──
  if (sub === 'activer') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const salon = interaction.options.getChannel('salon');
    const role = interaction.options.getRole('role');
    const remerciement = interaction.options.getBoolean('remerciement');

    if (salon) cfg.bump_channel_id = salon.id;
    if (role) cfg.bump_role_id = role.id;
    if (remerciement !== null) cfg.bump_thanks = remerciement;
    cfg.bump_enabled = true;
    persist('configuration');

    const me = guild.members.me;
    const avertissements = [];

    const idSalon = cfg.bump_channel_id;
    if (idSalon) {
      const salonCfg = guild.channels.cache.get(idSalon);
      const perms = salonCfg && me ? salonCfg.permissionsFor(me) : null;
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        avertissements.push(`⚠️ Je ne peux pas écrire dans <#${idSalon}> : donne-moi les permissions « Voir le salon » et « Envoyer des messages ».`);
      }
    }
    const roleCfg = cfg.bump_role_id ? guild.roles.cache.get(cfg.bump_role_id) : null;
    if (roleCfg && !roleCfg.mentionable && !me?.permissions.has(PermissionFlagsBits.MentionEveryone)) {
      avertissements.push(`⚠️ Le rôle **${roleCfg.name}** n'est pas mentionnable : rends-le mentionnable ou donne-moi la permission « Mentionner @everyone, @here et tous les rôles », sinon il ne sera pas notifié.`);
    }
    const disboard = await guild.members.fetch(DISBOARD_ID).catch(() => null);
    if (!disboard) {
      avertissements.push('⚠️ Je ne vois pas **Disboard** sur ce serveur : invite-le (disboard.org) pour que les bumps soient détectés.');
    }

    const lignes = [
      '✅ Rappel de bump **activé**.',
      `• Salon du rappel : ${cfg.bump_channel_id ? `<#${cfg.bump_channel_id}>` : 'le salon où le dernier `/bump` a été fait'}`,
      `• Rôle mentionné : ${cfg.bump_role_id ? `<@&${cfg.bump_role_id}>` : 'aucun'}`,
      `• Remerciement après un bump : ${cfg.bump_thanks ? 'oui' : 'non'}`,
      '',
      'Fais un `/bump` pour lancer le premier minuteur (si le bump est trop tôt, Disboard indique le temps restant et le minuteur s\'y cale tout seul).',
      ...(avertissements.length ? ['', ...avertissements] : []),
    ];
    return interaction.editReply({ content: lignes.join('\n') });
  }

  // ── desactiver ──
  if (sub === 'desactiver') {
    cfg.bump_enabled = false;
    cfg.bump_next_at = 0;
    cfg.bump_reminded = false;
    cfg.bump_channel_id = null;
    cfg.bump_role_id = null;
    persist('configuration');
    return interaction.reply({
      content: '⛔ Rappel de bump **désactivé** (salon et rôle remis à zéro, les stats de bump sont conservées).',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── statut ──
  if (sub === 'statut') {
    let prochain;
    if (!cfg.bump_enabled) prochain = '—';
    else if (!cfg.bump_next_at) prochain = 'en attente d\'un premier `/bump`';
    else if (cfg.bump_reminded) prochain = 'rappel déjà envoyé, bump disponible';
    else if (Date.now() >= cfg.bump_next_at) prochain = 'disponible maintenant';
    else prochain = `<t:${Math.floor(cfg.bump_next_at / 1000)}:R>`;

    const top = Object.entries(cfg.bump_users)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n], i) => `${i + 1}. <@${id}> — ${n} bump${n > 1 ? 's' : ''}`);

    const lignes = [
      `**Statut :** ${cfg.bump_enabled ? '🟢 Activé' : '⛔ Désactivé'}`,
      `**Salon du rappel :** ${cfg.bump_channel_id ? `<#${cfg.bump_channel_id}>` : 'salon du dernier `/bump`'}`,
      `**Rôle mentionné :** ${cfg.bump_role_id ? `<@&${cfg.bump_role_id}>` : 'aucun'}`,
      `**Remerciement :** ${cfg.bump_thanks ? 'oui' : 'non'}`,
      `**Prochain bump :** ${prochain}`,
      `**Bumps comptés :** ${cfg.bump_count}`,
    ];
    if (top.length) lignes.push('', '**Top bumpeurs**', ...top);

    const embed = new EmbedBuilder()
      .setTitle('🔔 Rappel de bump')
      .setDescription(lignes.join('\n'))
      .setColor(0xFFFFFF);
    return interaction.reply(toCV2Payload({ embeds: [embed], ephemeral: true }));
  }
}

module.exports = { commands: [{ data, execute }] };
