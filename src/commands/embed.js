'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
    EMBED_NAME_REGEX,
    getEmbed,
    saveEmbed,
    deleteEmbed,
    listEmbeds,
    buildPanelPayload,
} = require('../core/embedManager');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Créer et gérer des embeds personnalisés réutilisables')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('créer')
            .setDescription('Créer un nouvel embed personnalisé')
            .addStringOption(o => o.setName('nom').setDescription('Nom court, sans espace (ex: bienvenue)').setRequired(true).setMaxLength(32)))
        .addSubcommand(sub => sub
            .setName('modifier')
            .setDescription('Rouvrir le panneau d\'édition d\'un embed existant')
            .addStringOption(o => o.setName('nom').setDescription('Nom de l\'embed').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('supprimer')
            .setDescription('Supprimer un embed personnalisé')
            .addStringOption(o => o.setName('nom').setDescription('Nom de l\'embed').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('liste')
            .setDescription('Lister les embeds personnalisés du serveur')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'liste') {
            const noms = listEmbeds(guildId);
            if (noms.length === 0) {
                return interaction.reply({
                    content: 'Aucun embed personnalisé sur ce serveur. Crée-en un avec `/embed create`.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            const liste = noms.map(n => `• \`${n}\` — référence : \`{embed:${n}}\``).join('\n');
            return interaction.reply({ content: `**Embeds personnalisés :**\n${liste}`, flags: MessageFlags.Ephemeral });
        }

        const nom = interaction.options.getString('nom').toLowerCase().trim();

        if (sub === 'créer') {
            if (!EMBED_NAME_REGEX.test(nom)) {
                return interaction.reply({
                    content: '❌ Nom invalide : lettres minuscules, chiffres, `-` et `_` uniquement (32 caractères max, sans espace).',
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (getEmbed(guildId, nom)) {
                return interaction.reply({
                    content: `❌ L'embed \`${nom}\` existe déjà. Utilise \`/embed edit nom:${nom}\` pour le modifier.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            saveEmbed(guildId, nom, {
                title: null, description: null, url: null, color: null,
                author: null, footer: null, thumbnail: null, image: null,
                mentions: [],
            });
            return interaction.reply(buildPanelPayload(guildId, nom));
        }

        if (sub === 'modifier') {
            if (!getEmbed(guildId, nom)) {
                return interaction.reply({ content: `❌ Aucun embed nommé \`${nom}\`. Vois \`/embed list\`.`, flags: MessageFlags.Ephemeral });
            }
            return interaction.reply(buildPanelPayload(guildId, nom));
        }

        if (sub === 'supprimer') {
            if (!getEmbed(guildId, nom)) {
                return interaction.reply({ content: `❌ Aucun embed nommé \`${nom}\`.`, flags: MessageFlags.Ephemeral });
            }
            deleteEmbed(guildId, nom);
            return interaction.reply({ content: `🗑️ Embed \`${nom}\` supprimé.`, flags: MessageFlags.Ephemeral });
        }
    },
};