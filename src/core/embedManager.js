'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    MessageFlags,
    ChannelSelectMenuBuilder,
    ChannelType,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MentionableSelectMenuBuilder,
    SelectMenuDefaultValueType,
} = require('discord.js');
const { getGuildBucket, setGuildBucket } = require('./data');
const { buildCouleurLabelComponents, resoudreCouleurDepuisModal } = require('./colorPalette');
const { toCV2Payload } = require('./componentsV2');

// ────────────────────────────────────────────────
// /embedm — embeds personnalisés réutilisables (Components V2)
// Un embed créé ici peut ensuite être référencé ailleurs dans le bot
// (bienvenue, au revoir, réponse automatique, boost...) via {embed:nom}.
// ────────────────────────────────────────────────

const COMPARTIMENT = 'embedsPersonnalises';
const EMBED_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
const MAX_BOUTONS_LIENS = 5;
const MAX_MENTIONS = 10;

// ── Mentions (membres/rôles/@everyone/@here à ping quand l'embed est envoyé) ──
// Stockées comme data.mentions = [{ id, type: 'user'|'role'|'everyone'|'here' }, ...]

function buildMentionsLigne(data) {
    const mentions = Array.isArray(data.mentions) ? data.mentions : [];
    if (!mentions.length) return null;
    return mentions.map(m => {
        if (m.type === 'everyone') return '@everyone';
        if (m.type === 'here') return '@here';
        return m.type === 'role' ? `<@&${m.id}>` : `<@${m.id}>`;
    }).join(' ');
}

function buildMentionsAllowed(data) {
    const mentions = Array.isArray(data.mentions) ? data.mentions : [];
    const parse = mentions.some(m => m.type === 'everyone' || m.type === 'here') ? ['everyone'] : [];
    return {
        users: mentions.filter(m => m.type === 'user').map(m => m.id),
        roles: mentions.filter(m => m.type === 'role').map(m => m.id),
        parse,
    };
}

// Composant à placer au-dessus du Container au moment de l'envoi réel (pas dans
// l'aperçu du panneau, pour ne pas re-notifier les gens à chaque Actualiser).
function buildMentionsTextDisplay(data) {
    const ligne = buildMentionsLigne(data);
    return ligne ? new TextDisplayBuilder().setContent(ligne) : null;
}

function hasSpecialMention(data, type) {
    return Array.isArray(data.mentions) && data.mentions.some(m => m.type === type);
}

function toggleSpecialMention(data, type) {
    const mentions = Array.isArray(data.mentions) ? [...data.mentions] : [];
    const idx = mentions.findIndex(m => m.type === type);
    if (idx !== -1) mentions.splice(idx, 1);
    else mentions.push({ id: `@${type}`, type });
    return mentions;
}

// customIdPrefix : 'embedm' pour /embed, 'bcembed' pour !broadcast.
function buildMentionSelectRow(customIdPrefix, nom, data) {
    const mentions = Array.isArray(data.mentions) ? data.mentions : [];
    const mentionsClassiques = mentions.filter(m => m.type === 'user' || m.type === 'role');
    const select = new MentionableSelectMenuBuilder()
        .setCustomId(`${customIdPrefix}::mentionselect::${nom}`)
        .setPlaceholder('Choisir les membres et/ou rôles à mentionner')
        .setMinValues(0)
        .setMaxValues(MAX_MENTIONS);
    if (mentionsClassiques.length) {
        select.setDefaultValues(mentionsClassiques.slice(0, MAX_MENTIONS).map(m => ({
            id: m.id,
            type: m.type === 'role' ? SelectMenuDefaultValueType.Role : SelectMenuDefaultValueType.User,
        })));
    }
    return new ActionRowBuilder().addComponents(select);
}

// Rangée de boutons pour activer/désactiver @everyone et @here (impossibles à
// mettre dans un MentionableSelectMenu, qui ne gère que membres/rôles).
function buildMentionsSpecialRow(customIdPrefix, nom, data) {
    const everyoneActif = hasSpecialMention(data, 'everyone');
    const hereActif = hasSpecialMention(data, 'here');
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${customIdPrefix}::mentioneveryone::${nom}`)
            .setLabel(everyoneActif ? '✅ @everyone' : '@everyone')
            .setStyle(everyoneActif ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${customIdPrefix}::mentionhere::${nom}`)
            .setLabel(hereActif ? '✅ @here' : '@here')
            .setStyle(hereActif ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
}

