'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Conversion Embeds -> Components V2
// Ce module permet de garder tout le code existant qui construit des
// objets d'embed (EmbedBuilder ou objets bruts) inchangé, et de les
// convertir automatiquement en Container (Components V2) au moment de
// l'envoi. La couleur de l'embed devient la couleur de la barre verticale
// à gauche du Container (accent color), ce qui reproduit le rendu visuel
// des anciens embeds.
// ─────────────────────────────────────────────────────────────────────────

const {
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
} = require('discord.js');

const ZERO_WIDTH = '\u200b';

function toEmbedData(embed) {
    if (!embed) return null;
    if (typeof embed.toJSON === 'function') return embed.toJSON();
    return embed;
}

/**
 * Convertit un embed (EmbedBuilder ou objet brut compatible) en ContainerBuilder
 * (Components V2), en conservant la barre colorée à gauche via l'accent color.
 * @param {import('discord.js').EmbedBuilder | Object} embed
 * @returns {ContainerBuilder}
 */
function containerFromEmbed(embed) {
    const data = toEmbedData(embed) || {};
    const container = new ContainerBuilder();

    if (data.color !== undefined && data.color !== null) {
        container.setAccentColor(data.color);
    }

    // ── En-tête : auteur + titre + description ──
    let headerText = '';
    if (data.author?.name) {
        headerText += data.author.url
            ? `[${data.author.name}](${data.author.url})\n`
            : `${data.author.name}\n`;
    }
    if (data.title) {
        headerText += data.url ? `## [${data.title}](${data.url})` : `## ${data.title}`;
    }
    if (data.description) {
        headerText += (headerText ? '\n' : '') + data.description;
    }

    const thumbnailUrl = data.thumbnail?.url || data.author?.icon_url || data.author?.iconURL || null;

    if (headerText || thumbnailUrl) {
        if (thumbnailUrl) {
            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText || ZERO_WIDTH))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
            container.addSectionComponents(section);
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
        }
    }

    // ── Champs (fields) ──
    if (Array.isArray(data.fields) && data.fields.length > 0) {
        const fieldsText = data.fields
            .map((f) => `**${f.name}**\n${f.value}`)
            .join('\n\n');
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsText));
    }

    // ── Image principale ──
    if (data.image?.url) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(data.image.url)
            )
        );
    }

    // ── Footer / timestamp ──
    if (data.footer?.text || data.timestamp) {
        let footerText = data.footer?.text || '';
        if (data.timestamp) {
            const ts = Math.floor(new Date(data.timestamp).getTime() / 1000);
            footerText += (footerText ? ' • ' : '') + `<t:${ts}:R>`;
        }
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));
    }

    // Sécurité : un Container ne peut pas être vide.
    if (container.components.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(ZERO_WIDTH));
    }

    return container;
}

/**
 * Transforme un payload de message "classique" (avec `embeds`) en payload
 * Components V2 : chaque embed devient un Container (barre colorée conservée),
 * le `content` éventuel devient un TextDisplay placé au-dessus, et les
 * `components` existants (boutons, menus...) sont conservés tels quels.
 *
 * Usage : interaction.reply(toCV2Payload({ embeds: [embed], components: [row], ephemeral: true }))
 * @param {Object} payload
 * @returns {Object}
 */
function toCV2Payload(payload = {}) {
    const { embeds = [], components = [], content, ephemeral, flags = 0, ...rest } = payload;

    let finalFlags = flags | MessageFlags.IsComponentsV2;
    if (ephemeral) finalFlags |= MessageFlags.Ephemeral;

    const topLevel = [];
    if (content) {
        topLevel.push(new TextDisplayBuilder().setContent(String(content)));
    }
    for (const embed of embeds) {
        if (!embed) continue;
        topLevel.push(containerFromEmbed(embed));
    }
    topLevel.push(...components);

    return { ...rest, components: topLevel, flags: finalFlags };
}

module.exports = { containerFromEmbed, toCV2Payload };
