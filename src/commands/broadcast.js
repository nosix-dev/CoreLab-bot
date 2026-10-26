const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  ChannelType,
  TextDisplayBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
} = require('discord.js');
const { resoudreCouleurDepuisModal, buildCouleurLabelComponents } = require('../core/colorPalette');
const {
  getEmbed,
  saveEmbed,
  deleteEmbed,
  listEmbeds,
  buildEmbedContainer,
  MAX_BOUTONS_LIENS,
  EMBED_NAME_REGEX,
} = require('../core/embedManager');

const BROADCAST_NOM = 'draft';
const PAGE_SIZE = 25;
const EXPIRATION_MS = 15 * 60 * 1000;

function getBroadcastKey(ownerId) {
  return `broadcast:${ownerId}`;
}

function getTemplatesKey(ownerId) {
  return `broadcast-templates:${ownerId}`;
}

const pendingSelections = new Map();

function clearPending(ownerId) {
  const entry = pendingSelections.get(ownerId);
  if (entry?.expireTimeout) clearTimeout(entry.expireTimeout);
  pendingSelections.delete(ownerId);
}

function normalizeChannelName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function pickTargetChannel(guild) {
  const allChannels = [...guild.channels.cache.values()].filter(ch => ch.isTextBased() && !ch.isThread());
  const byPosition = (a, b) => {
    const aParentPos = a.parent ? a.parent.position : -1;
    const bParentPos = b.parent ? b.parent.position : -1;
    if (aParentPos !== bParentPos) return aParentPos - bParentPos;
    return a.position - b.position;
  };
  const realAnnouncementChannels = allChannels.filter(ch => ch.type === ChannelType.GuildAnnouncement).sort(byPosition);
  if (realAnnouncementChannels.length) return realAnnouncementChannels[0];
  const annonceByName = allChannels.filter(ch => normalizeChannelName(ch.name).includes('annonce')).sort(byPosition);
  if (annonceByName.length) return annonceByName[0];
  const sortedChannels = [...allChannels].sort(byPosition);
  const eligibleChannels = sortedChannels.filter(ch => ch.permissionsFor(guild.members.me)?.has('SendMessages'));
  if (!eligibleChannels.length) return null;
  const generalChannel = eligibleChannels.find(ch => normalizeChannelName(ch.name).includes('general'));
  if (generalChannel) return generalChannel;
  return eligibleChannels[1] || eligibleChannels[0] || null;
}

async function ensureSendPermission(channel, guild) {
  const me = guild.members.me;
  if (channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) return true;
  try {
    await channel.permissionOverwrites.edit(me.id, { ViewChannel: true, SendMessages: true });
    return true;
  } catch (e) {
    console.error(`Impossible de s'accorder l'accès à #${channel.name} (${guild.name}) :`, e.message);
    return false;
  }
}

async function sendBroadcastToGuild(guild, data) {
  const targetChannel = pickTargetChannel(guild);
  if (!targetChannel) return false;
  const hasAccess = await ensureSendPermission(targetChannel, guild);
  if (!hasAccess) return false;
  try {
    const composants = [];
    if (data.mentionEveryone) composants.push(new TextDisplayBuilder().setContent('@everyone'));
    composants.push(buildEmbedContainer(data));
    await targetChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: composants,
      allowedMentions: data.mentionEveryone ? { parse: ['everyone'] } : { parse: [] },
    });
    return true;
  } catch (e) {
    console.error(`Erreur broadcast sur ${guild.name}:`, e.message);
    return false;
  }
}

function buildGuildOptions(entry) {
  const start = entry.page * PAGE_SIZE;
  const pageGuilds = entry.guildsList.slice(start, start + PAGE_SIZE);
  return pageGuilds.map(g => new StringSelectMenuOptionBuilder()
    .setLabel(g.name.slice(0, 100))
    .setValue(g.id)
    .setDescription(`${g.memberCount} membre(s) • ID : ${g.id}`.slice(0, 100))
    .setDefault(entry.selected.has(g.id)));
}

