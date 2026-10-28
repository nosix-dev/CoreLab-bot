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
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SectionBuilder,
    ThumbnailBuilder,
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { buildLinkButtonsSections } = require('../core/linkButtons');
const { renderWelcomeCard } = require('../core/glassEmbed');

const SUPPORTED_IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp'];

// Cherche le fichier d'image de bienvenue quelle que soit son extension
// (le gif doit garder son extension .gif pour s'animer dans l'embed)
function findWelcomeImageFile(guildId) {
    const dir = path.join(__dirname, '..', '..', 'welcome_images');
    for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
        const filePath = path.join(dir, `${guildId}.${ext}`);
        if (fs.existsSync(filePath)) return { filePath, ext };
    }
    return null;
}

function getWelcomeImagePath(guildId) {
    const found = findWelcomeImageFile(guildId);
    return found ? found.filePath : path.join(__dirname, '..', '..', 'welcome_images', `${guildId}.png`);
}

// Remplace {membre}, {serveur}, {nombre_membres} (anciennes variables) ainsi que
// {user.mention}, {user.name}, {user.id}, {user.joined_at}, {server.name},
// {server.member_count} (nouvelles variables) dans un texte personnalisé.
// mentionAsName=true pour le titre : Discord n'affiche JAMAIS un ping cliquable
// dans un titre d'embed (seulement le texte brut <@id>), donc on y met le pseudo.
function applyPlaceholders(text, member, { mentionAsName = false } = {}) {
    if (!text) return text;
    const membreTexte = mentionAsName ? member.user.username : member.user.toString();
    const joinedAt = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'inconnu';
    const createdAt = member.user.createdTimestamp ? `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>` : 'inconnu';
    return text
        .replace(/\{membre\}/g, membreTexte)
        .replace(/\{serveur\}/g, member.guild.name)
        .replace(/\{nombre_membres\}/g, String(member.guild.memberCount))
        .replace(/\{user\.mention\}/g, membreTexte)
        .replace(/\{user\.name\}/g, member.user.username)
        .replace(/\{user\.id\}/g, member.user.id)
        .replace(/\{user\.joined_at\}/g, joinedAt)
        .replace(/\{user\.created_at\}/g, createdAt)
        .replace(/\{server\.name\}/g, member.guild.name)
        .replace(/\{server\.member_count\}/g, String(member.guild.memberCount));
}

