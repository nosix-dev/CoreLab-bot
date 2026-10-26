const {
    ActionRowBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require('discord.js');
const { obtenirConfigGuilde } = require('../core/config');
const { persister } = require('../core/data');
const { buildCouleurLabelComponents, resoudreCouleurDepuisModal } = require('../core/colorPalette');

const EMOJI_REGLEMENT = '✅';
const ID_BOUTON_ACCEPTER = 'accept_rules_global';
const MAX_BOUTONS_LIENS = 5;

// ────────────────────────────────────────────────
// Image en attente : la pièce jointe est fournie sur /reglement,
// mais l'embed n'est construit qu'à la soumission du modal (texte + délai).
// On la garde en mémoire le temps du flux (clé = guildId_userId), avec
// une expiration de sécurité pour ne pas la réutiliser si le flux est abandonné.
// ────────────────────────────────────────────────
const imagesEnAttente = new Map();
const DELAI_EXPIRATION_IMAGE_MS = 10 * 60 * 1000; // 10 minutes

function stockerImageReglement(guildId, userId, url) {
    const cle = `${guildId}_${userId}`;
    imagesEnAttente.set(cle, url);
    setTimeout(() => {
        // N'efface que si c'est toujours la même valeur (évite d'effacer une image
        // stockée entre-temps par une nouvelle exécution de /reglement)
        if (imagesEnAttente.get(cle) === url) imagesEnAttente.delete(cle);
    }, DELAI_EXPIRATION_IMAGE_MS);
}

function recupererEtEffacerImageReglement(guildId, userId) {
    const cle = `${guildId}_${userId}`;
    const url = imagesEnAttente.get(cle);
    imagesEnAttente.delete(cle);
    return url || null;
}

// ────────────────────────────────────────────────
// Boutons de lien en attente : fournis directement en options de la
// commande /reglement (bouton1..bouton5, format "Label | URL"), au lieu
// d'un modal ou d'un message dans le salon. Même mécanisme que l'image.
// ────────────────────────────────────────────────
const boutonsEnAttente = new Map();
const DELAI_EXPIRATION_BOUTONS_MS = 10 * 60 * 1000; // 10 minutes

function stockerBoutonsReglement(guildId, userId, lignes) {
    const cle = `${guildId}_${userId}`;
    boutonsEnAttente.set(cle, lignes);
    setTimeout(() => {
        if (boutonsEnAttente.get(cle) === lignes) boutonsEnAttente.delete(cle);
    }, DELAI_EXPIRATION_BOUTONS_MS);
}

function recupererEtEffacerBoutonsReglement(guildId, userId) {
    const cle = `${guildId}_${userId}`;
    const lignes = boutonsEnAttente.get(cle);
    boutonsEnAttente.delete(cle);
    return lignes || [];
}

// Parse une liste de lignes "Label | https://lien" en ButtonBuilder de style Link.
// Les lignes mal formées (pas de "|", label vide, URL invalide) sont ignorées.
function construireBoutonsLiens(lignes) {
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

function construireLigneSelectionRole() {
    const select = new RoleSelectMenuBuilder()
        .setCustomId('reglement_role_select')
        .setPlaceholder('Choisir le(s) rôle(s) après acceptation (max 2)')
        .setMinValues(1)
        .setMaxValues(2);
    return new ActionRowBuilder().addComponents(select);
}

async function gererSelectionRoleReglement(interaction) {
    const idsRoles = interaction.values.slice(0, 2);
    const modal = new ModalBuilder()
        .setCustomId(`reglement_rules_modal_${idsRoles.join('_')}`)
        .setTitle('Créer le règlement');

    const config0 = obtenirConfigGuilde(interaction.guild.id);

    const titreInput = new TextInputBuilder()
        .setCustomId('titre')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false)
        .setPlaceholder('📜 Règlement du serveur');
    if (config0.rules_title) titreInput.setValue(String(config0.rules_title).slice(0, 256));
    const titreLabel = new LabelBuilder()
        .setLabel('Titre du règlement')
        .setTextInputComponent(titreInput);

    const contenuInput = new TextInputBuilder()
        .setCustomId('contenu')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(30)
        .setMaxLength(3900)
        .setRequired(true);
    const contenuLabel = new LabelBuilder()
        .setLabel('Texte du règlement')
        .setTextInputComponent(contenuInput);

    const delaiInput = new TextInputBuilder()
        .setCustomId('delai')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0 = immédiat, ex: 10')
        .setRequired(false);
    const delaiLabel = new LabelBuilder()
        .setLabel('Délai avant attribution du rôle (secondes)')
        .setTextInputComponent(delaiInput);

    const { couleurLabel, couleurHexLabel } = buildCouleurLabelComponents(config0.rules_color);

    modal.addLabelComponents(titreLabel, contenuLabel, delaiLabel, couleurLabel, couleurHexLabel);
    await interaction.showModal(modal);
}

async function gererSoumissionModalReglement(interaction) {
    if (interaction.customId === ID_MODAL_EDITION_REGLEMENT) return gererSoumissionEditionReglement(interaction);
    const idsRoles = interaction.customId.replace('reglement_rules_modal_', '').split('_').filter(Boolean);
    const roles = idsRoles.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
    if (!roles.length) {
        return interaction.reply({ content: '❌ Rôle(s) introuvable(s), recommence avec /reglement.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const config = obtenirConfigGuilde(interaction.guild.id);
    config.member_role_id = roles[0].id;
    config.member_role_id_2 = roles[1] ? roles[1].id : null;

    let titreSaisi = '';
    try { titreSaisi = interaction.fields.getTextInputValue('titre').trim(); } catch { /* champ absent sur d'anciens modals */ }
    if (titreSaisi) config.rules_title = titreSaisi;

    const contenu = interaction.fields.getTextInputValue('contenu');
    let delaiRaw = '0';
    try {
        delaiRaw = interaction.fields.getTextInputValue('delai') || '0';
    } catch { /* champ absent sur d'anciens modals, ignore */ }
    const delaiSecondes = Math.max(0, Math.min(3600, parseInt(delaiRaw, 10) || 0));
    config.rules_accept_delay = delaiSecondes;

    const couleurResolue = resoudreCouleurDepuisModal(interaction);
    if (couleurResolue === null) {
        return interaction.editReply({ content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `8FC3C8`.' });
    }
    if (couleurResolue !== undefined) config.rules_color = couleurResolue;

    const nomsRoles = roles.map(r => r.name).join(' + ');

    const imageUrl = recupererEtEffacerImageReglement(interaction.guild.id, interaction.user.id);
    const lignesBoutons = recupererEtEffacerBoutonsReglement(interaction.guild.id, interaction.user.id);
    const boutonsLiens = construireBoutonsLiens(lignesBoutons);

    const rowAccepter = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ID_BOUTON_ACCEPTER)
            .setLabel('Accepter le règlement')
            .setEmoji(EMOJI_REGLEMENT)
            .setStyle(ButtonStyle.Success),
    );

    const container = new ContainerBuilder()
        .setAccentColor(config.rules_color ?? 0xFFFFFF)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${config.rules_title || '📜 Règlement du serveur'}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(contenu)
        );

    if (imageUrl) {
        container
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(imageUrl)
                )
            );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (boutonsLiens.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(boutonsLiens));
    }

    container
        .addActionRowComponents(rowAccepter)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# Clique sur le bouton ci-dessus pour obtenir le(s) rôle(s) : ${nomsRoles} • <t:${Math.floor(Date.now() / 1000)}:f>`
            )
        );

    const message = await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    config.rules_message_id = message.id;
    config.rules_channel_id = message.channel.id;
    persister('configuration');

    await interaction.editReply({
        content: `✅ Règlement publié. Rôles : ${roles.map(r => `<@&${r.id}>`).join(' + ')}${delaiSecondes > 0 ? ` • Délai avant rôle : ${delaiSecondes}s` : ''}${boutonsLiens.length ? ` • ${boutonsLiens.length} bouton(s) de lien` : ''}`,
    });
}