// Parse le texte du modal "Boutons" : une ligne par bouton, format `Label|https://url`.
// Reprend la même convention que src/core/reglement.js pour rester cohérent.
function construireBoutonsLiensEmbed(lignes) {
    const boutons = [];
    for (const ligne of lignes.slice(0, MAX_BOUTONS_LIENS)) {
        const brut = String(ligne || '').trim();
        const indexSeparateur = brut.indexOf('|');
        if (indexSeparateur === -1) continue;

        const label = brut.slice(0, indexSeparateur).trim().slice(0, 80);
        const url = brut.slice(indexSeparateur + 1).trim();
        if (!label || !/^https?:\/\/.+/i.test(url)) continue;

        boutons.push(
            new ButtonBuilder()
                .setLabel(label)
                .setURL(url)
                .setStyle(ButtonStyle.Link)
        );
    }
    return boutons;
}

function getEmbed(guildId, nom) {
    const bucket = getGuildBucket(guildId, COMPARTIMENT, {});
    return bucket[nom] || null;
}

function saveEmbed(guildId, nom, data) {
    const bucket = getGuildBucket(guildId, COMPARTIMENT, {});
    bucket[nom] = data;
    setGuildBucket(guildId, COMPARTIMENT, bucket);
}

function deleteEmbed(guildId, nom) {
    const bucket = getGuildBucket(guildId, COMPARTIMENT, {});
    delete bucket[nom];
    setGuildBucket(guildId, COMPARTIMENT, bucket);
}

function listEmbeds(guildId) {
    return Object.keys(getGuildBucket(guildId, COMPARTIMENT, {}));
}

function buildEmbedFromData(data) {
    const embed = new EmbedBuilder();
    if (data.color !== undefined && data.color !== null) embed.setColor(data.color);
    if (data.title) embed.setTitle(String(data.title).slice(0, 256));
    if (data.description) embed.setDescription(String(data.description).slice(0, 4096));
    if (data.url) { try { embed.setURL(data.url); } catch (_) { /* URL invalide, ignorée */ } }
    if (data.author?.name) {
        try {
            embed.setAuthor({
                name: String(data.author.name).slice(0, 256),
                iconURL: data.author.iconURL || undefined,
                url: data.author.url || undefined,
            });
        } catch (_) { /* icône/URL invalide, ignorée */ }
    }
    if (data.footer?.text) {
        try {
            embed.setFooter({
                text: String(data.footer.text).slice(0, 2048),
                iconURL: data.footer.iconURL || undefined,
            });
        } catch (_) { /* icône invalide, ignorée */ }
    }
    if (data.thumbnail) { try { embed.setThumbnail(data.thumbnail); } catch (_) {} }
    if (data.image) { try { embed.setImage(data.image); } catch (_) {} }

    const estVide = !data.title && !data.description && !data.author?.name && !data.footer?.text && !data.image && !data.thumbnail;
    if (estVide) embed.setDescription('*(embed vide — utilise les boutons ci-dessous pour le remplir)*');

    return embed;
}

// ────────────────────────────────────────────────
// Rendu Components V2 natif (au lieu du simple embed classique) :
// permet d'insérer des "catégories" (blocs de texte) séparées par un
// petit trait, en plus de l'entête (auteur/titre/description) et du
// footer.
// ────────────────────────────────────────────────
const ZERO_WIDTH = '\u200b';