function buildBroadcastGuildView(entry) {
  const totalPages = Math.max(1, Math.ceil(entry.guildsList.length / PAGE_SIZE));
  const options = buildGuildOptions(entry);
  const select = new StringSelectMenuBuilder()
    .setCustomId('broadcast_select')
    .setPlaceholder(`Choisir le(s) serveur(s) — page ${entry.page + 1}/${totalPages}`)
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('broadcast_prev').setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(entry.page <= 0),
    new ButtonBuilder().setCustomId('broadcast_next').setLabel('▶️ Suivant').setStyle(ButtonStyle.Secondary).setDisabled(entry.page >= totalPages - 1),
  );
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('broadcast_send_selected').setLabel(`✅ Envoyer à la sélection (${entry.selected.size})`).setStyle(ButtonStyle.Success).setDisabled(entry.selected.size === 0),
    new ButtonBuilder().setCustomId('broadcast_send_all').setLabel(`🌐 Envoyer à tous (${entry.guildsList.length})`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('broadcast_cancel').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger),
  );
  return {
    content: `**📢 Choix des serveurs** — sélectionne un ou plusieurs serveurs (ou envoie à tous), page ${entry.page + 1}/${totalPages}.`,
    components: [new ActionRowBuilder().addComponents(select), navRow, actionRow],
  };
}

// ── Version broadcast de buildCategoryEditPayload (customIds bcembed::) ──

function buildBcCategoryEditPayload(nom, data) {
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
    .setCustomId(`bcembed::categoryselect::${nom}`)
    .setPlaceholder('Choisir une catégorie à modifier ou supprimer')
    .addOptions(options.slice(0, 25));
  return {
    content: `Catégories de la diffusion :`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

// ── Modals avec customIds bcembed:: ──

function buildBcBasicModal(nom, data) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalbasic::${nom}`).setTitle('Infos de base');
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

function buildBcAuthorModal(nom, data) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalauthor::${nom}`).setTitle('Auteur de l\'embed');
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

function buildBcFooterModal(nom, data) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalfooter::${nom}`).setTitle('Footer de l\'embed');
  const texteInput = new TextInputBuilder().setCustomId('texte').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setPlaceholder('Texte du footer');
  if (data.footer?.text) texteInput.setValue(String(data.footer.text));
  const texteLabel = new LabelBuilder().setLabel('Texte').setTextInputComponent(texteInput);
  const iconInput = new TextInputBuilder().setCustomId('icone').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de la petite icône du footer (optionnel)');
  if (data.footer?.iconURL) iconInput.setValue(String(data.footer.iconURL));
  const iconLabel = new LabelBuilder().setLabel('Icône (URL, optionnel)').setTextInputComponent(iconInput);
  modal.addLabelComponents(texteLabel, iconLabel);
  return modal;
}

function buildBcImagesModal(nom, data) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalimages::${nom}`).setTitle('Images de l\'embed');
  const thumbInput = new TextInputBuilder().setCustomId('miniature').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de la miniature');
  if (data.thumbnail) thumbInput.setValue(String(data.thumbnail));
  const thumbLabel = new LabelBuilder().setLabel('Miniature (URL)').setTextInputComponent(thumbInput);
  const imageInput = new TextInputBuilder().setCustomId('image').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('URL de l\'image principale');
  if (data.image) imageInput.setValue(String(data.image));
  const imageLabel = new LabelBuilder().setLabel('Image principale (URL)').setTextInputComponent(imageInput);
  modal.addLabelComponents(thumbLabel, imageLabel);
  return modal;
}