// ────────────────────────────────────────────────
// /settings rules-edit : modifier le règlement DÉJÀ publié (titre, texte,
// délai, couleur) sans le republier. L'image, les boutons de lien, le bouton
// « Accepter » et les rôles attribués restent inchangés : on réédite le
// message existant à partir de son propre JSON.
// ────────────────────────────────────────────────
const TITRE_REGLEMENT_DEFAUT = '📜 Règlement du serveur';
// ⚠️ Même préfixe que le modal de création : il passe donc par le routage existant.
const ID_MODAL_EDITION_REGLEMENT = 'reglement_rules_modal_edit';

async function recupererMessageReglement(guild, config) {
    if (!config.rules_message_id || !config.rules_channel_id) return null;
    const salon = guild.channels.cache.get(config.rules_channel_id)
        ?? await guild.channels.fetch(config.rules_channel_id).catch(() => null);
    if (!salon?.messages) return null;
    return salon.messages.fetch(config.rules_message_id).catch(() => null);
}

// Renvoie le JSON du conteneur du règlement (type 17), nettoyé pour être renvoyé à Discord.
function extraireConteneurReglement(message) {
    const json = message?.components?.[0]?.toJSON?.();
    if (!json || json.type !== 17 || !Array.isArray(json.components)) return null;
    for (const c of json.components) {
        if (c.type === 12 && Array.isArray(c.items)) {
            c.items = c.items.map(it => ({
                media: { url: it.media?.url },
                ...(it.description ? { description: it.description } : {}),
                ...(it.spoiler ? { spoiler: true } : {}),
            }));
        }
    }
    return json;
}