function buildEmbedContainer(data) {
    const container = new ContainerBuilder();
    if (data.color !== undefined && data.color !== null) container.setAccentColor(data.color);

    let headerText = '';
    if (data.author?.name) {
        headerText += data.author.url ? `[${data.author.name}](${data.author.url})\n` : `${data.author.name}\n`;
    }
    if (data.title) headerText += data.url ? `## [${data.title}](${data.url})` : `## ${data.title}`;
    if (data.description) headerText += (headerText ? '\n' : '') + data.description;

    const thumbnailUrl = data.thumbnail || data.author?.iconURL || null;
    if (headerText || thumbnailUrl) {
        if (thumbnailUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText || ZERO_WIDTH))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
            );
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
        }
    }

    const categories = Array.isArray(data.categories) ? data.categories : [];
    for (const categorie of categories) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        let texteCategorie = '';
        if (categorie.titre) texteCategorie += `**${categorie.titre}**\n`;
        texteCategorie += categorie.contenu || ZERO_WIDTH;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(texteCategorie));
    }

    if (data.image) {
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(data.image)));
    }

    const boutonsLiens = construireBoutonsLiensEmbed(Array.isArray(data.buttonLines) ? data.buttonLines : []);
    if (boutonsLiens.length) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(boutonsLiens));
    }

    if (data.footer?.text) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${data.footer.text}`));
    }

    if (container.components.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(ZERO_WIDTH));
    }

    return container;
}

function buildPanelRows(nom) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embedm::basic::${nom}`).setLabel('Infos de base').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::author::${nom}`).setLabel('Auteur').setEmoji('👤').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::footer::${nom}`).setLabel('Footer').setEmoji('🦶').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::images::${nom}`).setLabel('Images').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::category::${nom}`).setLabel('Catégorie').setEmoji('🗂️').setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embedm::categoryedit::${nom}`).setLabel('Modifier catégorie').setEmoji('🖊️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::color::${nom}`).setLabel('Couleur').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::buttons::${nom}`).setLabel('Boutons').setEmoji('🔘').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::mention::${nom}`).setLabel('Mentions').setEmoji('📣').setStyle(ButtonStyle.Secondary),
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embedm::refresh::${nom}`).setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::delete::${nom}`).setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`embedm::channel::${nom}`).setLabel('Salon').setEmoji('📤').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`embedm::send::${nom}`).setLabel('Envoyer').setEmoji('📨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`embedm::save::${nom}`).setLabel('Sauvegarder').setEmoji('💾').setStyle(ButtonStyle.Primary),
    );
    return [row1, row2, row3, row4];
}

function buildChannelSelectRow(nom) {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId(`embedm::channelselect::${nom}`)
        .setPlaceholder('Choisir le salon de destination')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1);
    return new ActionRowBuilder().addComponents(select);
}

function buildPanelPayload(guildId, nom) {
    const data = getEmbed(guildId, nom);
    if (!data) return null;
    const ligneSalon = data.channelId ? `\n-# Salon de destination actuel : <#${data.channelId}>` : '\n-# Aucun salon choisi (bouton Envoyer → salon actuel par défaut)';
    const nbMentions = Array.isArray(data.mentions) ? data.mentions.length : 0;
    const ligneMentions = nbMentions ? `\n-# 🔔 ${nbMentions} mention(s) configurée(s) (ping envoyé avec l'embed)` : '';
    const ligneMessageEnvoye = data.sentMessageId
        ? `\n-# 💾 Message envoyé lié dans <#${data.sentChannelId}> — le bouton **Sauvegarder** le met à jour en direct`
        : '';
    const topText = new TextDisplayBuilder().setContent(
        `**Embed personnalisé : \`${nom}\`**\n-# Référence à utiliser ailleurs : \`{embed:${nom}}\` (message de bienvenue, au revoir, réponse automatique...)${ligneSalon}${ligneMentions}${ligneMessageEnvoye}`
    );
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [topText, buildEmbedContainer(data), ...buildPanelRows(nom)],
    };
}

// ── Modals ──