function buildBcCategoryModal(nom, idx = null, categorie = null) {
  const suffixe = (idx !== null && idx !== undefined) ? `::${idx}` : '::new';
  const modal = new ModalBuilder()
    .setCustomId(`bcembed::modalcategory::${nom}${suffixe}`)
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

function buildBcSaveModal(nom) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalsave::${nom}`).setTitle('Sauvegarder ce modèle');
  const nomInput = new TextInputBuilder().setCustomId('nommodele').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setPlaceholder('Nom court, ex : promo-noel');
  const nomLabel = new LabelBuilder().setLabel('Nom du modèle').setTextInputComponent(nomInput);
  modal.addLabelComponents(nomLabel);
  return modal;
}

function buildBcBannerModal(nom, data) {
  const modal = new ModalBuilder().setCustomId(`bcembed::modalbanner::${nom}`).setTitle('Bannière de l\'annonce');
  const urlInput = new TextInputBuilder().setCustomId('banniere').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://... (lien direct vers l\'image)');
  if (data.image) urlInput.setValue(String(data.image).slice(0, 4000));
  const urlLabel = new LabelBuilder()
    .setLabel('Lien de la bannière')
    .setDescription('Vide = envoyer une image en pièce jointe ensuite • « retirer » = enlever la bannière')
    .setTextInputComponent(urlInput);
  modal.addLabelComponents(urlLabel);
  return modal;
}

// Attend une image en pièce jointe dans le salon (2 min) et l'enregistre comme bannière.
// ⚠️ Le message avec l'image n'est PAS supprimé (sinon le lien de la pièce jointe meurt).
async function collecterBanniereUpload(interaction, key) {
  let msg;
  try {
    const collected = await interaction.channel.awaitMessages({
      filter: m => m.author.id === interaction.user.id,
      max: 1,
      time: 120000,
      errors: ['time'],
    });
    msg = collected.first();
  } catch (e) {
    return interaction.followUp({ content: '⏱️ Aucune image reçue, annulé.', flags: MessageFlags.Ephemeral }).catch(() => { });
  }
  const texte = (msg.content || '').trim().toLowerCase();
  const dataActuelle = getEmbed(key, BROADCAST_NOM);
  if (!dataActuelle) {
    return interaction.followUp({ content: '❌ Cette diffusion a expiré.', flags: MessageFlags.Ephemeral }).catch(() => { });
  }
  if (texte === 'annuler') {
    await msg.delete().catch(() => { });
    return interaction.followUp({ content: '❌ Annulé, bannière inchangée.', flags: MessageFlags.Ephemeral }).catch(() => { });
  }
  const attachment = msg.attachments.find(a => a.contentType?.startsWith('image/'));
  if (!attachment) {
    await msg.delete().catch(() => { });
    return interaction.followUp({ content: '❌ Aucune image valide trouvée dans ce message.', flags: MessageFlags.Ephemeral }).catch(() => { });
  }
  dataActuelle.image = attachment.url;
  saveEmbed(key, BROADCAST_NOM, dataActuelle);
  await interaction.message?.edit(buildBroadcastPanelPayload(interaction.user.id)).catch(() => { });
  return interaction.followUp({
    content: '✅ Bannière enregistrée ! Garde ton message avec l\'image dans le salon jusqu\'à l\'envoi de l\'annonce (tu pourras le supprimer ensuite).',
    flags: MessageFlags.Ephemeral,
  }).catch(() => { });
}

// ── Panneau broadcast ──

function buildBroadcastPanelPayload(ownerId) {
  const data = getEmbed(getBroadcastKey(ownerId), BROADCAST_NOM);
  if (!data) return null;
  const ligneMentions = data.mentionEveryone ? `\n-# 🔔 @everyone sera mentionné avec cette annonce` : '';
  const topText = new TextDisplayBuilder().setContent(
    `**📢 Diffusion en préparation**\n-# Construis ton annonce avec les boutons ci-dessous, puis clique sur **Serveurs & Envoi**.${ligneMentions}`
  );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bcembed::basic::${BROADCAST_NOM}`).setLabel('Infos de base').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::author::${BROADCAST_NOM}`).setLabel('Auteur').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::footer::${BROADCAST_NOM}`).setLabel('Footer').setEmoji('🦶').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::images::${BROADCAST_NOM}`).setLabel('Images').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::category::${BROADCAST_NOM}`).setLabel('Catégorie').setEmoji('🗂️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bcembed::categoryedit::${BROADCAST_NOM}`).setLabel('Modifier catégorie').setEmoji('🖊️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::banner::${BROADCAST_NOM}`).setLabel('Bannière').setEmoji('🏞️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::buttons::${BROADCAST_NOM}`).setLabel('Boutons').setEmoji('🔘').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::mention::${BROADCAST_NOM}`).setLabel(data.mentionEveryone ? '@everyone : Activé' : '@everyone : Désactivé').setEmoji('📣').setStyle(data.mentionEveryone ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bcembed::refresh::${BROADCAST_NOM}`).setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::save::${BROADCAST_NOM}`).setLabel('Sauvegarder').setEmoji('💾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::load::${BROADCAST_NOM}`).setLabel('Charger').setEmoji('📂').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bcembed::cancel::${BROADCAST_NOM}`).setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bcembed::servers::${BROADCAST_NOM}`).setLabel('Serveurs & Envoi').setEmoji('🌍').setStyle(ButtonStyle.Success),
  );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [topText, buildEmbedContainer(data), row1, row2, row3, row4],
  };
}

