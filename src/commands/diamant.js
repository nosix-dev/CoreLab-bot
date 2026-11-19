'use strict';

const path = require('path');
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    AttachmentBuilder,
    MessageFlags,
} = require('discord.js');
const { t } = require('../core/i18n');
const {
    getDiamant,
    createDiamant,
    nourishDiamant,
    polishDiamant,
    claimDaily,
    getStage,
} = require('../core/diamant');
const { DIAMANT_CONSTANTES: C } = require('../core/diamantConstants');
const { stockage } = require('../core/data');

const data = new SlashCommandBuilder()
    .setName('diamant')
    .setDescription('Gérer ta mascotte diamant')
    .setDMPermission(false)
    .addSubcommandGroup(group => group
        .setName('mascotte')
        .setDescription('Créer ou prendre soin de ta mascotte')
        .addSubcommand(sub => sub
            .setName('creer')
            .setDescription('Créer ton diamant')
            .addStringOption(option => option.setName('prenom').setDescription('Prénom du diamant').setRequired(true).setMaxLength(C.NOM_MAX))
            .addStringOption(option => option
                .setName('temperament')
                .setDescription('Tempérament')
                .setRequired(true)
                .addChoices(...C.TEMPERAMENTS.map(value => ({ name: value, value })))))
        .addSubcommand(sub => sub.setName('nourrir').setDescription('Nourrir ton diamant avec des éclats de carbone'))
        .addSubcommand(sub => sub.setName('polir').setDescription('Polir ton diamant'))
        .addSubcommand(sub => sub
            .setName('profil')
            .setDescription('Afficher ton diamant')
            .addUserOption(option => option.setName('membre').setDescription('Membre à consulter'))))
    .addSubcommandGroup(group => group
        .setName('recompenses')
        .setDescription('Récompenses quotidiennes')
        .addSubcommand(sub => sub.setName('daily').setDescription('Récupérer ta récompense quotidienne'))
        .addSubcommand(sub => sub.setName('classement').setDescription('Afficher le classement des mascottes')));

function remainingText(ms, guildId) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function stageAttachment(d) {
    const stage = getStage(d);
    const file = path.join(__dirname, '..', '..', stage.svg);
    return new AttachmentBuilder(file, { name: `diamant-stage-${stage.niveau}.svg` });
}

function profileEmbed(interaction, d) {
    const guildId = interaction.guildId;
    const stage = getStage(d);
    return new EmbedBuilder()
        .setTitle(t(guildId, 'diamant_profile_title'))
        .setColor(0xe8510d)
        .setThumbnail(`attachment://diamant-stage-${stage.niveau}.svg`)
        .addFields(
            { name: d.name, value: d.temperament, inline: false },
            { name: t(guildId, 'diamant_stage'), value: stage.nom, inline: true },
            { name: t(guildId, 'diamant_level'), value: String(d.level), inline: true },
            { name: t(guildId, 'diamant_mood'), value: `${d.mood}/100`, inline: true },
            { name: t(guildId, 'diamant_gems'), value: String(d.gems), inline: true },
            { name: t(guildId, 'diamant_xp'), value: String(d.xp), inline: true },
        );
}