function buildBasicModal(nom, data) {
    const modal = new ModalBuilder().setCustomId(`embedm::modalbasic::${nom}`).setTitle('Infos de base');

    const titreInput = new TextInputBuilder().setCustomId('titre').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setPlaceholder('Titre de l\'embed');
    if (data.title) titreInput.setValue(String(data.title));
    const titreLabel = new LabelBuilder().setLabel('Titre').setTextInputComponent(titreInput);

    const descInput = new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setPlaceholder('Description de l\'embed');
    if (data.description) descInput.setValue(String(data.description));
    const descLabel = new LabelBuilder().setLabel('Description').setTextInputComponent(descInput);

    const urlInput = new TextInputBuilder().setCustomId('url').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://... (lien au clic sur le titre, optionnel)');
    if (data.url) urlInput.setValue(String(data.url));
    const urlLabel = new LabelBuilder().setLabel('URL du titre (optionnel)').setTextInputComponent(urlInput);

    const { couleurLabel, couleurHexLabel } = buildCouleurLabelComponents(data.color);

    modal.addLabelComponents(titreLabel, descLabel, urlLabel, couleurLabel, couleurHexLabel);
    return modal;
}

function buildColorModal(nom, data) {
    const modal = new ModalBuilder().setCustomId(`embedm::modalcolor::${nom}`).setTitle('Couleur de l\'embed');
    const { couleurLabel, couleurHexLabel } = buildCouleurLabelComponents(data.color);
    modal.addLabelComponents(couleurLabel, couleurHexLabel);
    return modal;
}

function buildAuthorModal(nom, data) {
    const modal = new ModalBuilder().setCustomId(`embedm::modalauthor::${nom}`).setTitle('Auteur de l\'embed');

    const nomInput = new TextInputBuilder().setCustomId('nom').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setPlaceholder('Nom affiché en haut de l\'embed');
    if (data.author?.name) nomInput.setValue(String(data.author.name));
    const nomLabel = new LabelBuilder().setLabel('Nom').setTextInputComponent(nomInput);

    const urlInput = new TextInputBuilder().setCustomId('url').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Lien au clic sur le nom (optionnel)');
    if (data.author?.url) urlInput.setValue(String(data.author.url));
    const urlLabel = new LabelBuilder().setLabel('URL (optionnel)').setTextInputComponent(urlInput);

    const iconInput = new TextInputBuilder().setCustomId('icone').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de la petite icône ronde (optionnel)');
    if (data.author?.iconURL) iconInput.setValue(String(data.author.iconURL));
    const iconLabel = new LabelBuilder().setLabel('Icône (URL, optionnel)').setTextInputComponent(iconInput);

    modal.addLabelComponents(nomLabel, urlLabel, iconLabel);
    return modal;
}

function buildFooterModal(nom, data) {
    const modal = new ModalBuilder().setCustomId(`embedm::modalfooter::${nom}`).setTitle('Footer de l\'embed');

    const texteInput = new TextInputBuilder().setCustomId('texte').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setPlaceholder('Texte du footer');
    if (data.footer?.text) texteInput.setValue(String(data.footer.text));
    const texteLabel = new LabelBuilder().setLabel('Texte').setTextInputComponent(texteInput);

    const iconInput = new TextInputBuilder().setCustomId('icone').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de la petite icône du footer (optionnel)');
    if (data.footer?.iconURL) iconInput.setValue(String(data.footer.iconURL));
    const iconLabel = new LabelBuilder().setLabel('Icône (URL, optionnel)').setTextInputComponent(iconInput);

    modal.addLabelComponents(texteLabel, iconLabel);
    return modal;
}

function buildImagesModal(nom, data) {
    const modal = new ModalBuilder().setCustomId(`embedm::modalimages::${nom}`).setTitle('Images de l\'embed');

    const thumbInput = new TextInputBuilder().setCustomId('miniature').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de la miniature (petite image, en haut à droite)');
    if (data.thumbnail) thumbInput.setValue(String(data.thumbnail));
    const thumbLabel = new LabelBuilder().setLabel('Miniature (URL)').setTextInputComponent(thumbInput);

    const imageInput = new TextInputBuilder().setCustomId('image').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de l\'image principale (grande, en bas de l\'embed)');
    if (data.image) imageInput.setValue(String(data.image));
    const imageLabel = new LabelBuilder().setLabel('Image principale (URL)').setTextInputComponent(imageInput);

    modal.addLabelComponents(thumbLabel, imageLabel);
    return modal;
}

