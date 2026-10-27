// ────────────────────────────────────────────────
// /candidature — MP aux responsables quand un membre « en attente » arrive
//   /candidature destinataire-ajouter <role>  → ce rôle reçoit le MP
//   /candidature destinataire-retirer <role>  → retire ce rôle des destinataires
//   /candidature acceptation [role]           → rôle donné au clic sur « Accepter » (vide = aucun)
//   /candidature statut <actif>               → active / désactive le système
//   /candidature liste                        → récapitulatif
// La logique est dans handlers/joinRequest.js
// ────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { persist } = require('../core/config');
const { lireConfigCandidature, MAX_ROLES } = require('../handlers/joinRequest');
const { verifierRole } = require('../handlers/autoRoleHandler');

const data = new SlashCommandBuilder()
  .setName('candidature')
  .setDescription('📥 MP aux responsables quand quelqu\'un postule pour rejoindre')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s
    .setName('destinataire-ajouter')
    .setDescription('Ajouter un rôle dont les membres reçoivent le MP')
    .addRoleOption(o => o.setName('role').setDescription('Rôle qui reçoit le MP').setRequired(true)))
  .addSubcommand(s => s
    .setName('destinataire-retirer')
    .setDescription('Retirer un rôle des destinataires')
    .addRoleOption(o => o.setName('role').setDescription('Rôle à retirer').setRequired(true)))
  .addSubcommand(s => s
    .setName('acceptation')
    .setDescription('Rôle donné quand un responsable clique sur Accepter')
    .addRoleOption(o => o.setName('role').setDescription('Rôle à donner (vide = aucun)')))
  .addSubcommand(s => s
    .setName('statut')
    .setDescription('Activer ou désactiver les candidatures par MP')
    .addBooleanOption(o => o.setName('actif').setDescription('Activer ?').setRequired(true)))
  .addSubcommand(s => s
    .setName('liste')
    .setDescription('Voir la configuration des candidatures'));

const repondre = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

async function execute(interaction) {
  if (!interaction.guild) return repondre(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  const cfg = lireConfigCandidature(guild.id);

  if (sub === 'destinataire-ajouter') {
    const role = interaction.options.getRole('role', true);
    if (role.id === guild.id) return repondre(interaction, '❌ @everyone ne peut pas être destinataire.');
    if (cfg.join_request_role_ids.includes(role.id)) return repondre(interaction, `ℹ️ **${role.name}** est déjà destinataire.`);
    if (cfg.join_request_role_ids.length >= MAX_ROLES) return repondre(interaction, `❌ Maximum ${MAX_ROLES} rôles.`);
    const etaitVide = cfg.join_request_role_ids.length === 0;
    cfg.join_request_role_ids.push(role.id);
    if (etaitVide) cfg.join_request_enabled = true;
    persist('configuration');
    return repondre(interaction, `✅ Les membres avec **${role.name}** recevront un MP à chaque candidature.${etaitVide ? '\n🟢 Système activé.' : ''}`);
  }

  if (sub === 'destinataire-retirer') {
    const role = interaction.options.getRole('role', true);
    if (!cfg.join_request_role_ids.includes(role.id)) return repondre(interaction, `ℹ️ **${role.name}** n'est pas destinataire.`);
    cfg.join_request_role_ids = cfg.join_request_role_ids.filter(id => id !== role.id);
    persist('configuration');
    return repondre(interaction, `🗑️ **${role.name}** retiré des destinataires.`);
  }

  if (sub === 'acceptation') {
    const role = interaction.options.getRole('role');
    if (!role) {
      cfg.join_request_accept_role_id = null;
      persist('configuration');
      return repondre(interaction, '🗑️ Aucun rôle ne sera donné à l\'acceptation.');
    }
    const erreur = verifierRole(guild, role, interaction.member);
    if (erreur) return repondre(interaction, `❌ ${erreur}`);
    cfg.join_request_accept_role_id = role.id;
    persist('configuration');
    return repondre(interaction, `✅ **${role.name}** sera donné quand un responsable clique sur **Accepter**.`);
  }

  if (sub === 'statut') {
    cfg.join_request_enabled = interaction.options.getBoolean('actif', true);
    persist('configuration');
    return repondre(interaction, cfg.join_request_enabled ? '🟢 Candidatures par MP activées.' : '⛔ Candidatures par MP désactivées.');
  }

  if (sub === 'liste') {
    const roles = cfg.join_request_role_ids.filter(id => guild.roles.cache.has(id)).map(id => `<@&${id}>`);
    const accept = cfg.join_request_accept_role_id && guild.roles.cache.has(cfg.join_request_accept_role_id)
      ? `<@&${cfg.join_request_accept_role_id}>` : '*aucun*';
    const embed = new EmbedBuilder()
      .setTitle('📥 Candidatures par MP')
      .setDescription([
        `**Statut :** ${cfg.join_request_enabled ? '🟢 Activé' : '⛔ Désactivé'}`,
        `**Destinataires :** ${roles.length ? roles.join(' ') : '*aucun*'}`,
        `**Rôle à l'acceptation :** ${accept}`,
      ].join('\n'))
      .setColor(0xFFFFFF);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

module.exports = { commands: [{ data, execute }] };
