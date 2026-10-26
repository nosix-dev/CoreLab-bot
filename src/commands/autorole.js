// ────────────────────────────────────────────────
// /autorole — configuration de l'autorôle à l'arrivée
//   /autorole ajouter <role> [cible]   → ajoute un rôle (membres ou bots)
//   /autorole supprimer <role>         → retire un rôle de la liste
//   /autorole statut <actif>           → active / désactive l'autorôle
//   /autorole delai <secondes>         → délai avant l'attribution (0 à 3600)
//   /autorole validation <attendre>    → attendre la validation du règlement Discord
//   /autorole liste                    → récapitulatif de la configuration
// La logique d'attribution est dans handlers/autoRole.js
// ────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { persist } = require('../core/config');
const { toCV2Payload } = require('../core/componentsV2');
const {
  lireConfigAutoRole,
  verifierRole,
  MAX_ROLES,
  MAX_DELAI_SECONDES,
} = require('../handlers/autoRoleHandler');

const data = new SlashCommandBuilder()
  .setName('autorole')
  .setDescription('🎭 Rôles donnés automatiquement aux nouveaux membres')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s
    .setName('ajouter')
    .setDescription('Ajouter un rôle donné à l\'arrivée')
    .addRoleOption(o => o.setName('role').setDescription('Rôle à donner').setRequired(true))
    .addStringOption(o => o
      .setName('cible')
      .setDescription('Pour qui ? (par défaut : les membres)')
      .addChoices(
        { name: 'Membres', value: 'membres' },
        { name: 'Bots', value: 'bots' },
      )))
  .addSubcommand(s => s
    .setName('supprimer')
    .setDescription('Retirer un rôle de l\'autorôle')
    .addRoleOption(o => o.setName('role').setDescription('Rôle à retirer de la liste').setRequired(true)))
  .addSubcommand(s => s
    .setName('statut')
    .setDescription('Activer ou désactiver l\'autorôle')
    .addBooleanOption(o => o.setName('actif').setDescription('Activer l\'autorôle ?').setRequired(true)))
  .addSubcommand(s => s
    .setName('delai')
    .setDescription('Délai avant de donner le rôle aux nouveaux membres')
    .addIntegerOption(o => o
      .setName('secondes')
      .setDescription(`Délai en secondes (0 = immédiat, max ${MAX_DELAI_SECONDES})`)
      .setMinValue(0)
      .setMaxValue(MAX_DELAI_SECONDES)
      .setRequired(true)))
  .addSubcommand(s => s
    .setName('validation')
    .setDescription('Attendre que le membre valide le règlement Discord')
    .addBooleanOption(o => o
      .setName('attendre')
      .setDescription('Donner le rôle seulement après validation du règlement ?')
      .setRequired(true)))
  .addSubcommand(s => s
    .setName('liste')
    .setDescription('Voir la configuration de l\'autorôle'));

const repondre = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

function formaterRoles(guild, ids) {
  const existants = ids.filter(id => guild.roles.cache.has(id));
  return existants.length ? existants.map(id => `<@&${id}>`).join(' ') : '*aucun*';
}