// idx: index de la catégorie à modifier (undefined/null = ajout d'une nouvelle catégorie).
// categorie: données existantes { titre, contenu } à pré-remplir en mode édition.
function buildCategoryModal(nom, idx = null, categorie = null) {
    const suffixe = (idx !== null && idx !== undefined) ? `::${idx}` : '::new';
    const modal = new ModalBuilder()
        .setCustomId(`embedm::modalcategory::${nom}${suffixe}`)
        .setTitle(categorie ? 'Modifier la catégorie' : 'Ajouter une catégorie');

    const titreInput = new TextInputBuilder().setCustomId('titre').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setPlaceholder('Titre de la catégorie (optionnel)');
    if (categorie?.titre) titreInput.setValue(String(categorie.titre));
    const titreLabel = new LabelBuilder().setLabel('Titre').setTextInputComponent(titreInput);

    const contenuInput = new TextInputBuilder().setCustomId('contenu').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setPlaceholder('Texte de cette catégorie');
    if (categorie?.contenu) contenuInput.setValue(String(categorie.contenu));
    const contenuLabel = new LabelBuilder().setLabel('Contenu').setTextInputComponent(contenuInput);

    modal.addLabelComponents(titreLabel, contenuLabel);
    return modal;
}

// Menu déroulant listant les catégories existantes pour les modifier ou les supprimer.
function buildCategoryEditPayload(nom, data) {
    const categories = Array.isArray(data.categories) ? data.categories : [];
    if (!categories.length) {
        return { content: '❌ Aucune catégorie à modifier. Utilise le bouton **Catégorie** pour en ajouter une.', components: [] };
    }
    const options = [];
    categories.forEach((cat, idx) => {
        const libelle = cat?.titre ? String(cat.titre).slice(0, 90) : `Catégorie n°${idx + 1}`;
        options.push(new StringSelectMenuOptionBuilder().setLabel(`✏️ Modifier : ${libelle}`).setValue(`edit:${idx}`));
        options.push(new StringSelectMenuOptionBuilder().setLabel(`🗑️ Supprimer : ${libelle}`).setValue(`del:${idx}`));
    });
    const select = new StringSelectMenuBuilder()
        .setCustomId(`embedm::categoryselect::${nom}`)
        .setPlaceholder('Choisir une catégorie à modifier ou supprimer')
        .addOptions(options.slice(0, 25));
    return {
        content: `Catégories de l'embed \`${nom}\` :`,
        components: [new ActionRowBuilder().addComponents(select)],
    };
}

// ── Routage des interactions (boutons + soumissions de modal) ──