async function broadcast(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) {
    return message.channel.send('❌ Vous n\'êtes pas autorisé.');
  }
  if (!client.guilds.cache.size) {
    return message.channel.send('❌ CoreLab n\'est présent sur aucun serveur.');
  }
  const key = getBroadcastKey(message.author.id);
  const contenu = message.content.slice('!broadcast'.length).trim();
  const image = message.attachments.find(a => a.contentType?.startsWith('image/'));
  saveEmbed(key, BROADCAST_NOM, {
    title: null,
    description: contenu || null,
    url: null,
    color: null,
    author: null,
    footer: null,
    thumbnail: null,
    image: image ? image.url : null,
    mentionEveryone: false,
  });
  clearPending(message.author.id);
  await message.channel.send(buildBroadcastPanelPayload(message.author.id));
}

async function routeBroadcastEmbedInteraction(interaction) {
  try {
    if (interaction.user.id !== interaction.client.BOT_OWNER_ID) {
      return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé.', flags: MessageFlags.Ephemeral }).catch(() => { });
    }
    const parts = String(interaction.customId || '').split('::');
    const action = parts[1];
    const key = getBroadcastKey(interaction.user.id);

    if (interaction.isButton()) {
      const data = getEmbed(key, BROADCAST_NOM);
      if (!data) {
        return interaction.update({
          flags: MessageFlags.IsComponentsV2,
          components: [new TextDisplayBuilder().setContent('❌ Cette diffusion a expiré ou a été annulée. Relance `!broadcast`.')],
        });
      }
      if (action === 'basic') return interaction.showModal(buildBcBasicModal(BROADCAST_NOM, data));
      if (action === 'author') return interaction.showModal(buildBcAuthorModal(BROADCAST_NOM, data));
      if (action === 'footer') return interaction.showModal(buildBcFooterModal(BROADCAST_NOM, data));
      if (action === 'images') return interaction.showModal(buildBcImagesModal(BROADCAST_NOM, data));
      if (action === 'category') return interaction.showModal(buildBcCategoryModal(BROADCAST_NOM));
      if (action === 'categoryedit') {
        return interaction.reply({ ...buildBcCategoryEditPayload(BROADCAST_NOM, data), flags: MessageFlags.Ephemeral });
      }
      if (action === 'mention') {
        data.mentionEveryone = !data.mentionEveryone;
        saveEmbed(key, BROADCAST_NOM, data);
        return interaction.update(buildBroadcastPanelPayload(interaction.user.id));
      }

      if (action === 'banner') return interaction.showModal(buildBcBannerModal(BROADCAST_NOM, data));

      // ── Boutons-liens : on peut en AJOUTER plusieurs (un message = une ou plusieurs lignes) ──
      if (action === 'buttons') {
        const actuels = Array.isArray(data.buttonLines) ? data.buttonLines : [];
        const liste = actuels.length
          ? actuels.map((l, i) => `\`${i + 1}.\` ${l}`).join('\n')
          : '*(aucun bouton pour l\'instant)*';
        try {
          await interaction.reply({
            content: `🔘 **Boutons-liens** (${actuels.length}/${MAX_BOUTONS_LIENS})\n${liste}\n\n` +
              `Envoie **dans ce salon** (2 minutes) le ou les boutons à **ajouter**, un par ligne : \`Label | https://lien\`.\n` +
              `Tape \`retirer 2\` pour supprimer le bouton n°2, \`vider\` pour tout supprimer, \`annuler\` pour ne rien changer.`,
            flags: MessageFlags.Ephemeral,
          });
        } catch (e) {
          console.error('Erreur reply boutons broadcast :', e.message);
          return;
        }
        let msg;
        try {
          const collected = await interaction.channel.awaitMessages({
            filter: m => m.author.id === interaction.user.id,
            max: 1,
            time: 120000,
            errors: ['time'],
          });
          msg = collected.first();
        } catch (e) {
          return interaction.followUp({ content: '⏱️ Aucun message reçu, annulé.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        const contenuLignes = (msg.content || '').trim();
        await msg.delete().catch(() => { });
        const dataActuelle = getEmbed(key, BROADCAST_NOM);
        if (!dataActuelle) {
          return interaction.followUp({ content: '❌ Cette diffusion a expiré.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        const boutons = Array.isArray(dataActuelle.buttonLines) ? [...dataActuelle.buttonLines] : [];
        const commande = contenuLignes.toLowerCase();
        const rafraichirPanneau = () => interaction.message?.edit(buildBroadcastPanelPayload(interaction.user.id)).catch(() => { });

        if (commande === 'annuler') {
          return interaction.followUp({ content: '❌ Annulé, boutons inchangés.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        if (commande === 'vider') {
          dataActuelle.buttonLines = [];
          saveEmbed(key, BROADCAST_NOM, dataActuelle);
          await rafraichirPanneau();
          return interaction.followUp({ content: '🗑️ Tous les boutons ont été supprimés.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        const mRetirer = commande.match(/^retirer\s+(\d+)$/);
        if (mRetirer) {
          const n = parseInt(mRetirer[1], 10);
          if (n < 1 || n > boutons.length) {
            return interaction.followUp({ content: `❌ Le bouton n°${n} n'existe pas.`, flags: MessageFlags.Ephemeral }).catch(() => { });
          }
          const [retire] = boutons.splice(n - 1, 1);
          dataActuelle.buttonLines = boutons;
          saveEmbed(key, BROADCAST_NOM, dataActuelle);
          await rafraichirPanneau();
          return interaction.followUp({ content: `🗑️ Bouton retiré : ${retire}`, flags: MessageFlags.Ephemeral }).catch(() => { });
        }

        // Ajout : une ligne valide = « Label | https://lien »
        const formatValide = /^[^|]+\|\s*https?:\/\/\S+$/i;
        const lignes = contenuLignes.split('\n').map(l => l.trim()).filter(Boolean);
        const valides = lignes.filter(l => formatValide.test(l));
        const invalides = lignes.filter(l => !formatValide.test(l));
        const places = Math.max(0, MAX_BOUTONS_LIENS - boutons.length);
        const ajoutes = valides.slice(0, places);
        const ignores = valides.length - ajoutes.length;

        if (!ajoutes.length) {
          const raison = !valides.length
            ? 'Aucune ligne valide. Format attendu : `Label | https://lien`.'
            : `Limite atteinte (${MAX_BOUTONS_LIENS} boutons max). Retire-en un avec \`retirer N\` avant d'en ajouter.`;
          return interaction.followUp({ content: `❌ ${raison}`, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        dataActuelle.buttonLines = [...boutons, ...ajoutes];
        saveEmbed(key, BROADCAST_NOM, dataActuelle);
        await rafraichirPanneau();

        let retour = `✅ ${ajoutes.length} bouton(s) ajouté(s) — ${dataActuelle.buttonLines.length}/${MAX_BOUTONS_LIENS} au total.`;
        if (ignores > 0) retour += `\n⚠️ ${ignores} ligne(s) ignorée(s) : limite de ${MAX_BOUTONS_LIENS} boutons atteinte.`;
        if (invalides.length) retour += `\n⚠️ ${invalides.length} ligne(s) ignorée(s) (format invalide, attendu \`Label | https://lien\`).`;
        return interaction.followUp({ content: retour, flags: MessageFlags.Ephemeral }).catch(() => { });
      }
      if (action === 'refresh') return interaction.update(buildBroadcastPanelPayload(interaction.user.id));
      if (action === 'save') return interaction.showModal(buildBcSaveModal(BROADCAST_NOM));
      if (action === 'load') {
        const templatesKey = getTemplatesKey(interaction.user.id);
        const noms = listEmbeds(templatesKey);
        if (!noms.length) {
          return interaction.reply({
            content: '❌ Aucun modèle sauvegardé pour l\'instant. Configure une annonce puis clique sur **Sauvegarder** pour en créer un.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const options = noms.slice(0, 25).map(n => new StringSelectMenuOptionBuilder().setLabel(n).setValue(n));
        const select = new StringSelectMenuBuilder()
          .setCustomId(`bcembed::templateselect::${BROADCAST_NOM}`)
          .setPlaceholder('Choisir un modèle à charger')
          .addOptions(options);
        return interaction.reply({
          content: '📂 Choisis le modèle à charger. ⚠️ Cela remplace le brouillon actuel (titre, description, boutons, mentions...).',
          components: [new ActionRowBuilder().addComponents(select)],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (action === 'cancel') {
        deleteEmbed(key, BROADCAST_NOM);
        clearPending(interaction.user.id);
        return interaction.update({ flags: MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent('🗑️ Diffusion annulée.')] });
      }
      if (action === 'servers') {
        const guildsList = [...interaction.client.guilds.cache.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(g => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
        if (!guildsList.length) {
          return interaction.reply({ content: '❌ CoreLab n\'est présent sur aucun serveur.', flags: MessageFlags.Ephemeral });
        }
        const entry = { ownerId: interaction.user.id, guildsList, page: 0, selected: new Set(), expireTimeout: null };
        entry.expireTimeout = setTimeout(() => clearPending(interaction.user.id), EXPIRATION_MS);
        pendingSelections.set(interaction.user.id, entry);
        return interaction.reply({ ...buildBroadcastGuildView(entry), flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (action === 'templateselect') {
        const templatesKey = getTemplatesKey(interaction.user.id);
        const nomModele = interaction.values[0];
        const modele = getEmbed(templatesKey, nomModele);
        if (!modele) {
          return interaction.update({ content: '❌ Ce modèle n\'existe plus.', components: [] });
        }
        const copie = JSON.parse(JSON.stringify(modele));
        saveEmbed(key, BROADCAST_NOM, copie);
        return interaction.update({
          content: `✅ Modèle \`${nomModele}\` chargé. Clique sur **Actualiser** dans le panneau pour voir le résultat.`,
          components: [],
        });
      }
      if (action !== 'categoryselect') return;
      const data = getEmbed(key, BROADCAST_NOM);
      if (!data) {
        return interaction.update({ content: '❌ Cette diffusion a expiré.', components: [] });
      }
      const valeur = interaction.values[0] || '';
      const [type, idxRaw] = valeur.split(':');
      const idx = parseInt(idxRaw, 10);
      const categories = Array.isArray(data.categories) ? data.categories : [];
      if (!Number.isInteger(idx) || !categories[idx]) {
        return interaction.update({ content: '❌ Cette catégorie n\'existe plus.', components: [] });
      }
      if (type === 'edit') {
        return interaction.showModal(buildBcCategoryModal(BROADCAST_NOM, idx, categories[idx]));
      }
      if (type === 'del') {
        categories.splice(idx, 1);
        data.categories = categories;
        saveEmbed(key, BROADCAST_NOM, data);
        return interaction.update({
          content: '🗑️ Catégorie supprimée. Clique sur **Actualiser** dans le panneau pour voir le résultat.',
          components: buildBcCategoryEditPayload(BROADCAST_NOM, data).components,
        });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const val = (id) => {
        try { return interaction.fields.getTextInputValue(id).trim(); } catch (_) { return ''; }
      };
      if (action === 'modalsave') {
        const nomModele = val('nommodele').toLowerCase().trim().replace(/\s+/g, '-');
        if (!EMBED_NAME_REGEX.test(nomModele)) {
          return interaction.reply({
            content: '❌ Nom invalide : lettres minuscules, chiffres, `-` et `_` uniquement (32 caractères max, sans espace).',
            flags: MessageFlags.Ephemeral,
          });
        }
        const dataActuelle = getEmbed(key, BROADCAST_NOM);
        if (!dataActuelle) {
          return interaction.reply({ content: '❌ Cette diffusion a expiré.', flags: MessageFlags.Ephemeral });
        }
        const templatesKey = getTemplatesKey(interaction.user.id);
        const copie = JSON.parse(JSON.stringify(dataActuelle));
        saveEmbed(templatesKey, nomModele, copie);
        return interaction.reply({
          content: `💾 Modèle \`${nomModele}\` sauvegardé. Utilise le bouton **Charger** dans un prochain \`!broadcast\` pour le réutiliser.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (action === 'modalbanner') {
        const saisie = val('banniere');
        const dataActuelle = getEmbed(key, BROADCAST_NOM);
        if (!dataActuelle) {
          return interaction.reply({ content: '❌ Cette diffusion a expiré.', flags: MessageFlags.Ephemeral });
        }
        if (saisie.toLowerCase() === 'retirer') {
          dataActuelle.image = null;
          saveEmbed(key, BROADCAST_NOM, dataActuelle);
          return interaction.update(buildBroadcastPanelPayload(interaction.user.id));
        }
        if (saisie) {
          if (!/^https?:\/\/\S+$/i.test(saisie)) {
            return interaction.reply({ content: '❌ Lien invalide : il doit commencer par `http://` ou `https://`.', flags: MessageFlags.Ephemeral });
          }
          dataActuelle.image = saisie;
          saveEmbed(key, BROADCAST_NOM, dataActuelle);
          return interaction.update(buildBroadcastPanelPayload(interaction.user.id));
        }
        // Champ vide → envoi d'une image en pièce jointe
        await interaction.reply({
          content: '🏞️ Envoie l\'image de la bannière **en pièce jointe** dans ce salon (2 minutes). Tape `annuler` pour ne rien changer.',
          flags: MessageFlags.Ephemeral,
        });
        return collecterBanniereUpload(interaction, key);
      }
      const data = getEmbed(key, BROADCAST_NOM) || {};
      if (action === 'modalbasic') {
        data.title = val('titre') || null;
        data.description = val('description') || null;
        data.url = val('url') || null;
        const couleur = resoudreCouleurDepuisModal(interaction);
        if (couleur !== undefined && couleur !== null) data.color = couleur;
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
          data.categories[idx] = { titre: titreCategorie || null, contenu: contenuCategorie };
          saveEmbed(key, BROADCAST_NOM, data);
          return interaction.update({
            content: '✅ Catégorie modifiée. Clique sur **Actualiser** dans le panneau pour voir le résultat.',
            components: buildBcCategoryEditPayload(BROADCAST_NOM, data).components,
          });
        }
        data.categories.push({ titre: titreCategorie || null, contenu: contenuCategorie });
      } else {
        return;
      }
      saveEmbed(key, BROADCAST_NOM, data);
      return interaction.update(buildBroadcastPanelPayload(interaction.user.id));
    }
  } catch (e) {
    console.error('Erreur routeBroadcastEmbedInteraction :', e);
    const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (_) { }
  }
}

async function routeBroadcastInteraction(interaction) {
  try {
    if (interaction.user.id !== interaction.client.BOT_OWNER_ID) {
      return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé.', flags: MessageFlags.Ephemeral }).catch(() => { });
    }
    const entry = pendingSelections.get(interaction.user.id);
    if (!entry) {
      return interaction.update({
        content: '❌ Cette sélection a expiré. Relance depuis le panneau (bouton **Serveurs & Envoi**).',
        components: [],
      }).catch(() => { });
    }
    const id = interaction.customId;
    if (id === 'broadcast_select') {
      const start = entry.page * PAGE_SIZE;
      const pageIds = entry.guildsList.slice(start, start + PAGE_SIZE).map(g => g.id);
      for (const pid of pageIds) entry.selected.delete(pid);
      for (const v of interaction.values) entry.selected.add(v);
      return interaction.update(buildBroadcastGuildView(entry));
    }
    if (id === 'broadcast_prev') {
      entry.page = Math.max(0, entry.page - 1);
      return interaction.update(buildBroadcastGuildView(entry));
    }
    if (id === 'broadcast_next') {
      const totalPages = Math.max(1, Math.ceil(entry.guildsList.length / PAGE_SIZE));
      entry.page = Math.min(totalPages - 1, entry.page + 1);
      return interaction.update(buildBroadcastGuildView(entry));
    }
    if (id === 'broadcast_cancel') {
      clearPending(interaction.user.id);
      return interaction.update({ content: '❌ Sélection des serveurs fermée. Le brouillon de l\'annonce est conservé.', components: [] });
    }
    if (id === 'broadcast_send_selected' || id === 'broadcast_send_all') {
      const targets = id === 'broadcast_send_all' ? entry.guildsList : entry.guildsList.filter(g => entry.selected.has(g.id));
      if (!targets.length) {
        return interaction.reply({ content: '❌ Aucun serveur sélectionné.', flags: MessageFlags.Ephemeral }).catch(() => { });
      }
      const key = getBroadcastKey(interaction.user.id);
      const data = getEmbed(key, BROADCAST_NOM);
      if (!data) {
        return interaction.update({ content: '❌ Le brouillon de l\'annonce a expiré. Relance `!broadcast`.', components: [] });
      }
      await interaction.update({ content: `⏳ Envoi en cours vers **${targets.length}** serveur(s)...`, components: [] });
      let count = 0;
      for (const g of targets) {
        const guild = interaction.client.guilds.cache.get(g.id);
        if (!guild) continue;
        if (await sendBroadcastToGuild(guild, data)) count++;
      }
      clearPending(interaction.user.id);
      deleteEmbed(key, BROADCAST_NOM);
      return interaction.editReply({
        content: `✅ Annonce envoyée à **${count}**/**${targets.length}** serveur(s) sélectionné(s).`,
        components: [],
      });
    }
  } catch (e) {
    console.error('Erreur routeBroadcastInteraction :', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral }).catch(() => { });
    }
  }
}

module.exports = {
  broadcast,
  routeBroadcastInteraction,
  routeBroadcastEmbedInteraction,
};