// Construit le message de bienvenue en Components V2, façon "serveur pro" :
//   [Container à bande de couleur]
//     ├─ # Titre
//     ├─ séparateur
//     ├─ Section : message (salutation + premiers pas) | avatar du membre à droite
//     ├─ séparateur
//     ├─ lignes "description ........ [Bouton lien]" (une par bouton configuré)
//     ├─ séparateur
//     └─ grande image/bannière en bas (media gallery)
// includeImage=false permet de reconstruire sans image si l'envoi échoue (payload trop lourd).
function buildWelcomeContainer(member, { includeImage = true, glassBuffer = null } = {}) {
    const cfg = getGuildConfig(member.guild.id);
    const appearance = cfg.welcome_appearance || {};
    const found = includeImage ? findWelcomeImageFile(member.guild.id) : null;

    const title = applyPlaceholders(appearance.title, member, { mentionAsName: true }) || `Bienvenue sur ${member.guild.name} !`;
    const description = applyPlaceholders(appearance.description, member) ||
        `Salut ${member.toString()}, bienvenue sur **${member.guild.name}** !\n` +
        `Tu es notre **membre n°${member.guild.memberCount}**.\n\n` +
        `📌 **Premiers pas :**\n` +
        `• Lis le règlement\n` +
        `• Choisis tes rôles\n` +
        `• Présente-toi à la communauté`;

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
                new ThumbnailBuilder().setURL(member.displayAvatarURL({ extension: 'png', size: 256 }))
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
        const fileName = `welcome_${Date.now().toString(36)}.png`;
        attachment = new AttachmentBuilder(glassBuffer, { name: fileName });
        container.addSeparatorComponents(separator());
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)
            )
        );
    } else if (found) {
        const fileName = `welcome.${found.ext}`;
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

// ────────────────────────────────────────────────
// MP de bienvenue avec bouton d'invitation du bot
// Activé par défaut (réglage « MP de bienvenue » dans /settings panneau → Bienvenue).
// - file d'attente espacée pour ne pas spammer l'API lors d'un raid / d'un afflux de membres
// - 1 seul MP par personne et par 24 h, même si elle rejoint plusieurs serveurs avec CoreLab
// ────────────────────────────────────────────────
const MP_MESSAGE_DEFAUT = 'Bienvenue sur le serveur, profite bien !';
const MP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MP_DELAI_ENTRE_ENVOIS_MS = 1500;
const mpDernierEnvoi = new Map();
let mpFile = Promise.resolve();

function lienInvitationBot(client) {
    return `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&integration_type=0&scope=bot%20applications.commands`;
}

function buildMpBienvenue(member) {
    const client = member.client;
    const cfg = getGuildConfig(member.guild.id);
    const message = applyPlaceholders((cfg.welcome_dm_message || '').trim() || MP_MESSAGE_DEFAUT, member, { mentionAsName: true });
    const embed = new EmbedBuilder()
        .setColor(0xFFFFFF)
        .setTitle(`Bienvenue sur ${member.guild.name} !`)
        .setDescription(`${message}\n\nEnvie du même bot sur ton propre serveur ? Ajoute **CoreLab** avec le bouton ci-dessous.`)
        .setFooter({ text: 'CoreLab • Bot tout-en-un', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Ajouter CoreLab sur mon serveur')
            .setURL(lienInvitationBot(client))
    );
    return { embeds: [embed], components: [row] };
}

function programmerMpBienvenue(member) {
    const cfg = getGuildConfig(member.guild.id);
    if (cfg.welcome_dm_enabled === false) return;
    const dernier = mpDernierEnvoi.get(member.id);
    if (dernier && Date.now() - dernier < MP_COOLDOWN_MS) return;
    mpDernierEnvoi.set(member.id, Date.now());

    mpFile = mpFile.then(async () => {
        try {
            // Le membre a pu être expulsé entre-temps (protection anti-alt, etc.)
            if (!member.guild.members.cache.has(member.id)) return;
            await member.send(buildMpBienvenue(member));
        } catch (e) {
            // MP fermés (50007) ou autre : on ignore silencieusement
            if (e?.code !== 50007) console.error('MP de bienvenue non envoyé :', e.message);
        }
        await new Promise(r => setTimeout(r, MP_DELAI_ENTRE_ENVOIS_MS));
    }).catch(() => { });
}

function registerWelcomeImageHandler(client) {
    client.on('guildMemberAdd', async member => {
        try {
            if (member.user.bot) return;
            programmerMpBienvenue(member);
            const cfg = getGuildConfig(member.guild.id);
            const channelId = cfg.welcome_channel_id;
            if (!channelId) return;
            const channel = member.guild.channels.cache.get(String(channelId));
            if (!channel?.isTextBased?.()) return;

            // Pas d'image perso → carte de bienvenue en verre fumé (avatar, n° de membre, ancienneté du compte)
            let glassBuffer = null;
            if (!findWelcomeImageFile(member.guild.id)) {
                glassBuffer = await renderWelcomeCard({
                    guildId: member.guild.id,
                    kind: 'welcome',
                    username: member.displayName || member.user.username,
                    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
                    serverName: member.guild.name,
                    memberCount: member.guild.memberCount,
                    card: cfg.welcome_card,
                    createdTs: member.user.createdTimestamp
                }).catch(e => { console.error('Carte de bienvenue (verre) impossible :', e.message); return null; });
            }
            const { container, attachment } = buildWelcomeContainer(member, { glassBuffer });
            try {
                await channel.send({
                    components: [container],
                    files: attachment ? [attachment] : [],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (sendError) {
                if (attachment) {
                    console.error('Erreur d\'envoi avec image de bienvenue (probablement trop lourde), envoi sans image :', sendError.message);
                    const { container: fallbackContainer } = buildWelcomeContainer(member, { includeImage: false });
                    await channel.send({ components: [fallbackContainer], flags: MessageFlags.IsComponentsV2 });
                } else {
                    throw sendError;
                }
            }
        } catch (e) {
            console.error('Erreur lors de la génération de l\'embed de bienvenue :', e.message);
        }
    });

    console.log('✅ Système d\'embed de bienvenue personnalisé initialisé.');
}

module.exports = { registerWelcomeImageHandler, buildWelcomeContainer, getWelcomeImagePath, findWelcomeImageFile, applyPlaceholders };
