const fs = require('fs');
const path = require('path');
const {
    AttachmentBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { buildLinkButtonsSections } = require('../core/linkButtons');
const { renderWelcomeCard } = require('../core/glassEmbed');

const SUPPORTED_IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp'];

// Cherche le fichier d'image d'au revoir quelle que soit son extension
// (le gif doit garder son extension .gif pour s'animer dans l'embed)
function findGoodbyeImageFile(guildId) {
    const dir = path.join(__dirname, '..', '..', 'goodbye_images');
    for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
        const filePath = path.join(dir, `${guildId}.${ext}`);
        if (fs.existsSync(filePath)) return { filePath, ext };
    }
    return null;
}

function getGoodbyeImagePath(guildId) {
    const found = findGoodbyeImageFile(guildId);
    return found ? found.filePath : path.join(__dirname, '..', '..', 'goodbye_images', `${guildId}.png`);
}

// Remplace {membre}, {serveur}, {nombre_membres} (anciennes variables) ainsi que
// {user.mention}, {user.name}, {user.id}, {user.joined_at}, {server.name},
// {server.member_count} (nouvelles variables) dans un texte personnalisé.
function applyPlaceholders(text, member) {
    if (!text) return text;
    const joinedAt = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'inconnu';
    const createdAt = member.user.createdTimestamp ? `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>` : 'inconnu';
    return text
        .replace(/\{membre\}/g, member.user.tag)
        .replace(/\{serveur\}/g, member.guild.name)
        .replace(/\{nombre_membres\}/g, String(member.guild.memberCount))
        .replace(/\{user\.mention\}/g, member.user.toString())
        .replace(/\{user\.name\}/g, member.user.username)
        .replace(/\{user\.id\}/g, member.user.id)
        .replace(/\{user\.joined_at\}/g, joinedAt)
        .replace(/\{user\.created_at\}/g, createdAt)
        .replace(/\{server\.name\}/g, member.guild.name)
        .replace(/\{server\.member_count\}/g, String(member.guild.memberCount));
}

// Construit le message d'au revoir en Components V2 (même look que la bienvenue) :
// titre, séparateur, section message + avatar du membre, lignes de boutons, grande image en bas.
// includeImage=false permet de reconstruire sans image si l'envoi échoue (payload trop lourd).
function buildGoodbyeContainer(member, { includeImage = true, glassBuffer = null } = {}) {
    const cfg = getGuildConfig(member.guild.id);
    const appearance = cfg.goodbye_appearance || {};
    const found = includeImage ? findGoodbyeImageFile(member.guild.id) : null;

    const title = applyPlaceholders(appearance.title, member) || `Au revoir, ${member.user.username}...`;
    const description = applyPlaceholders(appearance.description, member) ||
        `**${member.user.tag}** vient de quitter **${member.guild.name}**.\n` +
        `Nous sommes maintenant **${member.guild.memberCount}** membre(s).\n\n` +
        `Merci d'être passé, à bientôt peut-être ! 👋`;

    const container = new ContainerBuilder().setAccentColor(appearance.color ?? 0xFFFFFF);
    const separator = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

    // Titre
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    container.addSeparatorComponents(separator());

    // Message + avatar du membre à droite
    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
            )
    );

    // Boutons : une ligne par bouton avec description, le reste en rangée classique
    const { sections, rows } = buildLinkButtonsSections(appearance.buttons);
    if (sections.length || rows.length) {
        container.addSeparatorComponents(separator());
        for (const section of sections) container.addSectionComponents(section);
        for (const row of rows) container.addActionRowComponents(row);
    }

    // Grande image en bas : image personnalisée du serveur, sinon carte « verre fumé » générée
    let attachment = null;
    if (!found && glassBuffer) {
        const fileName = `goodbye_${Date.now().toString(36)}.png`;
        attachment = new AttachmentBuilder(glassBuffer, { name: fileName });
        container.addSeparatorComponents(separator());
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)
            )
        );
    } else if (found) {
        const fileName = `goodbye.${found.ext}`;
        attachment = new AttachmentBuilder(found.filePath, { name: fileName });
        container.addSeparatorComponents(separator());
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)
            )
        );
    }

    return { container, attachment };
}

function registerGoodbyeHandler(client) {
    client.on('guildMemberRemove', async member => {
        try {
            if (member.user.bot) return;
            const cfg = getGuildConfig(member.guild.id);
            const channelId = cfg.goodbye_channel_id;
            if (!channelId) return;
            const channel = member.guild.channels.cache.get(String(channelId));
            if (!channel?.isTextBased?.()) return;

            let glassBuffer = null;
            if (!findGoodbyeImageFile(member.guild.id)) {
                glassBuffer = await renderWelcomeCard({
                    guildId: member.guild.id,
                    kind: 'goodbye',
                    username: member.displayName || member.user.username,
                    avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
                    serverName: member.guild.name,
                    memberCount: member.guild.memberCount,
                    createdTs: member.user.createdTimestamp,
                    joinedTs: member.joinedTimestamp
                }).catch(e => { console.error('Carte d\'au revoir (verre) impossible :', e.message); return null; });
            }
            const { container, attachment } = buildGoodbyeContainer(member, { glassBuffer });
            try {
                await channel.send({
                    components: [container],
                    files: attachment ? [attachment] : [],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (sendError) {
                if (attachment) {
                    console.error('Erreur d\'envoi avec image d\'au revoir (probablement trop lourde), envoi sans image :', sendError.message);
                    const { container: fallbackContainer } = buildGoodbyeContainer(member, { includeImage: false });
                    await channel.send({ components: [fallbackContainer], flags: MessageFlags.IsComponentsV2 });
                } else {
                    throw sendError;
                }
            }
        } catch (e) {
            console.error('Erreur lors de la génération de l\'embed d\'au revoir :', e.message);
        }
    });

    console.log('✅ Système de message d\'au revoir personnalisé initialisé.');
}

module.exports = { registerGoodbyeHandler, buildGoodbyeContainer, getGoodbyeImagePath, findGoodbyeImageFile, applyPlaceholders };