async function execute(interaction) {
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (group === 'mascotte' && sub === 'creer') {
        const name = interaction.options.getString('prenom').trim();
        const temperament = interaction.options.getString('temperament');
        const result = createDiamant(interaction.user.id, temperament, name);
        if (!result.ok) {
            const key = result.reason === 'exists' ? 'diamant_exists' : 'diamant_name_invalid';
            return interaction.reply({ content: t(guildId, key), flags: MessageFlags.Ephemeral });
        }
        const d = result.diamant;
        const embed = profileEmbed(interaction, d);
        return interaction.reply({
            content: t(guildId, 'diamant_created', { name: d.name, temperament: d.temperament }),
            embeds: [embed],
            files: [stageAttachment(d)],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (group === 'mascotte' && sub === 'nourrir') {
        const d = getDiamant(interaction.user.id);
        if (!d) return interaction.reply({ content: t(guildId, 'diamant_missing'), flags: MessageFlags.Ephemeral });
        const result = nourishDiamant(interaction.user.id);
        if (!result.ok) {
            const key = result.reason === 'missing' ? 'diamant_missing'
                : result.reason === 'daily_limit' ? 'diamant_daily_limit'
                : result.reason === 'carbon' ? 'diamant_no_carbon'
                : 'diamant_cooldown';
            const text = key === 'diamant_cooldown'
                ? t(guildId, key, { remaining: remainingText(result.remaining, guildId) })
                : t(guildId, key);
            return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
        }
        let extra = '';
        if (result.event === 'sparkle' || result.event === 'sparkle_gold') extra += `\n${t(guildId, 'diamant_sparkle')}`;
        if (result.event === 'gold' || result.event === 'sparkle_gold') extra += `\n${t(guildId, 'diamant_gold')}`;
        const embed = profileEmbed(interaction, result.diamant);
        return interaction.reply({
            content: t(guildId, 'diamant_nourished', { name: result.diamant.name, xp: result.xp }) + extra,
            embeds: [embed],
            files: [stageAttachment(result.diamant)],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (group === 'mascotte' && sub === 'polir') {
        const d = getDiamant(interaction.user.id);
        if (!d) return interaction.reply({ content: t(guildId, 'diamant_missing'), flags: MessageFlags.Ephemeral });
        const result = polishDiamant(interaction.user.id);
        if (!result.ok) {
            const key = result.reason === 'daily_limit' ? 'diamant_daily_limit'
                : result.reason === 'cooldown' ? 'diamant_cooldown'
                : 'diamant_missing';
            const text = key === 'diamant_cooldown'
                ? t(guildId, key, { remaining: remainingText(result.remaining, guildId) })
                : t(guildId, key);
            return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            content: t(guildId, 'diamant_polished', { name: result.diamant.name, mood: C.POLIR.MOOD, gems: C.POLIR.GEMMES }),
            embeds: [profileEmbed(interaction, result.diamant)],
            files: [stageAttachment(result.diamant)],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (group === 'mascotte' && sub === 'profil') {
        const target = interaction.options.getUser('membre') || interaction.user;
        const d = getDiamant(target.id);
        if (!d) return interaction.reply({ content: t(guildId, 'diamant_missing'), flags: MessageFlags.Ephemeral });
        return interaction.reply({
            embeds: [profileEmbed(interaction, d)],
            files: [stageAttachment(d)],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (group === 'recompenses' && sub === 'daily') {
        const result = claimDaily(interaction.user.id);
        if (!result.ok) {
            const key = result.reason === 'missing' ? 'diamant_missing'
                : result.reason === 'cooldown' ? 'diamant_cooldown'
                : 'diamant_missing';
            const text = key === 'diamant_cooldown'
                ? t(guildId, key, { remaining: remainingText(result.remaining, guildId) })
                : t(guildId, key);
            return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            content: t(guildId, 'diamant_daily', { gems: result.gems, streak: result.diamant.streak }),
            embeds: [profileEmbed(interaction, result.diamant)],
            files: [stageAttachment(result.diamant)],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (group === 'recompenses' && sub === 'classement') {
        const rows = Object.entries(stockage.diamants)
            .map(([id, d]) => ({ id, d }))
            .sort((a, b) => b.d.xp - a.d.xp || b.d.gems - a.d.gems)
            .slice(0, 10);
        const lines = rows.length
            ? await Promise.all(rows.map(async (row, index) => {
                const user = await interaction.client.users.fetch(row.id).catch(() => null);
                return `**${index + 1}.** ${user ? user.username : row.d.name} — ${row.d.xp} XP • ${row.d.gems} gemmes`;
            }))
            : ['*(aucune mascotte)*'];
        return interaction.reply({
            embeds: [new EmbedBuilder().setTitle('🏆 Classement Diamant').setColor(0xe8510d).setDescription(lines.join('\n'))],
            flags: MessageFlags.Ephemeral,
        });
    }

    return interaction.reply({ content: t(guildId, 'diamant_missing'), flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