async function ouvrirEditionReglement(interaction) {
    console.log('[reglement-edit] ouverture du modal par', interaction.user.tag);
    const config = obtenirConfigGuilde(interaction.guild.id);
    const message = await recupererMessageReglement(interaction.guild, config);
    if (!message) {
        return interaction.reply({
            content: '❌ Aucun règlement publié (ou message introuvable). Utilise d\'abord `/settings rules`.',
            flags: MessageFlags.Ephemeral,
        });
    }
    const json = extraireConteneurReglement(message);
    if (!json) {
        return interaction.reply({
            content: '❌ Le message du règlement n\'a pas le format attendu. Republie-le avec `/settings rules`.',
            flags: MessageFlags.Ephemeral,
        });
    }

    const textes = json.components.filter(c => c.type === 10);
    const titreActuel = String(textes[0]?.content ?? '').replace(/^#\s*/, '').trim();
    const contenuActuel = String(textes[1]?.content ?? '');
    const couleurActuelle = json.accent_color ?? config.rules_color ?? undefined;

    const modal = new ModalBuilder()
        .setCustomId(ID_MODAL_EDITION_REGLEMENT)
        .setTitle('Modifier le règlement');

    const titreInput = new TextInputBuilder()
        .setCustomId('titre')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false)
        .setPlaceholder(TITRE_REGLEMENT_DEFAUT);
    if (titreActuel) titreInput.setValue(titreActuel.slice(0, 256));

    const contenuInput = new TextInputBuilder()
        .setCustomId('contenu')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(30)
        .setMaxLength(3900)
        .setRequired(true);
    if (contenuActuel) contenuInput.setValue(contenuActuel.slice(0, 3900));

    const delaiInput = new TextInputBuilder()
        .setCustomId('delai')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0 = immédiat, ex: 10')
        .setRequired(false)
        .setValue(String(config.rules_accept_delay || 0));

    const { couleurLabel, couleurHexLabel } = buildCouleurLabelComponents(couleurActuelle);

    modal.addLabelComponents(
        new LabelBuilder().setLabel('Titre du règlement').setTextInputComponent(titreInput),
        new LabelBuilder().setLabel('Texte du règlement').setTextInputComponent(contenuInput),
        new LabelBuilder().setLabel('Délai avant attribution du rôle (secondes)').setTextInputComponent(delaiInput),
        couleurLabel,
        couleurHexLabel,
    );
    await interaction.showModal(modal);
}