async function execute(interaction) {
  if (!interaction.guild) {
    return repondre(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  }
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  const cfg = lireConfigAutoRole(guild.id);

  // ── ajouter ──
  if (sub === 'ajouter') {
    const role = interaction.options.getRole('role', true);
    const cible = interaction.options.getString('cible') || 'membres';
    const cle = cible === 'bots' ? 'autorole_bot_role_ids' : 'autorole_role_ids';

    const erreur = verifierRole(guild, role, interaction.member);
    if (erreur) return repondre(interaction, `❌ ${erreur}`);
    if (cfg[cle].includes(role.id)) {
      return repondre(interaction, `ℹ️ Le rôle **${role.name}** est déjà dans la liste (${cible}).`);
    }
    if (cfg[cle].length >= MAX_ROLES) {
      return repondre(interaction, `❌ Maximum ${MAX_ROLES} rôles par liste. Retire-en un avec \`/autorole supprimer\`.`);
    }

    const etaitVide = cfg.autorole_role_ids.length === 0 && cfg.autorole_bot_role_ids.length === 0;
    cfg[cle].push(role.id);
    // Premier rôle configuré : on active l'autorôle automatiquement.
    if (etaitVide) cfg.autorole_enabled = true;
    persist('configuration');

    let msg = `✅ **${role.name}** sera donné ${cible === 'bots' ? 'aux **bots**' : 'aux **nouveaux membres**'} à leur arrivée.`;
    if (etaitVide) msg += '\n🟢 L\'autorôle a été activé.';
    else if (!cfg.autorole_enabled) msg += '\n⚠️ L\'autorôle est désactivé : active-le avec `/autorole statut`.';
    return repondre(interaction, msg);
  }

  // ── supprimer ──
  if (sub === 'supprimer') {
    const role = interaction.options.getRole('role', true);
    const avant = cfg.autorole_role_ids.length + cfg.autorole_bot_role_ids.length;
    cfg.autorole_role_ids = cfg.autorole_role_ids.filter(id => id !== role.id);
    cfg.autorole_bot_role_ids = cfg.autorole_bot_role_ids.filter(id => id !== role.id);
    const apres = cfg.autorole_role_ids.length + cfg.autorole_bot_role_ids.length;
    if (avant === apres) {
      return repondre(interaction, `ℹ️ Le rôle **${role.name}** n'est pas dans l'autorôle.`);
    }
    persist('configuration');
    return repondre(interaction, `✅ **${role.name}** n'est plus donné automatiquement.`);
  }

  // ── statut ──
  if (sub === 'statut') {
    const actif = interaction.options.getBoolean('actif', true);
    cfg.autorole_enabled = actif;
    persist('configuration');
    if (actif && !cfg.autorole_role_ids.length && !cfg.autorole_bot_role_ids.length) {
      return repondre(interaction, '🟢 Autorôle activé, mais aucun rôle n\'est configuré. Ajoute-en un avec `/autorole ajouter`.');
    }
    return repondre(interaction, actif ? '🟢 Autorôle **activé**.' : '⛔ Autorôle **désactivé**.');
  }

  // ── delai ──
  if (sub === 'delai') {
    const secondes = interaction.options.getInteger('secondes', true);
    cfg.autorole_delay_seconds = secondes;
    persist('configuration');
    return repondre(interaction, secondes === 0
      ? '✅ Les rôles seront donnés **immédiatement** à l\'arrivée.'
      : `✅ Les rôles seront donnés **${secondes} seconde(s)** après l'arrivée.`);
  }

  // ── validation ──
  if (sub === 'validation') {
    const attendre = interaction.options.getBoolean('attendre', true);
    cfg.autorole_wait_screening = attendre;
    persist('configuration');
    return repondre(interaction, attendre
      ? '✅ Si ton serveur utilise le règlement / l\'écran d\'accueil Discord, le rôle sera donné **après validation**.'
      : '✅ Le rôle sera donné **dès l\'arrivée**, sans attendre la validation du règlement.');
  }

  // ── liste ──
  if (sub === 'liste') {
    const avertissements = [];
    if (cfg.auth_enabled) {
      avertissements.push('⚠️ Le système d\'authentification est actif : l\'autorôle est **suspendu pour les membres** (les bots reçoivent quand même leurs rôles).');
    }
    const tousLesIds = [...new Set([...cfg.autorole_role_ids, ...cfg.autorole_bot_role_ids])];
    for (const id of tousLesIds) {
      const role = guild.roles.cache.get(id);
      if (!role) continue;
      const probleme = verifierRole(guild, role);
      if (probleme) avertissements.push(`⚠️ ${probleme}`);
    }

    const lignes = [
      `**Statut :** ${cfg.autorole_enabled ? '🟢 Activé' : '⛔ Désactivé'}`,
      `**Rôles membres :** ${formaterRoles(guild, cfg.autorole_role_ids)}`,
      `**Rôles bots :** ${formaterRoles(guild, cfg.autorole_bot_role_ids)}`,
      `**Délai :** ${cfg.autorole_delay_seconds > 0 ? `${cfg.autorole_delay_seconds} s` : 'immédiat'}`,
      `**Attendre la validation du règlement :** ${cfg.autorole_wait_screening ? 'oui' : 'non'}`,
    ];
    if (avertissements.length) lignes.push('', ...avertissements);

    const embed = new EmbedBuilder()
      .setTitle('🎭 Autorôle à l\'arrivée')
      .setDescription(lignes.join('\n'))
      .setColor(0xFFFFFF);
    return interaction.reply(toCV2Payload({ embeds: [embed], ephemeral: true }));
  }
}

module.exports = { commands: [{ data, execute }] };