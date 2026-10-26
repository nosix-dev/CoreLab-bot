'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const { toCV2Payload } = require('../core/componentsV2');
const { requirePremium } = require('../core/premium');
const { MAX_SAUVEGARDES_PREMIUM } = require('../core/constants');
const {
    genererIdBackup,
    capturerServeur,
    restaurerSurServeur,
    obtenirBackupsUtilisateur,
    obtenirBackup,
    ajouterBackup,
    supprimerBackup,
} = require('../handlers/backup');

const data = new SlashCommandBuilder()
    .setName('backup')
    .setDescription('💾 Sauvegarder ou restaurer la structure du serveur (rôles, catégories, salons)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
        .setName('create')
        .setDescription('⭐ Premium • Créer une backup du serveur (rôles, salons, permissions)')
        .addStringOption(o => o.setName('nom').setDescription('Nom donné à la backup').setMaxLength(64)))
    .addSubcommand(sub => sub
        .setName('load')
        .setDescription('⭐ Premium • Charger une backup et l\'appliquer à ce serveur')
        .addStringOption(o => o.setName('id').setDescription('Identifiant de la backup').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('list')
        .setDescription('⭐ Premium • Voir la liste de tes backups'))
    .addSubcommand(sub => sub
        .setName('delete')
        .setDescription('⭐ Premium • Supprimer une backup')
        .addStringOption(o => o.setName('id').setDescription('Identifiant de la backup').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('info')
        .setDescription('⭐ Premium • Voir les informations détaillées d\'une backup')
        .addStringOption(o => o.setName('id').setDescription('Identifiant de la backup').setRequired(true)));

async function handleCreate(interaction) {
    const userId = interaction.user.id;
    const max = MAX_SAUVEGARDES_PREMIUM;
    const backups = obtenirBackupsUtilisateur(userId);

    if (backups.length >= max) {
        return interaction.reply({
            content: `❌ Tu as atteint la limite de **${max}** backups.\nSupprime une backup existante avec \`/backup delete\` pour en créer une nouvelle.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const nom = (interaction.options.getString('nom') || interaction.guild.name).slice(0, 64);
    const contenu = capturerServeur(interaction.guild);
    const backup = {
        id: genererIdBackup(),
        name: nom,
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        ...contenu,
    };
    ajouterBackup(userId, backup);

    const embed = new EmbedBuilder()
        .setTitle('✅ Backup créée')
        .setColor(0xFFFFFF)
        .setDescription(`**${backup.name}**\nID : \`${backup.id}\`\n\nUtilise cet identifiant avec \`/backup load\` (même sur un autre serveur) pour l'appliquer.`)
        .addFields(
            { name: 'Rôles', value: String(contenu.roles.length), inline: true },
            { name: 'Catégories', value: String(contenu.categories.length), inline: true },
            { name: 'Salons', value: String(contenu.channels.length), inline: true },
        )
        .setFooter({ text: `${backups.length}/${max} backups utilisées` });

    return interaction.editReply(toCV2Payload({ embeds: [embed] }));
}

async function handleList(interaction) {
    const backups = obtenirBackupsUtilisateur(interaction.user.id);
    if (!backups.length) {
        return interaction.reply({
            content: 'ℹ️ Tu n\'as aucune backup enregistrée. Utilise `/backup create` pour en créer une.',
            flags: MessageFlags.Ephemeral,
        });
    }

    const lignes = backups.map(b => `\`${b.id}\` — **${b.name}** (origine : ${b.guildName}) — <t:${Math.floor(new Date(b.createdAt).getTime() / 1000)}:d>`);
    const embed = new EmbedBuilder()
        .setTitle('💾 Tes backups')
        .setColor(0xFFFFFF)
        .setDescription(lignes.join('\n').slice(0, 4000));

    return interaction.reply(toCV2Payload({ embeds: [embed], flags: MessageFlags.Ephemeral }));
}

async function handleInfo(interaction) {
    const id = interaction.options.getString('id').trim();
    const backup = obtenirBackup(interaction.user.id, id);
    if (!backup) {
        return interaction.reply({ content: '❌ Backup introuvable (vérifie l\'identifiant).', flags: MessageFlags.Ephemeral });
    }

    const apercuRoles = backup.roles.slice(0, 20).map(r => r.name).join(', ') || 'Aucun';
    const embed = new EmbedBuilder()
        .setTitle(`💾 ${backup.name}`)
        .setColor(0xFFFFFF)
        .addFields(
            { name: 'ID', value: `\`${backup.id}\``, inline: true },
            { name: 'Serveur d\'origine', value: backup.guildName, inline: true },
            { name: 'Créée le', value: `<t:${Math.floor(new Date(backup.createdAt).getTime() / 1000)}:F>`, inline: true },
            { name: 'Rôles', value: String(backup.roles.length), inline: true },
            { name: 'Catégories', value: String(backup.categories.length), inline: true },
            { name: 'Salons', value: String(backup.channels.length), inline: true },
            { name: 'Aperçu des rôles', value: apercuRoles.length > 1000 ? `${apercuRoles.slice(0, 1000)}…` : apercuRoles },
        );

    return interaction.reply(toCV2Payload({ embeds: [embed], flags: MessageFlags.Ephemeral }));
}

async function handleDelete(interaction) {
    const id = interaction.options.getString('id').trim();
    const ok = supprimerBackup(interaction.user.id, id);
    return interaction.reply({
        content: ok ? `✅ Backup \`${id}\` supprimée.` : '❌ Backup introuvable (vérifie l\'identifiant).',
        flags: MessageFlags.Ephemeral,
    });
}

async function handleLoad(interaction) {
    const id = interaction.options.getString('id').trim();
    const backup = obtenirBackup(interaction.user.id, id);
    if (!backup) {
        return interaction.reply({ content: '❌ Backup introuvable (vérifie l\'identifiant).', flags: MessageFlags.Ephemeral });
    }

    const bot = interaction.guild.members.me;
    if (!bot?.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ CoreLab a besoin de la permission **Administrateur** sur ce serveur pour restaurer une backup.',
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const totalElements = backup.roles.length + backup.categories.length + backup.channels.length;
    await interaction.editReply({ content: `⏳ Restauration de **${backup.name}** en cours (${totalElements} éléments à créer/vérifier)... Cela peut prendre un moment, ne quitte pas.` });

    const stats = await restaurerSurServeur(interaction.guild, backup);

    const embed = new EmbedBuilder()
        .setTitle('✅ Backup restaurée')
        .setColor(0xFFFFFF)
        .setDescription(`**${backup.name}** (originaire de *${backup.guildName}*) a été appliquée à **${interaction.guild.name}**.\nAucun rôle/salon existant n'a été supprimé (mode additif).`)
        .addFields(
            { name: 'Rôles créés', value: String(stats.rolesCreated), inline: true },
            { name: 'Rôles réutilisés', value: String(stats.rolesReused), inline: true },
            { name: 'Catégories créées', value: String(stats.categoriesCreated), inline: true },
            { name: 'Salons créés', value: String(stats.channelsCreated), inline: true },
        )
        .setFooter({ text: 'ℹ️ Les positions des rôles peuvent nécessiter un réajustement manuel.' });

    if (stats.errors.length) {
        embed.addFields({ name: `⚠️ Erreurs (${stats.errors.length})`, value: stats.errors.slice(0, 10).join('\n').slice(0, 1000) });
    }

    return interaction.editReply({ ...toCV2Payload({ embeds: [embed] }), content: null });
}

async function execute(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: '❌ Cette commande doit être utilisée sur un serveur.', flags: MessageFlags.Ephemeral });
    }
    // 🔒 /backup est une fonctionnalité 100% Premium — aucun palier gratuit.
    const ok = await requirePremium(interaction);
    if (!ok) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return handleCreate(interaction);
    if (sub === 'load') return handleLoad(interaction);
    if (sub === 'list') return handleList(interaction);
    if (sub === 'delete') return handleDelete(interaction);
    if (sub === 'info') return handleInfo(interaction);
}

module.exports = { data, execute };