async function gererSoumissionEditionReglement(interaction) {
    console.log('[reglement-edit] soumission du modal par', interaction.user.tag);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const config = obtenirConfigGuilde(interaction.guild.id);
    const message = await recupererMessageReglement(interaction.guild, config);
    const json = extraireConteneurReglement(message);
    if (!message || !json) {
        return interaction.editReply({ content: '❌ Règlement introuvable, republie-le avec `/settings rules`.' });
    }

    const titreSaisi = (interaction.fields.getTextInputValue('titre') || '').trim();
    const contenu = interaction.fields.getTextInputValue('contenu');
    let delaiRaw = '0';
    try { delaiRaw = interaction.fields.getTextInputValue('delai') || '0'; } catch { /* champ absent */ }
    const delaiSecondes = Math.max(0, Math.min(3600, parseInt(delaiRaw, 10) || 0));

    const couleurResolue = resoudreCouleurDepuisModal(interaction);
    if (couleurResolue === null) {
        return interaction.editReply({ content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `8FC3C8`.' });
    }

    const textes = json.components.filter(c => c.type === 10);
    if (textes.length < 2) {
        return interaction.editReply({ content: '❌ Le message du règlement n\'a pas le format attendu. Republie-le avec `/settings rules`.' });
    }
    const titre = titreSaisi || config.rules_title || TITRE_REGLEMENT_DEFAUT;
    textes[0].content = `# ${titre}`;
    textes[1].content = contenu;
    if (couleurResolue !== undefined) json.accent_color = couleurResolue;

    try {
        await message.edit({
            components: [json],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
        });
    } catch (erreur) {
        console.error('Erreur édition règlement :', erreur.message);
        return interaction.editReply({ content: `❌ Impossible de modifier le règlement : ${erreur.message}` });
    }

    config.rules_title = titre;
    config.rules_accept_delay = delaiSecondes;
    if (couleurResolue !== undefined) config.rules_color = couleurResolue;
    persister('configuration');

    await interaction.editReply({
        content: `✅ Règlement modifié : ${message.url}${delaiSecondes > 0 ? ` • Délai avant rôle : ${delaiSecondes}s` : ''}`,
    });
}

// Anti-doublon : évite qu'un même utilisateur déclenche plusieurs comptes à rebours
// s'il spam la réaction (retire puis remet, par ex.)
const acceptationEnAttente = new Set();

async function gererReactionReglement(reaction, utilisateur) {
    if (utilisateur.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.emoji.name !== EMOJI_REGLEMENT) return;

    let message = reaction.message;
    if (message.partial) {
        try { message = await message.fetch(); } catch { return; }
    }
    if (!message.guild) return;

    const config = obtenirConfigGuilde(message.guild.id);
    if (String(config.rules_message_id) !== String(message.id)) return;

    const idsRoles = [config.member_role_id, config.member_role_id_2].filter(Boolean);
    if (!idsRoles.length) return;

    const rolesAAssigner = idsRoles.map(id => message.guild.roles.cache.get(id)).filter(Boolean);
    if (!rolesAAssigner.length) return;

    const membreBot = message.guild.members.me;
    if (!membreBot?.permissions.has('ManageRoles')) return;

    const assignables = rolesAAssigner.filter(r => r.position < membreBot.roles.highest.position);
    if (!assignables.length) return;

    const cleAttente = `${message.guild.id}_${utilisateur.id}`;
    if (acceptationEnAttente.has(cleAttente)) return; // déjà en attente, on ignore
    acceptationEnAttente.add(cleAttente);

    try {
        const membre = await message.guild.members.fetch(utilisateur.id);
        const rolesAAjouter = assignables.filter(r => !membre.roles.cache.has(r.id));
        if (!rolesAAjouter.length) {
            acceptationEnAttente.delete(cleAttente);
            return;
        }

        const delaiSecondes = config.rules_accept_delay || 0;

        if (delaiSecondes <= 0) {
            await membre.roles.add(rolesAAjouter, 'Acceptation règlement (réaction)');
            acceptationEnAttente.delete(cleAttente);
            return;
        }

        // Message d'attente temporaire, supprimé une fois le rôle attribué
        let messageAttente = null;
        try {
            messageAttente = await message.channel.send({
                content: `⏳ <@${utilisateur.id}>, ton rôle sera attribué dans **${delaiSecondes} secondes**...`,
            });
        } catch (erreur) {
            console.error('Erreur envoi message attente règlement:', erreur.message);
        }

        setTimeout(async () => {
            try {
                const membreActualise = await message.guild.members.fetch(utilisateur.id).catch(() => null);
                if (membreActualise) {
                    const manquants = rolesAAjouter.filter(r => !membreActualise.roles.cache.has(r.id));
                    if (manquants.length) {
                        await membreActualise.roles.add(manquants, 'Acceptation règlement (réaction, délai écoulé)');
                    }
                }
            } catch (erreur) {
                console.error('Erreur attribution rôle règlement (après délai):', erreur.message);
            } finally {
                acceptationEnAttente.delete(cleAttente);
                if (messageAttente) {
                    messageAttente.delete().catch(() => { });
                }
            }
        }, delaiSecondes * 1000);
    } catch (erreur) {
        console.error('Erreur attribution rôle règlement:', erreur.message);
        acceptationEnAttente.delete(cleAttente);
    }
}

async function gererClicBoutonReglement(interaction) {
    const message = interaction.message;
    if (!message?.guild) {
        return interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
    }

    const config = obtenirConfigGuilde(interaction.guild.id);
    if (String(config.rules_message_id) !== String(message.id)) {
        return interaction.reply({ content: '❌ Ce règlement n\'est plus actif.', flags: MessageFlags.Ephemeral });
    }

    const idsRoles = [config.member_role_id, config.member_role_id_2].filter(Boolean);
    if (!idsRoles.length) {
        return interaction.reply({ content: '❌ Aucun rôle n\'est configuré pour ce règlement.', flags: MessageFlags.Ephemeral });
    }

    const rolesAAssigner = idsRoles.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
    if (!rolesAAssigner.length) {
        return interaction.reply({ content: '❌ Les rôles configurés sont introuvables.', flags: MessageFlags.Ephemeral });
    }

    const membreBot = interaction.guild.members.me;
    if (!membreBot?.permissions.has('ManageRoles')) {
        return interaction.reply({ content: '❌ Le bot n\'a pas la permission de gérer les rôles.', flags: MessageFlags.Ephemeral });
    }

    const assignables = rolesAAssigner.filter(r => r.position < membreBot.roles.highest.position);
    if (!assignables.length) {
        return interaction.reply({ content: '❌ Le bot ne peut pas attribuer ce(s) rôle(s) (hiérarchie).', flags: MessageFlags.Ephemeral });
    }

    const membre = interaction.member;
    const rolesAAjouter = assignables.filter(r => !membre.roles.cache.has(r.id));
    if (!rolesAAjouter.length) {
        return interaction.reply({ content: '✅ Tu as déjà accepté le règlement.', flags: MessageFlags.Ephemeral });
    }

    const cleAttente = `${interaction.guild.id}_${interaction.user.id}`;
    if (acceptationEnAttente.has(cleAttente)) {
        return interaction.reply({ content: '⏳ Ta demande est déjà en cours de traitement.', flags: MessageFlags.Ephemeral });
    }
    acceptationEnAttente.add(cleAttente);

    const delaiSecondes = config.rules_accept_delay || 0;

    if (delaiSecondes <= 0) {
        try {
            await membre.roles.add(rolesAAjouter, 'Acceptation règlement (bouton)');
            await interaction.reply({ content: '✅ Règlement accepté, ton rôle a été attribué !', flags: MessageFlags.Ephemeral });
        } catch (erreur) {
            console.error('Erreur attribution rôle règlement (bouton):', erreur.message);
            await interaction.reply({ content: '❌ Une erreur est survenue lors de l\'attribution du rôle.', flags: MessageFlags.Ephemeral });
        } finally {
            acceptationEnAttente.delete(cleAttente);
        }
        return;
    }

    await interaction.reply({
        content: `⏳ Règlement accepté ! Ton rôle sera attribué dans **${delaiSecondes} secondes**...`,
        flags: MessageFlags.Ephemeral,
    });

    setTimeout(async () => {
        try {
            const membreActualise = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (membreActualise) {
                const manquants = rolesAAjouter.filter(r => !membreActualise.roles.cache.has(r.id));
                if (manquants.length) {
                    await membreActualise.roles.add(manquants, 'Acceptation règlement (bouton, délai écoulé)');
                }
            }
        } catch (erreur) {
            console.error('Erreur attribution rôle règlement (bouton, après délai):', erreur.message);
        } finally {
            acceptationEnAttente.delete(cleAttente);
        }
    }, delaiSecondes * 1000);
}

module.exports = {
    // exports français d'origine
    construireLigneSelectionRole,
    gererSelectionRoleReglement,
    gererSoumissionModalReglement,
    gererReactionReglement,
    gererClicBoutonReglement,
    ouvrirEditionReglement,
    gererSoumissionEditionReglement,
    ID_MODAL_EDITION_REGLEMENT,
    stockerImageReglement,
    stockerBoutonsReglement,
    EMOJI_REGLEMENT,
    ID_BOUTON_ACCEPTER,
    MAX_BOUTONS_LIENS,

    // alias anglais — pour compatibilité avec index.js, interactions.js et commands/reglement.js
    buildRoleSelectRow: construireLigneSelectionRole,
    handleReglementRoleSelect: gererSelectionRoleReglement,
    handleReglementModalSubmit: gererSoumissionModalReglement,
    handleRulesReaction: gererReactionReglement,
    handleRulesButtonClick: gererClicBoutonReglement,
    handleReglementEditOpen: ouvrirEditionReglement,
    handleReglementEditSubmit: gererSoumissionEditionReglement,
};