async function routeEmbedInteraction(interaction) {
    try {
        const parts = String(interaction.customId || '').split('::');
        const action = parts[1];
        const nom = parts[2];
        if (!nom) return;

        if (!interaction.guild || !interaction.member?.permissions?.has('Administrator')) {
            return interaction.reply({ content: '❌ Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        }
        const guildId = interaction.guild.id;

        if (interaction.isButton()) {
            const data = getEmbed(guildId, nom);
            if (!data) {
                return interaction.update({
                    components: [new TextDisplayBuilder().setContent(`❌ L'embed \`${nom}\` n'existe plus.`)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            if (action === 'basic') return interaction.showModal(buildBasicModal(nom, data));
            if (action === 'color') return interaction.showModal(buildColorModal(nom, data));
            if (action === 'author') return interaction.showModal(buildAuthorModal(nom, data));
            if (action === 'footer') return interaction.showModal(buildFooterModal(nom, data));
            if (action === 'images') return interaction.showModal(buildImagesModal(nom, data));
            if (action === 'category') return interaction.showModal(buildCategoryModal(nom));
            if (action === 'categoryedit') {
                return interaction.reply({ ...buildCategoryEditPayload(nom, data), flags: MessageFlags.Ephemeral });
            }
            if (action === 'mention') {
                return interaction.reply({
                    content: `📣 Sélectionne les membres et/ou rôles à mentionner quand cet embed sera envoyé (max ${MAX_MENTIONS}), et/ou active **@everyone** ou **@here** ci-dessous. Laisse la sélection vide pour ne mentionner personne.`,
                    components: [buildMentionSelectRow('embedm', nom, data), buildMentionsSpecialRow('embedm', nom, data)],
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (action === 'mentioneveryone' || action === 'mentionhere') {
                const type = action === 'mentioneveryone' ? 'everyone' : 'here';
                data.mentions = toggleSpecialMention(data, type);
                saveEmbed(guildId, nom, data);
                return interaction.update({
                    content: interaction.message.content,
                    components: [buildMentionSelectRow('embedm', nom, data), buildMentionsSpecialRow('embedm', nom, data)],
                });
            }
            if (action === 'buttons') {
                await interaction.reply({
                    content: `✏️ Envoie tes boutons-liens **dans ce salon** (2 minutes), un par ligne, format \`Label | https://lien\` (max ${MAX_BOUTONS_LIENS}). Tape \`annuler\` pour ne rien changer.`,
                    flags: MessageFlags.Ephemeral,
                });
                try {
                    const collected = await interaction.channel.awaitMessages({
                        filter: m => m.author.id === interaction.user.id,
                        max: 1,
                        time: 120000,
                        errors: ['time'],
                    });
                    const message = collected.first();
                    const contenu = message.content.trim();
                    await message.delete().catch(() => {});
                    if (contenu.toLowerCase() === 'annuler') {
                        return interaction.followUp({ content: '❌ Annulé, boutons inchangés.', flags: MessageFlags.Ephemeral });
                    }
                    const dataActuelle = getEmbed(guildId, nom);
                    if (!dataActuelle) {
                        return interaction.followUp({ content: `❌ L'embed \`${nom}\` n'existe plus.`, flags: MessageFlags.Ephemeral });
                    }
                    dataActuelle.buttonLines = contenu.split('\n').map(l => l.trim()).filter(Boolean).slice(0, MAX_BOUTONS_LIENS);
                    saveEmbed(guildId, nom, dataActuelle);
                    return interaction.followUp({ content: '✅ Boutons mis à jour. Clique sur **Actualiser** dans le panneau pour voir le résultat.', flags: MessageFlags.Ephemeral });
                } catch (e) {
                    return interaction.followUp({ content: '⏱️ Aucun message reçu, annulé.', flags: MessageFlags.Ephemeral });
                }
            }
            if (action === 'refresh') return interaction.update(buildPanelPayload(guildId, nom));

            if (action === 'delete') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`embedm::deleteconfirm::${nom}`).setLabel('Confirmer la suppression').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`embedm::refresh::${nom}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
                );
                return interaction.update({
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        new TextDisplayBuilder().setContent(`⚠️ Supprimer définitivement l'embed \`${nom}\` ? Les endroits qui utilisent \`{embed:${nom}}\` ne l'afficheront plus.`),
                        buildEmbedContainer(data),
                        confirmRow,
                    ],
                });
            }
            if (action === 'deleteconfirm') {
                deleteEmbed(guildId, nom);
                return interaction.update(toCV2Payload({ content: `🗑️ Embed \`${nom}\` supprimé.`, components: [] }));
            }
            if (action === 'channel') {
                return interaction.reply({
                    content: `Choisis le salon où envoyer l'embed \`${nom}\` :`,
                    components: [buildChannelSelectRow(nom)],
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (action === 'send') {
                const targetId = data.channelId || interaction.channelId;
                const channel = interaction.guild.channels.cache.get(targetId);
                if (!channel || !channel.isTextBased()) {
                    return interaction.reply({
                        content: '❌ Salon de destination introuvable ou invalide. Choisis-en un avec le bouton Salon.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                try {
                    const mentionDisplay = buildMentionsTextDisplay(data);
                    const messageEnvoye = await channel.send({
                        flags: MessageFlags.IsComponentsV2,
                        components: [...(mentionDisplay ? [mentionDisplay] : []), buildEmbedContainer(data)],
                        allowedMentions: buildMentionsAllowed(data),
                    });
                    data.sentMessageId = messageEnvoye.id;
                    data.sentChannelId = channel.id;
                    saveEmbed(guildId, nom, data);
                } catch (e) {
                    console.error('Erreur envoi embed personnalisé :', e);
                    return interaction.reply({
                        content: `❌ Impossible d'envoyer dans <#${targetId}> (permissions manquantes ?).`,
                        flags: MessageFlags.Ephemeral,
                    });
                }
                return interaction.reply({ content: `✅ Embed \`${nom}\` envoyé dans <#${targetId}>. Utilise ensuite **Sauvegarder** pour répercuter tes futures modifications sur ce message.`, flags: MessageFlags.Ephemeral });
            }
            if (action === 'save') {
                if (!data.sentMessageId || !data.sentChannelId) {
                    return interaction.reply({
                        content: '❌ Cet embed n\'a jamais été envoyé. Utilise **Envoyer** d\'abord, tu pourras ensuite utiliser Sauvegarder pour le mettre à jour en direct.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                const salonCible = interaction.guild.channels.cache.get(data.sentChannelId);
                if (!salonCible || !salonCible.isTextBased()) {
                    return interaction.reply({ content: '❌ Le salon du message envoyé est introuvable ou inaccessible.', flags: MessageFlags.Ephemeral });
                }
                try {
                    const messageEnvoye = await salonCible.messages.fetch(data.sentMessageId);
                    const mentionDisplay = buildMentionsTextDisplay(data);
                    await messageEnvoye.edit({
                        flags: MessageFlags.IsComponentsV2,
                        components: [...(mentionDisplay ? [mentionDisplay] : []), buildEmbedContainer(data)],
                        allowedMentions: buildMentionsAllowed(data),
                    });
                } catch (e) {
                    console.error('Erreur sauvegarde embed personnalisé :', e);
                    return interaction.reply({
                        content: '❌ Impossible de mettre à jour le message envoyé (a-t-il été supprimé, ou permissions manquantes ?).',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                return interaction.reply({ content: `💾 Message mis à jour dans <#${data.sentChannelId}> avec les dernières modifications de \`${nom}\`.`, flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (action !== 'categoryselect') return;
            const data = getEmbed(guildId, nom);
            if (!data) {
                return interaction.update({ content: `❌ L'embed \`${nom}\` n'existe plus.`, components: [] });
            }
            const valeur = interaction.values[0] || '';
            const [type, idxRaw] = valeur.split(':');
            const idx = parseInt(idxRaw, 10);
            const categories = Array.isArray(data.categories) ? data.categories : [];
            if (!Number.isInteger(idx) || !categories[idx]) {
                return interaction.update({ content: '❌ Cette catégorie n\'existe plus.', components: [] });
            }

            if (type === 'edit') {
                return interaction.showModal(buildCategoryModal(nom, idx, categories[idx]));
            }
            if (type === 'del') {
                categories.splice(idx, 1);
                data.categories = categories;
                saveEmbed(guildId, nom, data);
                return interaction.update({
                    content: `🗑️ Catégorie supprimée. Clique sur **Actualiser** dans le panneau pour voir le résultat.`,
                    components: buildCategoryEditPayload(nom, data).components,
                });
            }
            return;
        }

        if (interaction.isChannelSelectMenu()) {
            if (action !== 'channelselect') return;
            const data = getEmbed(guildId, nom);
            if (!data) {
                return interaction.update({ content: `❌ L'embed \`${nom}\` n'existe plus.`, components: [] });
            }
            const channelId = interaction.values[0];
            data.channelId = channelId;
            saveEmbed(guildId, nom, data);
            return interaction.update({ content: `✅ Salon sélectionné pour \`${nom}\` : <#${channelId}>`, components: [] });
        }

        if (interaction.isMentionableSelectMenu()) {
            if (action !== 'mentionselect') return;
            const data = getEmbed(guildId, nom);
            if (!data) {
                return interaction.update({ content: `❌ L'embed \`${nom}\` n'existe plus.`, components: [] });
            }
            const nouvellesMentions = interaction.values.map(id => ({
                id,
                type: interaction.roles?.has(id) ? 'role' : 'user',
            }));
            const specialesExistantes = Array.isArray(data.mentions)
                ? data.mentions.filter(m => m.type === 'everyone' || m.type === 'here')
                : [];
            data.mentions = [...specialesExistantes, ...nouvellesMentions];
            saveEmbed(guildId, nom, data);
            return interaction.update({
                content: `📣 Sélectionne les membres et/ou rôles à mentionner quand cet embed sera envoyé (max ${MAX_MENTIONS}), et/ou active **@everyone** ou **@here** ci-dessous. Laisse la sélection vide pour ne mentionner personne.`,
                components: [buildMentionSelectRow('embedm', nom, data), buildMentionsSpecialRow('embedm', nom, data)],
            });
        }

        if (interaction.isModalSubmit()) {
            const data = getEmbed(guildId, nom) || {};
            const val = (id) => {
                try { return interaction.fields.getTextInputValue(id).trim(); } catch (_) { return ''; }
            };

            if (action === 'modalbasic') {
                data.title = val('titre') || null;
                data.description = val('description') || null;
                data.url = val('url') || null;
                const couleur = resoudreCouleurDepuisModal(interaction);
                if (couleur !== undefined && couleur !== null) data.color = couleur;
            } else if (action === 'modalcolor') {
                const couleur = resoudreCouleurDepuisModal(interaction);
                if (couleur === null) {
                    return interaction.reply({
                        content: '❌ Couleur hex invalide. Format attendu : 6 caractères (ex: `FF0000`).',
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (couleur !== undefined) data.color = couleur;
            } else if (action === 'modalauthor') {
                const nomAuteur = val('nom');
                const urlAuteur = val('url');
                const iconeAuteur = val('icone');
                data.author = (nomAuteur || urlAuteur || iconeAuteur)
                    ? { name: nomAuteur || null, url: urlAuteur || null, iconURL: iconeAuteur || null }
                    : null;
            } else if (action === 'modalfooter') {
                const texteFooter = val('texte');
                const iconeFooter = val('icone');
                data.footer = (texteFooter || iconeFooter)
                    ? { text: texteFooter || null, iconURL: iconeFooter || null }
                    : null;
            } else if (action === 'modalimages') {
                data.thumbnail = val('miniature') || null;
                data.image = val('image') || null;
            } else if (action === 'modalcategory') {
                const titreCategorie = val('titre');
                const contenuCategorie = val('contenu');
                if (!Array.isArray(data.categories)) data.categories = [];
                const idxRaw = parts[3];
                const idx = parseInt(idxRaw, 10);
                if (Number.isInteger(idx) && data.categories[idx]) {
                    // Édition d'une catégorie existante, déclenchée depuis le menu "Modifier catégorie".
                    // Ce modal a été ouvert depuis le message éphémère du select, pas depuis le panneau
                    // principal : on met donc à jour ce message-là plutôt que de renvoyer le panneau.
                    data.categories[idx] = { titre: titreCategorie || null, contenu: contenuCategorie };
                    saveEmbed(guildId, nom, data);
                    return interaction.update({
                        content: '✅ Catégorie modifiée. Clique sur **Actualiser** dans le panneau pour voir le résultat.',
                        components: buildCategoryEditPayload(nom, data).components,
                    });
                }
                data.categories.push({ titre: titreCategorie || null, contenu: contenuCategorie });
            } else {
                return;
            }

            saveEmbed(guildId, nom, data);
            return interaction.update(buildPanelPayload(guildId, nom));
        }
    } catch (e) {
        console.error('Erreur interaction embedm :', e);
        const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
        try {
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (_) {}
    }
}

module.exports = {
    EMBED_NAME_REGEX,
    MAX_BOUTONS_LIENS,
    MAX_MENTIONS,
    buildMentionsLigne,
    buildMentionsAllowed,
    buildMentionsTextDisplay,
    buildMentionSelectRow,
    buildMentionsSpecialRow,
    getEmbed,
    saveEmbed,
    deleteEmbed,
    listEmbeds,
    buildEmbedFromData,
    buildEmbedContainer,
    buildPanelPayload,
    buildBasicModal,
    buildColorModal,
    buildAuthorModal,
    buildFooterModal,
    buildImagesModal,
    buildCategoryModal,
    buildCategoryEditPayload,
    routeEmbedInteraction,
};