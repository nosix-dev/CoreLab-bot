// /audit : audit de sécurité du serveur (score /100, catégories, problèmes détectés, boutons Détails / Actualiser).
// /journal : journal d'audit complet.
//   /journal voir     [acteur] [cible] [type] [jours]   → consulter (pages avec ◀ ▶)
//   /journal stats    [jours]                           → qui fait quoi, répartition par type
//   /journal export   [format] [acteur] [cible] [type] [jours] → fichier CSV (Excel) ou JSON
//   /journal permissions-ia                             → audit des permissions de l'assistant IA (lecture seule)
// Réponses éphémères. /audit : « Gérer le serveur » · /journal : « Voir les logs du serveur ».
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const journal = require('../core/auditJournal');
const { construireRapport: rapportPermissionsIa } = require('../core/auditPermissionsIa');
const securite = require('../core/securityAudit');

const choixTypes = Object.entries(journal.TYPES).map(([value, name]) => ({ name, value }));

function ajouterFiltres(sub) {
  return sub
    .addUserOption(o => o.setName('acteur').setDescription('Personne qui a fait l\'action'))
    .addUserOption(o => o.setName('cible').setDescription('Personne concernée par l\'action'))
    .addStringOption(o => o.setName('type').setDescription('Type d\'action').addChoices(...choixTypes))
    .addIntegerOption(o => o.setName('jours').setDescription('Limiter aux X derniers jours (1 à 90)').setMinValue(1).setMaxValue(90));
}

function lireFiltres(interaction) {
  return {
    actorId: interaction.options.getUser('acteur')?.id,
    targetId: interaction.options.getUser('cible')?.id,
    type: interaction.options.getString('type') || undefined,
    jours: interaction.options.getInteger('jours') || undefined,
  };
}

const journalCmd = {
  data: new SlashCommandBuilder()
    .setName('journal')
    .setDescription('Journal d\'audit complet : qui a fait quoi, et quand')
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
    .addSubcommand(s => ajouterFiltres(s.setName('voir').setDescription('Consulter le journal d\'audit')))
    .addSubcommand(s => s.setName('stats').setDescription('Résumé : actions les plus fréquentes et personnes les plus actives')
      .addIntegerOption(o => o.setName('jours').setDescription('Période en jours (défaut : 7)').setMinValue(1).setMaxValue(90)))
    .addSubcommand(s => ajouterFiltres(s.setName('export').setDescription('Exporter le journal en fichier'))
      .addStringOption(o => o.setName('format').setDescription('Format du fichier (défaut : CSV pour Excel)')
        .addChoices({ name: 'CSV (Excel)', value: 'csv' }, { name: 'JSON', value: 'json' })))
    .addSubcommand(s => s.setName('permissions-ia').setDescription('Auditer les permissions de l\'assistant IA (salons, bot, accès)')),

  async execute(interaction) {
    const ephemere = { flags: MessageFlags.Ephemeral };
    if (!interaction.guild) return interaction.reply({ content: '❌ Cette commande fonctionne uniquement dans un serveur.', ...ephemere });
    if (!journal.estAutorise(interaction)) return interaction.reply({ content: '❌ Réservé aux personnes qui peuvent voir le journal d\'audit.', ...ephemere });

    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      return interaction.reply({ ...journal.construirePage(interaction.guild.id, lireFiltres(interaction), 1), ...ephemere });
    }

    if (sub === 'stats') {
      const jours = interaction.options.getInteger('jours') || 7;
      const s = journal.statistiques(interaction.guild.id, jours);
      if (!s.total) return interaction.reply({ content: `ℹ️ Aucune entrée sur les ${jours} derniers jours.`, ...ephemere });
      const liste = (items, fmt) => items.map(([k, n], i) => `${i + 1}. ${fmt(k)} — **${n}**`).join('\n') || '—';
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 Journal d'audit — ${jours} dernier(s) jour(s)`)
        .setDescription(`**${s.total}** action(s) enregistrée(s)`)
        .addFields(
          { name: '👤 Les plus actifs', value: liste(s.acteurs, k => (k === 'discord' ? 'Discord' : `<@${k}>`)) },
          { name: '🗂️ Par type', value: liste(s.types, k => journal.TYPES[k] || k) },
          { name: '🔥 Actions fréquentes', value: liste(s.actions, k => k) },
        );
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, ...ephemere });
    }

    if (sub === 'permissions-ia') {
      return interaction.reply({ embeds: [rapportPermissionsIa(interaction.guild)], allowedMentions: { parse: [] }, ...ephemere });
    }

    if (sub === 'export') {
      const format = interaction.options.getString('format') || 'csv';
      const { contenu, extension, nombre } = journal.exporter(interaction.guild.id, lireFiltres(interaction), format);
      if (!nombre) return interaction.reply({ content: 'ℹ️ Aucune entrée à exporter avec ces filtres.', ...ephemere });
      const nom = `audit-${interaction.guild.id}-${new Date().toISOString().slice(0, 10)}.${extension}`;
      return interaction.reply({
        content: `📁 Export du journal d'audit : **${nombre}** entrée(s).`,
        files: [new AttachmentBuilder(Buffer.from(contenu, 'utf-8'), { name: nom })],
        ...ephemere,
      });
    }
  },
};

// ── /audit : audit de sécurité ─────────────────────────────────────────────
const audit = {
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Audit de sécurité du serveur : score, problèmes détectés et conseils')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const ephemere = { flags: MessageFlags.Ephemeral };
    if (!interaction.guild) return interaction.reply({ content: '❌ Cette commande fonctionne uniquement dans un serveur.', ...ephemere });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur**.', ...ephemere });
    }
    await interaction.deferReply(ephemere);
    return interaction.editReply(securite.construireAccueil(interaction.guild, securite.analyser(interaction.guild)));
  },
};

// Boutons : « secaudit:refresh » · « secaudit:home » · « secaudit:detail:<catégorie> »
async function routeSecAuditInteraction(interaction) {
  if (!interaction.guild) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur**.', flags: MessageFlags.Ephemeral });
  }
  const [, action, cle] = interaction.customId.split(':');
  await interaction.deferUpdate();
  const res = securite.analyser(interaction.guild);
  if (action === 'detail') return interaction.editReply(securite.construireDetail(interaction.guild, res, cle));
  return interaction.editReply(securite.construireAccueil(interaction.guild, res));
}

module.exports = [audit, journalCmd];
module.exports.routeSecAuditInteraction = routeSecAuditInteraction;