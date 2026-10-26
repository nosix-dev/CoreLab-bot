const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
  AttachmentBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const {
  buildCouleurLabelComponents,
  resoudreCouleurDepuisModal
} = require('../core/colorPalette');
const fs = require('fs');
const path = require('path');
const {
  handleReglementRoleSelect,
  handleReglementModalSubmit,
  handleReglementEditSubmit,
  handleRulesButtonClick
} = require('../core/reglement');
const {
  getGuildConfig
} = require('../core/config');
const {
  store,
  persist
} = require('../core/data');
const {
  OWNER_IDS
} = require('../core/constants');
const {
  loadCommands
} = require('./loadCommands');
const {
  requirePremium,
  requireCustomization
} = require('../core/premium');
const {
  safeReply,
  safeComponentUpdate
} = require('../core/safeReply');
const {
  track
} = require('../core/commandStats');
const {
  pushEvent
} = require('../core/dashboardEvents');
const {
  sendTicketClosedLog
} = require('../core/ticketTranscript');
const {
  buildTicketConfigEmbed,
  buildTicketConfigRows,
  buildTicketConfigPayload,
  buildTicketPublishPayload,
  normalizeReasonColor,
  sanitizeEmoji,
  buildTicketReasonButtons,
  buildTicketActionRow,
  createTicketChannel,
  buildFormModal,
  buildFormManagerRows,
  pendingForms,
  pendingKey,
  DOSSIER_IMAGES_FORMULAIRE,
  sauvegarderImageFormulaireLocalement,
  normFormMeta
} = require('./ticket');
// ── Partenariats : moteur du flux (modale → salon → rôles → aperçu → publication) ──
// ⚠️ Adapte le chemin si ton fichier de commandes a un autre nom (ex. ../commands/index.js)
const {
  handlePartnershipInteraction
} = require('../commands/general');

// ────────────────────────────────────────────────
// Stockage local de l'image de bannière des tickets
// (une URL d'attachment Discord meurt si on supprime le message
// source, donc on télécharge le fichier sur le disque)
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const DOSSIER_IMAGES_TICKET = path.join(__dirname, '..', 'data', 'ticket_images');
if (!fs.existsSync(DOSSIER_IMAGES_TICKET)) fs.mkdirSync(DOSSIER_IMAGES_TICKET, {
  recursive: true
});

// Limite d'upload Discord selon le niveau de boost du serveur.
// (Chiffres actuels de Discord, susceptibles d'évoluer — le try/catch
// à l'envoi reste le vrai filet de sécurité en cas de changement.)
function limiteUploadServeur(guild) {
  const tier = guild?.premiumTier ?? 0; // 0 = 'NONE' en discord.js v14
  if (tier === 3) return 100 * 1024 * 1024;
  if (tier === 2) return 50 * 1024 * 1024;
  return 25 * 1024 * 1024; // Tier 0 et 1
}
async function sauvegarderImageTicketLocalement(guildId, channelId, attachment, guild) {
  const ext = (path.extname(attachment.name || '') || '.png').toLowerCase();
  const nomFichier = `${guildId}_${channelId}${ext}`;
  const cheminFichier = path.join(DOSSIER_IMAGES_TICKET, nomFichier);

  // Vérifie la taille AVANT de télécharger/stocker quoi que ce soit :
  // Discord fournit déjà `attachment.size`, pas besoin de fetch pour le savoir.
  const limite = limiteUploadServeur(guild);
  if (attachment.size > limite) {
    const tailleMo = (attachment.size / (1024 * 1024)).toFixed(1);
    const limiteMo = (limite / (1024 * 1024)).toFixed(0);
    throw new Error(`Fichier trop volumineux (${tailleMo} Mo, limite du serveur : ${limiteMo} Mo).`);
  }

  // Nettoie d'anciens fichiers avec une autre extension pour ce salon
  for (const f of fs.readdirSync(DOSSIER_IMAGES_TICKET)) {
    if (f.startsWith(`${guildId}_${channelId}.`) && f !== nomFichier) {
      fs.unlinkSync(path.join(DOSSIER_IMAGES_TICKET, f));
    }
  }
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Téléchargement image échoué (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cheminFichier, buffer);
  return nomFichier;
}
async function handleTicketComponent(interaction) {
  const id = interaction.customId;

  // ── Ajouter une raison ──────────────────────────────
  if (id === 'ticket_add_reason') {
    const modal = new ModalBuilder().setCustomId('ticket_add_reason_modal').setTitle('Ajouter une raison de ticket');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Nom (label)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('ID interne').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Couleur (rouge/vert/bleu/gris/auto/#hex)').setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(false).setValue('blurple')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Courte description (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)));
    return interaction.showModal(modal);
  }

  // ── Retirer une raison ────────────────────────────
  if (id === 'ticket_remove_reason') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    if (!reasons.length) {
      return interaction.reply({
        content: '❌ Aucune raison à retirer dans ce salon.',
        flags: MessageFlags.Ephemeral
      });
    }
    const modal = new ModalBuilder().setCustomId('ticket_remove_reason_modal').setTitle('Retirer une raison de ticket');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('ID interne de la raison').setPlaceholder('Ex. : support_general').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
    return interaction.showModal(modal);
  }

  // ── Modifier une raison ──────────────────────────────
  if (id === 'ticket_edit_reason') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    if (!reasons.length) {
      return interaction.reply({
        content: '❌ Aucune raison à modifier dans ce salon.',
        flags: MessageFlags.Ephemeral
      });
    }
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_edit_reason_select').setPlaceholder('Choisis la raison à modifier').addOptions(reasons.slice(0, 25).map(r => ({
      label: `${r.label}`.slice(0, 100),
      description: `ID : ${r.value}`.slice(0, 100),
      value: r.value,
      emoji: sanitizeEmoji(r.emoji) || undefined
    })));
    const row = new ActionRowBuilder().addComponents(menu);
    return interaction.reply({
      content: '✏️ Choisis la raison à modifier :',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Voir la liste ───────────────────────────────────
  if (id === 'ticket_show_list') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    if (!reasons.length) {
      return interaction.reply({
        content: '❌ Aucune raison configurée dans ce salon.',
        flags: MessageFlags.Ephemeral
      });
    }
    const lines = reasons.map(r => `${r.emoji || '•'} **${r.label}** — ID : \`${r.value}\``);
    const refId = cfg.ticket_categories?.[chKey];
    const embed = new EmbedBuilder().setTitle('📋 Raisons de tickets configurées (ce salon)').setDescription(lines.join('\n')).addFields({
      name: '📂 Salon de référence',
      value: refId ? `<#${refId}>` : '❌ Non défini',
      inline: false
    }).setFooter({
      text: `${reasons.length} raison(s) dans ce salon`
    }).setColor(0xFFFFFF);
    return interaction.reply(toCV2Payload({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    }));
  }

  // ── Choisir le salon de référence ──────────────────────────
  if (id === 'ticket_choose_category') {
    const select = new ChannelSelectMenuBuilder().setCustomId('ticket_set_category').setPlaceholder('Choisis la catégorie (les tickets seront créés dedans)').addChannelTypes(ChannelType.GuildCategory);
    return safeReply(interaction, {
      content: 'Choisis la catégorie :',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral
    });
  }
  if (id === 'ticket_set_category') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    if (!cfg.ticket_categories) cfg.ticket_categories = {};
    const chosen = interaction.values[0]; // corrigé : interaction.channels.first() n'existe pas en v14
    cfg.ticket_categories[chKey] = chosen;
    persist('config');
    return safeReply(interaction, {
      content: `✅ Les tickets ouverts depuis ce salon seront créés dans la catégorie <#${chosen}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Personnaliser l'apparence (🎨 Personnalisation) ──
  if (id === 'ticket_appearance') {
    if (!(await requireCustomization(interaction))) return;
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const current = cfg.ticket_appearance?.[chKey] || {};
    const modal = new ModalBuilder().setCustomId('ticket_appearance_modal').setTitle('🎨 Apparence du panneau (Personnalisation)');
    const titreInput = new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(current.title || '🎫 Support & Tickets');
    const titreLabel = new LabelBuilder().setLabel('Titre du panneau').setTextInputComponent(titreInput);
    const descriptionInput = new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false).setValue(current.description || '');
    const descriptionLabel = new LabelBuilder().setLabel('Texte d\'intro (avant la liste)').setTextInputComponent(descriptionInput);
    const {
      couleurLabel,
      couleurHexLabel
    } = buildCouleurLabelComponents(current.color);
    modal.addLabelComponents(titreLabel, descriptionLabel, couleurLabel, couleurHexLabel);
    return interaction.showModal(modal);
  }

  // ── Personnaliser le message envoyé à l'ouverture d'un ticket ──
  if (id === 'ticket_open_msg') {
    if (!(await requireCustomization(interaction))) return;
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const current = cfg.ticket_appearance?.[chKey] || {};
    const modal = new ModalBuilder().setCustomId('ticket_open_msg_modal').setTitle('✉️ Message d\'ouverture de ticket');
    const titreInput = new TextInputBuilder().setCustomId('open_title').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false).setValue(current.openTitle || '');
    const titreLabel = new LabelBuilder().setLabel('Titre').setDescription('Variables : {membre} {raison} — laisser vide pour le titre par défaut').setTextInputComponent(titreInput);
    const messageInput = new TextInputBuilder().setCustomId('open_description').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false).setValue(current.openDescription || '');
    const messageLabel = new LabelBuilder().setLabel('Message').setDescription('Variables : {membre} {raison} — laisser vide pour le message par défaut').setTextInputComponent(messageInput);
    modal.addLabelComponents(titreLabel, messageLabel);
    return interaction.showModal(modal);
  }

  // ── Activer/Désactiver le bouton Claim (⭐ Premium) ──
  if (id === 'ticket_toggle_claim') {
    if (!(await requirePremium(interaction))) return;
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    if (!cfg.ticket_claim_enabled) cfg.ticket_claim_enabled = {};
    cfg.ticket_claim_enabled[chKey] = !cfg.ticket_claim_enabled[chKey];
    persist('config');

    // Rafraîchit la carte du panneau (la tuile « Bouton Claim » change d'état),
    // puis confirme en message éphémère séparé.
    try {
      await safeComponentUpdate(interaction, buildTicketConfigPayload(cfg, interaction.channel.id, interaction.guild));
    } catch (e) {
      console.error('Erreur rafraîchissement panneau ticket (claim) :', e.message);
    }
    return interaction.followUp({
      content: cfg.ticket_claim_enabled[chKey] ? '✅ Bouton **Claim** activé pour les tickets ouverts depuis ce salon.' : '❌ Bouton **Claim** désactivé pour ce salon.',
      flags: MessageFlags.Ephemeral
    }).catch(() => { });
  }

  // ── Définir l'image du panneau (🎨 Personnalisation) ──
  if (id === 'ticket_set_image') {
    if (!(await requireCustomization(interaction))) return;
    const chKey = String(interaction.channel.id);
    try {
      await interaction.reply({
        content: '🖼️ Envoie l\'image à utiliser (en pièce jointe) dans ce salon, tu as 2 minutes. Envoie `annuler` pour arrêter.',
        flags: MessageFlags.Ephemeral
      });
    } catch (e) {
      console.error('Erreur reply ticket_set_image :', e.message);
      return;
    }
    const collector = interaction.channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id,
      time: 120000,
      max: 1
    });
    collector.on('collect', async msg => {
      try {
        const attachment = msg.attachments.find(a => a.contentType?.startsWith('image/'));
        if (msg.content?.trim().toLowerCase() === 'annuler') {
          await msg.delete().catch(() => { });
          await interaction.followUp({
            content: '❌ Annulé.',
            flags: MessageFlags.Ephemeral
          }).catch(() => { });
          return;
        }
        if (!attachment) {
          await msg.delete().catch(() => { });
          await interaction.followUp({
            content: '❌ Aucune image valide trouvée dans ce message.',
            flags: MessageFlags.Ephemeral
          }).catch(() => { });
          return;
        }
        const cfg = getGuildConfig(interaction.guild.id);
        let nomFichier;
        try {
          nomFichier = await sauvegarderImageTicketLocalement(interaction.guild.id, chKey, attachment, interaction.guild);
        } catch (e) {
          console.error('Erreur téléchargement image ticket :', e.message);
          await msg.delete().catch(() => { });
          await interaction.followUp({
            content: `❌ ${e.message || 'Échec du téléchargement de l\'image, réessaie.'}`,
            flags: MessageFlags.Ephemeral
          }).catch(() => { });
          return;
        }
        if (!cfg.ticket_appearance) cfg.ticket_appearance = {};
        if (!cfg.ticket_appearance[chKey]) cfg.ticket_appearance[chKey] = {};
        delete cfg.ticket_appearance[chKey].bannerImage; // ancienne URL Discord (ne plus utiliser)
        cfg.ticket_appearance[chKey].bannerImageFile = nomFichier;
        persist('config');
        await msg.delete().catch(() => { });
        await interaction.followUp({
          content: '✅ Image enregistrée ! Republie le panneau (`🎫 Publier le panneau`) pour l\'appliquer.',
          flags: MessageFlags.Ephemeral
        }).catch(() => { });
      } catch (e) {
        console.error('Erreur collecte image ticket :', e.message);
      }
    });
    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.followUp({
          content: '⏱️ Temps écoulé, aucune image reçue.',
          flags: MessageFlags.Ephemeral
        }).catch(() => { });
      }
    });
    return;
  }

  // ── Publier le panneau ───────────────────────────────
  if (id === 'ticket_publish_panel') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    const refId = cfg.ticket_categories?.[chKey];
    if (!refId || !reasons.length) {
      return interaction.reply({
        content: '❌ Choisis d\'abord un salon de référence et ajoute au moins une raison dans ce salon.',
        flags: MessageFlags.Ephemeral
      });
    }
    const appearance = cfg.ticket_appearance?.[chKey];
    // Image perso (🖼️ Image du panneau) : affichée dans le bloc vert de la carte
    let logoPath = null;
    if (appearance?.bannerImageFile) {
      const cheminImage = path.join(DOSSIER_IMAGES_TICKET, appearance.bannerImageFile);
      if (fs.existsSync(cheminImage)) logoPath = cheminImage;
    }
    try {
      // Components V2 : conteneur avec carte « style 4 vert » + boutons à l'intérieur
      const payload = await buildTicketPublishPayload(cfg, interaction.channel.id, interaction.guild, logoPath);
      await interaction.channel.send(payload);
    } catch (e) {
      console.error('Erreur publication panneau ticket :', e.message);
      const tropLourd = e.code === 40005 || /entity too large/i.test(e.message || '');
      return interaction.reply({
        content: tropLourd ? '❌ L\'image du panneau est trop lourde pour ce serveur. Redéfinis-la avec une image/GIF plus léger via 🖼️ Image du panneau.' : '❌ Impossible de publier le panneau (erreur Discord).',
        flags: MessageFlags.Ephemeral
      });
    }
    return interaction.reply({
      content: '✅ Panneau publié dans ce salon !',
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Bouton "Ouvrir un ticket" (raison choisie) ──────
  if (id.startsWith('ticket_reason_')) {
    const rest = id.replace('ticket_reason_', '');
    const [panelChannelId, reasonValue] = rest.split(/_(.+)/).filter((_, i) => i !== 1).length === 2 ? [rest.split('_')[0], rest.split('_').slice(1).join('_')] : rest.split('_');
    const cfg = getGuildConfig(interaction.guild.id);
    const reasons = cfg.ticket_reasons?.[String(panelChannelId)] || [];
    const reason = reasons.find(r => r.value === reasonValue);
    if (!reason) {
      return interaction.reply({
        content: '❌ Raison introuvable.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Vérifie si un ticket est déjà ouvert
    const existing = interaction.guild.channels.cache.find(c => c.topic && c.topic.includes(`from ${interaction.user.tag}`) && c.topic.includes(reason.label));
    if (existing) {
      return interaction.reply({
        content: `❌ Tu as déjà un ticket ouvert : ${existing}`,
        flags: MessageFlags.Ephemeral
      });
    }
    const gid = String(interaction.guild.id);
    const formKey = `${panelChannelId}_${reasonValue}`;
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (fields.length) {
      const key = pendingKey(interaction.user.id, panelChannelId, reasonValue);
      pendingForms.set(key, {
        reasonLabel: reason.label,
        reasonValue,
        panelChannelId,
        allFields: fields,
        answers: {},
        page: 1
      });
      return interaction.showModal(buildFormModal(reason.label, fields, 1));
    } else {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      return createTicketChannel(interaction, reason.label, reasonValue, {}, cfg, interaction.guild, interaction.user, panelChannelId);
    }
  }

  // ── Continuer le formulaire (bouton) ────────────────
  if (id === 'ticket_form_continue') {
    const key = interaction.message.interactionMetadata?.user?.id ? pendingKey(interaction.user.id, interaction.message.metadataPanelId, interaction.message.metadataReasonValue) : null;
    // Solution de repli : l'état est récupéré via le customId encodé
    return; // géré plus bas via les données stockées — voir le handler ticket_form_continue_
  }

  // ── Voir la transcription (bouton du log « Ticket Fermé ») ──
  if (id === 'ticket_transcript') {
    const att = interaction.message.attachments.find(a => /\.html?$/i.test(a.name || ''));
    if (!att) {
      return interaction.reply({
        content: '❌ Fichier de transcription introuvable sur ce message.',
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    try {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return interaction.editReply({
        content: '📄 Transcription du ticket — télécharge le fichier puis ouvre-le dans ton navigateur.',
        files: [new AttachmentBuilder(buf, {
          name: att.name
        })]
      });
    } catch (e) {
      console.error('[Ticket] transcription :', e.message);
      return interaction.editReply({
        content: `❌ Impossible de récupérer le fichier. Lien direct : ${att.url}`
      });
    }
  }

  // ── Fermer le ticket ─────────────────────────────────
  if (id === 'ticket_close_btn') {
    const cfg = getGuildConfig(interaction.guild.id);
    cfg.ticket_open_count = Math.max(0, (cfg.ticket_open_count || 1) - 1);
    persist('config');
    pushEvent({
      icon: '🎫',
      tag: 'tag-sys',
      text: `Ticket fermé par ${interaction.user.tag}`,
      server: interaction.guild.name
    });
    await interaction.reply('🔒 Suppression dans 5 secondes...');
    const channel = interaction.channel;
    const closer = interaction.user;
    setTimeout(async () => {
      // 1) Transcription + log (ne bloque jamais la suppression en cas d'erreur)
      try {
        await sendTicketClosedLog({
          channel,
          closer,
          cfg
        });
      } catch (e) {
        console.error('[Ticket] Échec de la transcription :', e);
      }
      // 2) Nettoyage des métadonnées + suppression du salon
      try {
        if (cfg.ticket_meta?.[channel.id]) {
          delete cfg.ticket_meta[channel.id];
          persist('config');
        }
      } catch { }
      try {
        await channel.delete('Ticket fermé');
      } catch { }
    }, 5000);
    return;
  }

  // ── Prendre en charge le ticket (⭐ Premium — bouton Claim) ──
  if (id === 'ticket_claim_btn') {
    const member = interaction.member;
    const isStaff = member.permissions.has('ManageGuild') || member.permissions.has('ManageChannels');
    if (!isStaff) {
      return interaction.reply({
        content: '❌ Seul le staff peut prendre en charge un ticket.',
        flags: MessageFlags.Ephemeral
      });
    }
    const disabledRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close_btn').setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('ticket_claim_btn').setLabel(`Pris en charge par ${interaction.user.username}`).setEmoji('🖐️').setStyle(ButtonStyle.Secondary).setDisabled(true));
    try {
      await interaction.update({
        components: [disabledRow]
      });
      await interaction.channel.send(`🖐️ Ticket pris en charge par ${interaction.user}.`);
      pushEvent({
        icon: '🖐️',
        tag: 'tag-sys',
        text: `Ticket pris en charge par ${interaction.user.tag}`,
        server: interaction.guild.name
      });
    } catch (e) {
      console.error('Erreur lors du claim du ticket :', e.message);
    }
    return;
  }
}
async function handleTicketModal(interaction) {
  const id = interaction.customId;
  if (id === 'ticket_appearance_modal') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const title = interaction.fields.getTextInputValue('title')?.trim() || null;
    const description = interaction.fields.getTextInputValue('description')?.trim() || null;
    const colorInt = resoudreCouleurDepuisModal(interaction);
    if (colorInt === null) {
      return interaction.reply({
        content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `8FC3C8`.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!cfg.ticket_appearance) cfg.ticket_appearance = {};
    const existing = cfg.ticket_appearance[chKey] || {};
    cfg.ticket_appearance[chKey] = {
      ...existing,
      title: title || undefined,
      description: description || undefined,
      color: colorInt !== undefined ? colorInt : existing.color
    };
    persist('config');
    return interaction.reply({
      content: '✅ Apparence du panneau mise à jour ! Republie le panneau (`🎫 Publier le panneau`) pour appliquer les changements.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (id === 'ticket_open_msg_modal') {
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const openTitle = interaction.fields.getTextInputValue('open_title')?.trim() || undefined;
    const openDescription = interaction.fields.getTextInputValue('open_description')?.trim() || undefined;
    if (!cfg.ticket_appearance) cfg.ticket_appearance = {};
    const existing = cfg.ticket_appearance[chKey] || {};
    cfg.ticket_appearance[chKey] = {
      ...existing,
      openTitle,
      openDescription
    };
    persist('config');
    return interaction.reply({
      content: '✅ Message d\'ouverture de ticket personnalisé ! Il s\'appliquera aux prochains tickets créés depuis ce panneau.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (id.startsWith('ticket_form_style_modal_')) {
    const formKey = id.replace('ticket_form_style_modal_', '');
    const slug = formKey.replace(/^standalone_/, '');
    const gid = String(interaction.guild.id);
    if (!store.formulaires?.[gid]?.[slug]) {
      return interaction.reply({
        content: '❌ Formulaire introuvable.',
        flags: MessageFlags.Ephemeral
      });
    }
    const title = interaction.fields.getTextInputValue('title')?.trim() || null;
    const description = interaction.fields.getTextInputValue('description')?.trim() || null;
    const colorInt = resoudreCouleurDepuisModal(interaction);
    if (colorInt === null) {
      return interaction.reply({
        content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `8FC3C8`.',
        flags: MessageFlags.Ephemeral
      });
    }
    const meta = normFormMeta(store.formulaires[gid][slug]);
    store.formulaires[gid][slug] = {
      ...meta,
      title: title || undefined,
      description: description || undefined,
      color: colorInt !== undefined ? colorInt : meta.color
    };
    persist('formulaires');
    return interaction.reply({
      content: '✅ Apparence mise à jour ! Republie le formulaire (`📨 Publier le formulaire`) pour appliquer les changements.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (id === 'ticket_add_reason_modal') {
    const label = interaction.fields.getTextInputValue('label').trim();
    const value = interaction.fields.getTextInputValue('value').trim().toLowerCase().replace(/\s+/g, '_');
    const emojiRaw = interaction.fields.getTextInputValue('emoji')?.trim() || '';
    const emoji = sanitizeEmoji(emojiRaw);
    if (emojiRaw && !emoji) {
      return interaction.reply({
        content: '❌ Emoji invalide. Mets un seul emoji (ex. : 🎫) ou un emoji du serveur, ou laisse vide.',
        flags: MessageFlags.Ephemeral
      });
    }
    const color = normalizeReasonColor(interaction.fields.getTextInputValue('color'));
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    if (!cfg.ticket_reasons) cfg.ticket_reasons = {};
    if (!cfg.ticket_reasons[chKey]) cfg.ticket_reasons[chKey] = [];
    const reasons = cfg.ticket_reasons[chKey];
    if (reasons.some(r => r.value === value)) {
      return interaction.reply({
        content: `❌ \`${value}\` existe déjà dans ce salon.`,
        flags: MessageFlags.Ephemeral
      });
    }
    reasons.push({
      label,
      value,
      emoji,
      color,
      description
    });
    if (!cfg.ticket_counts) cfg.ticket_counts = {};
    cfg.ticket_counts[`${chKey}_${value}`] = cfg.ticket_counts[`${chKey}_${value}`] || 0;
    if (cfg.ticket_open_count === undefined) cfg.ticket_open_count = 0;
    persist('config');
    const embed = new EmbedBuilder().setTitle('📋 Formulaire de ticket').setDescription(`Raison **${label}** créée dans ce salon !\n\nSouhaites-tu ajouter un formulaire (questions) à cette raison ?`).setColor(0xFFFFFF);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_ask_form_yes_${interaction.channel.id}_${value}`).setLabel('✅ Oui, ajouter un formulaire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('ticket_ask_form_no').setLabel('❌ Non, passer').setStyle(ButtonStyle.Secondary));
    return interaction.reply(toCV2Payload({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    }));
  }
  if (id === 'ticket_remove_reason_modal') {
    const value = interaction.fields.getTextInputValue('value').trim().toLowerCase().replace(/\s+/g, '_');
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    const idx = reasons.findIndex(r => r.value === value);
    if (idx === -1) {
      return interaction.reply({
        content: `❌ Aucune raison avec l'ID \`${value}\` dans ce salon.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const removed = reasons.splice(idx, 1)[0];
    persist('config');
    const gid = String(interaction.guild.id);
    const formKey = `${chKey}_${value}`;
    if (store.ticketForms?.[gid]?.[formKey]) {
      delete store.ticketForms[gid][formKey];
      persist('ticketForms');
    }
    return interaction.reply({
      content: `🗑️ Raison **${removed.label}** (\`${value}\`) retirée de ce salon.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (id.startsWith('ticket_edit_reason_modal_')) {
    const value = id.replace('ticket_edit_reason_modal_', '');
    const cfg = getGuildConfig(interaction.guild.id);
    const chKey = String(interaction.channel.id);
    const reasons = cfg.ticket_reasons?.[chKey] || [];
    const reason = reasons.find(r => r.value === value);
    if (!reason) {
      return interaction.reply({
        content: '❌ Cette raison a peut-être été supprimée entre-temps.',
        flags: MessageFlags.Ephemeral
      });
    }
    const label = interaction.fields.getTextInputValue('label').trim();
    const emojiRaw = interaction.fields.getTextInputValue('emoji')?.trim() || '';
    const emoji = sanitizeEmoji(emojiRaw);
    if (emojiRaw && !emoji) {
      return interaction.reply({
        content: '❌ Emoji invalide. Mets un seul emoji (ex. : 🎫) ou un emoji du serveur, ou laisse vide.',
        flags: MessageFlags.Ephemeral
      });
    }
    const color = normalizeReasonColor(interaction.fields.getTextInputValue('color'));
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    reason.label = label;
    reason.emoji = emoji;
    reason.color = color;
    reason.description = description;
    persist('config');
    return interaction.reply({
      content: `✅ Raison modifiée : **${label}** (\`${value}\`)\n\nRepublie le panneau (\`🎫 Publier le panneau\`) pour appliquer les changements.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Soumission du formulaire (ticket) ───────────────
  if (id.startsWith('ticket_form_submit_')) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    // Trouve l'état en attente le plus récent pour cet utilisateur
    let foundKey = null;
    let state = null;
    for (const [k, v] of pendingForms.entries()) {
      if (k.startsWith(`${interaction.user.id}_`)) {
        foundKey = k;
        state = v;
      }
    }
    if (!state) {
      return interaction.followUp({
        content: '❌ Session de formulaire expirée, réessaie.',
        flags: MessageFlags.Ephemeral
      });
    }
    const pageFields = state.allFields.slice((state.page - 1) * 5, state.page * 5);
    pageFields.forEach((field, i) => {
      const val = interaction.fields.getTextInputValue(`field_${i}`);
      state.answers[field.label || `Question ${i + 1}`] = val?.trim() || '*(vide)*';
    });
    const remaining = state.allFields.slice(state.page * 5);
    if (remaining.length) {
      state.page += 1;
      pendingForms.set(foundKey, state);
      const embed = new EmbedBuilder().setTitle(`🎫 ${state.reasonLabel} — Suite`).setDescription('Encore quelques questions :').setColor(0xFFFFFF);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_form_continue_${foundKey}`).setLabel('➡️ Continuer le formulaire').setStyle(ButtonStyle.Primary));
      return interaction.followUp(toCV2Payload({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
      }));
    } else {
      const cfg = getGuildConfig(interaction.guild.id);
      pendingForms.delete(foundKey);

      // ── Formulaire standalone (/form) : pas de ticket, on poste juste le récap ──
      if (state.standalone) {
        const recap = new EmbedBuilder().setTitle(`📋 Réponses — ${state.reasonLabel}`).setColor(0xFFFFFF).setFooter({
          text: `Envoyé par ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL()
        }).setTimestamp();
        for (const [q, a] of Object.entries(state.answers)) {
          recap.addFields({
            name: `❓ ${q}`,
            value: (a || '*(vide)*').slice(0, 1024),
            inline: false
          });
        }
        try {
          const target = await interaction.guild.channels.fetch(state.targetChannelId);
          if (target?.isTextBased?.()) await target.send(toCV2Payload({
            content: `${interaction.user}`,
            embeds: [recap]
          }));
        } catch (e) {
          console.error('[Formulaire] Erreur envoi des réponses :', e.message);
        }
        return interaction.followUp({
          content: '✅ Formulaire envoyé, merci !',
          flags: MessageFlags.Ephemeral
        });
      }
      return createTicketChannel(interaction, state.reasonLabel, state.reasonValue, state.answers, cfg, interaction.guild, interaction.user, state.panelChannelId);
    }
  }
}
async function handleTicketContinueButton(interaction) {
  const key = interaction.customId.replace('ticket_form_continue_', '');
  const state = pendingForms.get(key);
  if (!state) {
    return interaction.reply({
      content: '❌ Session expirée, recommence depuis le panneau.',
      flags: MessageFlags.Ephemeral
    });
  }
  const pageFields = state.allFields.slice((state.page - 1) * 5, state.page * 5);
  return interaction.showModal(buildFormModal(state.reasonLabel, pageFields, state.page));
}
async function handleTicketAskForm(interaction) {
  const id = interaction.customId;
  if (id === 'ticket_ask_form_no') {
    // Le message d'origine est en Components V2 (toCV2Payload) : `content` et
    // `embeds` y sont interdits, on repasse donc par toCV2Payload.
    const doneEmbed = new EmbedBuilder().setTitle('📋 Formulaire de ticket').setDescription('✅ Raison créée sans formulaire.').setColor(0xFFFFFF);
    return interaction.update(toCV2Payload({
      embeds: [doneEmbed],
      components: []
    }));
  }
  if (id.startsWith('ticket_ask_form_yes_')) {
    const rest = id.replace('ticket_ask_form_yes_', '');
    const [channelId, ...valueParts] = rest.split('_');
    const value = valueParts.join('_');
    const gid = String(interaction.guild.id);
    if (!store.ticketForms[gid]) store.ticketForms[gid] = {};
    const formKey = `${channelId}_${value}`;
    if (!store.ticketForms[gid][formKey]) store.ticketForms[gid][formKey] = [];
    persist('ticketForms');
    const embed = new EmbedBuilder().setTitle('📋 Gestion du formulaire').setDescription(`Formulaire pour cette raison\n\n**Questions actuelles :** ${store.ticketForms[gid][formKey].length}/50\n\nUtilise les boutons pour gérer les questions.`).setColor(0xFFFFFF);
    return interaction.update(toCV2Payload({
      embeds: [embed],
      components: buildFormManagerRows(formKey)
    }));
  }
}
async function handleFormManagerButtons(interaction) {
  const id = interaction.customId;
  if (id.startsWith('ticket_form_add_field_')) {
    const formKey = id.replace('ticket_form_add_field_', '');
    const modal = new ModalBuilder().setCustomId(`ticket_form_add_field_modal_${formKey}`).setTitle('Ajouter une question au formulaire');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Question / Label du champ').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('Texte d\'aide (placeholder)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('required').setLabel('Obligatoire ? (oui/non)').setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(true).setValue('oui')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Style : court ou long ?').setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true).setValue('court')));
    return interaction.showModal(modal);
  }
  if (id.startsWith('ticket_form_edit_field_')) {
    const formKey = id.replace('ticket_form_edit_field_', '');
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (!fields.length) {
      return interaction.reply({
        content: '❌ Aucune question à modifier.',
        flags: MessageFlags.Ephemeral
      });
    }
    const menu = new StringSelectMenuBuilder().setCustomId(`ticket_form_edit_select_${formKey}`).setPlaceholder('Choisis la question à modifier').addOptions(fields.slice(0, 25).map((f, i) => ({
      label: `${i + 1}. ${f.label}`.slice(0, 100),
      value: String(i)
    })));
    const row = new ActionRowBuilder().addComponents(menu);
    return interaction.reply({
      content: '✏️ Choisis la question à modifier :',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }
  if (id.startsWith('ticket_form_remove_field_')) {
    const formKey = id.replace('ticket_form_remove_field_', '');
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (!fields.length) {
      return interaction.reply({
        content: '❌ Aucune question à retirer.',
        flags: MessageFlags.Ephemeral
      });
    }
    const modal = new ModalBuilder().setCustomId(`ticket_form_remove_field_modal_${formKey}`).setTitle('Retirer une question');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('numero').setLabel('Numéro de la question à retirer').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true)));
    return interaction.showModal(modal);
  }
  if (id.startsWith('ticket_form_list_fields_')) {
    const formKey = id.replace('ticket_form_list_fields_', '');
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (!fields.length) {
      return interaction.reply({
        content: 'Aucune question configurée.',
        flags: MessageFlags.Ephemeral
      });
    }
    const lines = fields.map((f, i) => `\`${i + 1}.\` **${f.label}** — ${f.required ? 'Obligatoire' : 'Optionnelle'} • ${f.style === 'paragraph' ? 'Long' : 'Court'}`);
    const embed = new EmbedBuilder().setTitle('📋 Questions du formulaire').setDescription(lines.join('\n')).setFooter({
      text: `${fields.length}/50 questions`
    }).setColor(0xFFFFFF);
    return interaction.reply(toCV2Payload({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    }));
  }
  if (id.startsWith('ticket_form_validate_')) {
    const formKey = id.replace('ticket_form_validate_', '');
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (!fields.length) {
      return interaction.reply({
        content: '❌ Ajoute au moins une question avant de valider.',
        flags: MessageFlags.Ephemeral
      });
    }
    const embed = new EmbedBuilder().setTitle('✅ Formulaire enregistré !').setDescription(`Le formulaire est prêt avec **${fields.length} question(s)**.\n\nLes utilisateurs verront ce formulaire lorsqu'ils ouvriront un ticket avec cette raison.`).setColor(0xFFFFFF);
    return interaction.update(toCV2Payload({
      embeds: [embed],
      components: []
    }));
  }
}
async function handleFormFieldModals(interaction) {
  const id = interaction.customId;
  if (id.startsWith('ticket_form_add_field_modal_')) {
    const formKey = id.replace('ticket_form_add_field_modal_', '');
    const gid = String(interaction.guild.id);
    if (!store.ticketForms[gid]) store.ticketForms[gid] = {};
    if (!store.ticketForms[gid][formKey]) store.ticketForms[gid][formKey] = [];
    const fields = store.ticketForms[gid][formKey];
    if (fields.length >= 50) {
      return interaction.reply({
        content: '❌ Maximum de 50 questions atteint.',
        flags: MessageFlags.Ephemeral
      });
    }
    const label = interaction.fields.getTextInputValue('label').trim();
    const placeholder = interaction.fields.getTextInputValue('placeholder')?.trim() || '';
    const requiredRaw = interaction.fields.getTextInputValue('required').trim().toLowerCase();
    const styleRaw = interaction.fields.getTextInputValue('style').trim().toLowerCase();
    const required = ['oui', 'yes', 'o', 'y', 'true', '1'].includes(requiredRaw);
    const style = ['long', 'paragraph', 'p'].includes(styleRaw) ? 'paragraph' : 'short';
    fields.push({
      label,
      placeholder,
      required,
      style
    });
    persist('ticketForms');
    const embed = new EmbedBuilder().setTitle('📋 Gestion du formulaire').setDescription(`✅ Question **"${label}"** ajoutée !\n**Questions actuelles :** ${fields.length}/50`).setColor(0xFFFFFF);
    return interaction.update(toCV2Payload({
      embeds: [embed],
      components: buildFormManagerRows(formKey)
    }));
  }
  if (id.startsWith('ticket_form_remove_field_modal_')) {
    const formKey = id.replace('ticket_form_remove_field_modal_', '');
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    const numero = parseInt(interaction.fields.getTextInputValue('numero').trim(), 10);
    const idx = numero - 1;
    if (isNaN(idx) || idx < 0 || idx >= fields.length) {
      return interaction.reply({
        content: '❌ Numéro invalide.',
        flags: MessageFlags.Ephemeral
      });
    }
    const removed = fields.splice(idx, 1)[0];
    persist('ticketForms');
    const embed = new EmbedBuilder().setTitle('📋 Gestion du formulaire').setDescription(`🗑️ Question **"${removed.label}"** retirée !\n**Questions restantes :** ${fields.length}/50`).setColor(0xFFFFFF);
    return interaction.update(toCV2Payload({
      embeds: [embed],
      components: buildFormManagerRows(formKey)
    }));
  }
  if (id.startsWith('ticket_form_edit_field_modal_')) {
    const rest = id.replace('ticket_form_edit_field_modal_', '');
    const lastUnderscore = rest.lastIndexOf('_');
    const formKey = rest.slice(0, lastUnderscore);
    const idx = parseInt(rest.slice(lastUnderscore + 1), 10);
    const gid = String(interaction.guild.id);
    const fields = store.ticketForms?.[gid]?.[formKey] || [];
    if (!fields[idx]) {
      return interaction.reply({
        content: '❌ Cette question a peut-être été supprimée entre-temps.',
        flags: MessageFlags.Ephemeral
      });
    }
    const label = interaction.fields.getTextInputValue('label').trim();
    const placeholder = interaction.fields.getTextInputValue('placeholder')?.trim() || '';
    const requiredRaw = interaction.fields.getTextInputValue('required').trim().toLowerCase();
    const styleRaw = interaction.fields.getTextInputValue('style').trim().toLowerCase();
    const required = ['oui', 'yes', 'o', 'y', 'true', '1'].includes(requiredRaw);
    const style = ['long', 'paragraph', 'p'].includes(styleRaw) ? 'paragraph' : 'short';
    fields[idx] = {
      label,
      placeholder,
      required,
      style
    };
    persist('ticketForms');
    return interaction.reply({
      content: `✅ Question modifiée : **${label}**`,
      flags: MessageFlags.Ephemeral
    });
  }
}

// ── Choix de la question à modifier (menu déroulant) ────
async function handleFormEditSelect(interaction) {
  const formKey = interaction.customId.replace('ticket_form_edit_select_', '');
  const gid = String(interaction.guild.id);
  const fields = store.ticketForms?.[gid]?.[formKey] || [];
  const idx = parseInt(interaction.values[0], 10);
  const field = fields[idx];
  if (!field) {
    return interaction.reply({
      content: '❌ Question introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  const modal = new ModalBuilder().setCustomId(`ticket_form_edit_field_modal_${formKey}_${idx}`).setTitle('Modifier la question');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Question / Label du champ').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(field.label || '')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('Texte d\'aide (placeholder)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(field.placeholder || '')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('required').setLabel('Obligatoire ? (oui/non)').setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(true).setValue(field.required ? 'oui' : 'non')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Style : court ou long ?').setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true).setValue(field.style === 'paragraph' ? 'long' : 'court')));
  return interaction.showModal(modal);
}

// ── Choix de la raison à modifier (menu déroulant) ────
async function handleTicketReasonEditSelect(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const chKey = String(interaction.channel.id);
  const reasons = cfg.ticket_reasons?.[chKey] || [];
  const value = interaction.values[0];
  const reason = reasons.find(r => r.value === value);
  if (!reason) {
    return interaction.reply({
      content: '❌ Raison introuvable (elle a peut-être été supprimée entre-temps).',
      flags: MessageFlags.Ephemeral
    });
  }
  const modal = new ModalBuilder().setCustomId(`ticket_edit_reason_modal_${value}`).setTitle('Modifier la raison');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Nom (label)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(reason.label || '')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false).setValue(reason.emoji || '')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Couleur (rouge/vert/bleu/gris/auto/#hex)').setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(false).setValue(reason.color || 'blurple')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Courte description (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(reason.description || '')));
  return interaction.showModal(modal);
}

// ── Titre/Description du formulaire (+ couleur en bonus) ──
async function handleFormStyleButton(interaction) {
  const formKey = interaction.customId.replace('ticket_form_style_', '');
  const slug = formKey.replace(/^standalone_/, '');
  const gid = String(interaction.guild.id);
  const meta = normFormMeta(store.formulaires?.[gid]?.[slug]);
  if (!meta) {
    return interaction.reply({
      content: '❌ Formulaire introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  const modal = new ModalBuilder().setCustomId(`ticket_form_style_modal_${formKey}`).setTitle('📝 Titre / Description du formulaire');
  const titreInput = new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(meta.title || `📋 ${meta.nom}`);
  const titreLabel = new LabelBuilder().setLabel('Titre affiché').setTextInputComponent(titreInput);
  const descriptionInput = new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false).setValue(meta.description || '');
  const descriptionLabel = new LabelBuilder().setLabel('Description').setTextInputComponent(descriptionInput);
  const {
    couleurLabel,
    couleurHexLabel
  } = buildCouleurLabelComponents(meta.color);
  modal.addLabelComponents(titreLabel, descriptionLabel, couleurLabel, couleurHexLabel);
  return interaction.showModal(modal);
}

// ── Image du formulaire (formulaires autonomes /form) ──
async function handleFormImageButton(interaction) {
  const formKey = interaction.customId.replace('ticket_form_image_', '');
  const slug = formKey.replace(/^standalone_/, '');
  const gid = String(interaction.guild.id);
  if (!store.formulaires?.[gid]?.[slug]) {
    return interaction.reply({
      content: '❌ Formulaire introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  try {
    await interaction.reply({
      content: '🖼️ Envoie l\'image à utiliser (en pièce jointe) dans ce salon, tu as 2 minutes. Envoie `annuler` pour arrêter.',
      flags: MessageFlags.Ephemeral
    });
  } catch (e) {
    console.error('Erreur reply ticket_form_image :', e.message);
    return;
  }
  const collector = interaction.channel.createMessageCollector({
    filter: m => m.author.id === interaction.user.id,
    time: 120000,
    max: 1
  });
  collector.on('collect', async msg => {
    try {
      const attachment = msg.attachments.find(a => a.contentType?.startsWith('image/'));
      if (msg.content?.trim().toLowerCase() === 'annuler') {
        await msg.delete().catch(() => { });
        await interaction.followUp({
          content: '❌ Annulé.',
          flags: MessageFlags.Ephemeral
        }).catch(() => { });
        return;
      }
      if (!attachment) {
        await msg.delete().catch(() => { });
        await interaction.followUp({
          content: '❌ Aucune image valide trouvée dans ce message.',
          flags: MessageFlags.Ephemeral
        }).catch(() => { });
        return;
      }
      let nomFichier;
      try {
        nomFichier = await sauvegarderImageFormulaireLocalement(interaction.guild.id, slug, attachment);
      } catch (e) {
        console.error('Erreur téléchargement image formulaire :', e.message);
        await msg.delete().catch(() => { });
        await interaction.followUp({
          content: `❌ ${e.message || 'Échec du téléchargement de l\'image, réessaie.'}`,
          flags: MessageFlags.Ephemeral
        }).catch(() => { });
        return;
      }
      const meta = normFormMeta(store.formulaires[gid][slug]);
      store.formulaires[gid][slug] = {
        ...meta,
        image: nomFichier
      };
      persist('formulaires');
      await msg.delete().catch(() => { });
      await interaction.followUp({
        content: '✅ Image enregistrée ! Republie le formulaire (`📨 Publier le formulaire`) pour l\'appliquer.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    } catch (e) {
      console.error('Erreur collecte image formulaire :', e.message);
    }
  });
  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.followUp({
        content: '⏱️ Temps écoulé, aucune image reçue.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
  });
}

// ── Publier le formulaire (poste l'embed + bouton "Remplir") ──
async function handleFormPublishButton(interaction) {
  const formKey = interaction.customId.replace('ticket_form_publish_', '');
  const slug = formKey.replace(/^standalone_/, '');
  const gid = String(interaction.guild.id);
  const meta = normFormMeta(store.formulaires?.[gid]?.[slug]);
  const fields = store.ticketForms?.[gid]?.[formKey] || [];
  if (!meta) return interaction.reply({
    content: '❌ Formulaire introuvable.',
    flags: MessageFlags.Ephemeral
  });
  if (!fields.length) return interaction.reply({
    content: '❌ Ajoute au moins une question avant de publier.',
    flags: MessageFlags.Ephemeral
  });
  const embed = new EmbedBuilder().setTitle(meta.title || `📋 ${meta.nom}`).setDescription(`${meta.description || 'Clique sur le bouton ci-dessous pour remplir ce formulaire.'}\n\n` + `**Questions :** ${fields.length}`).setColor(meta.color ?? 0xFFFFFF);
  const files = [];
  if (meta.image) {
    const cheminImage = path.join(DOSSIER_IMAGES_FORMULAIRE, meta.image);
    if (fs.existsSync(cheminImage)) {
      files.push(new AttachmentBuilder(cheminImage, {
        name: meta.image
      }));
      embed.setImage(`attachment://${meta.image}`);
    }
  }
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_form_fill_${formKey}`).setLabel('📝 Remplir le formulaire').setStyle(ButtonStyle.Primary));
  try {
    await interaction.channel.send(toCV2Payload({
      embeds: [embed],
      components: [row],
      files
    }));
  } catch (e) {
    console.error('Erreur publication formulaire :', e.message);
    const tropLourd = e.code === 40005 || /entity too large/i.test(e.message || '');
    return interaction.reply({
      content: tropLourd ? '❌ L\'image du formulaire est trop lourde pour ce serveur. Redéfinis-la avec une image/GIF plus léger via 🖼️ Image du formulaire.' : '❌ Impossible de publier le formulaire (erreur Discord).',
      flags: MessageFlags.Ephemeral
    });
  }
  return interaction.reply({
    content: '✅ Formulaire publié dans ce salon !',
    flags: MessageFlags.Ephemeral
  });
}

// ── Bouton public "Remplir le formulaire" ────────────────
async function handleFormFillButton(interaction) {
  const formKey = interaction.customId.replace('ticket_form_fill_', '');
  const slug = formKey.replace(/^standalone_/, '');
  const gid = String(interaction.guild.id);
  const meta = normFormMeta(store.formulaires?.[gid]?.[slug]);
  const fields = store.ticketForms?.[gid]?.[formKey] || [];
  if (!meta || !fields.length) {
    return interaction.reply({
      content: '❌ Ce formulaire n\'est plus disponible.',
      flags: MessageFlags.Ephemeral
    });
  }
  const key = pendingKey(interaction.user.id, 'standalone', slug);
  pendingForms.set(key, {
    reasonLabel: meta.nom,
    reasonValue: slug,
    panelChannelId: 'standalone',
    allFields: fields,
    answers: {},
    page: 1,
    standalone: true,
    targetChannelId: interaction.channel.id
  });
  return interaction.showModal(buildFormModal(meta.nom, fields, 1));
}
async function routeTicketInteraction(interaction) {
  try {
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('ticket_form_continue_')) return handleTicketContinueButton(interaction);
      if (id.startsWith('ticket_ask_form_')) return handleTicketAskForm(interaction);
      if (id.startsWith('ticket_form_fill_')) return handleFormFillButton(interaction);
      if (id.startsWith('ticket_form_publish_')) return handleFormPublishButton(interaction);
      if (id.startsWith('ticket_form_image_')) return handleFormImageButton(interaction);
      if (id.startsWith('ticket_form_style_')) return handleFormStyleButton(interaction);
      if (id.startsWith('ticket_form_add_field_') || id.startsWith('ticket_form_remove_field_') || id.startsWith('ticket_form_edit_field_') || id.startsWith('ticket_form_list_fields_') || id.startsWith('ticket_form_validate_')) {
        return handleFormManagerButtons(interaction);
      }
      if (id.startsWith('ticket_') || id.startsWith('ticket_reason_')) return handleTicketComponent(interaction);
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'ticket_set_category') {
      return handleTicketComponent(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_form_edit_select_')) {
      return handleFormEditSelect(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_edit_reason_select') {
      return handleTicketReasonEditSelect(interaction);
    }
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id === 'ticket_add_reason_modal' || id === 'ticket_remove_reason_modal' || id === 'ticket_appearance_modal' || id === 'ticket_open_msg_modal') return handleTicketModal(interaction);
      if (id.startsWith('ticket_edit_reason_modal_')) return handleTicketModal(interaction);
      if (id.startsWith('ticket_form_style_modal_')) return handleTicketModal(interaction);
      if (id.startsWith('ticket_form_submit_')) return handleTicketModal(interaction);
      if (id.startsWith('ticket_form_add_field_modal_') || id.startsWith('ticket_form_remove_field_modal_') || id.startsWith('ticket_form_edit_field_modal_')) {
        return handleFormFieldModals(interaction);
      }
    }
  } catch (e) {
    console.error('Erreur d\'interaction ticket :', e);
    const payload = {
      content: '❌ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
    } catch { }
  }
}
async function routeReglementInteraction(interaction) {
  try {
    if (interaction.isRoleSelectMenu() && interaction.customId === 'reglement_role_select') {
      return handleReglementRoleSelect(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reglement_rules_modal_')) {
      return handleReglementModalSubmit(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'reglement_edit_modal') {
      return handleReglementEditSubmit(interaction);
    }
    if (interaction.isButton() && interaction.customId === 'accept_rules_global') {
      return handleRulesButtonClick(interaction);
    }
  } catch (e) {
    console.error('Erreur d\'interaction règlement :', e);
    const payload = {
      content: '❌ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
    } catch { }
  }
}

// ────────────────────────────────────────────────
// Partenariats — routage (modale, menus salon/rôles,
// boutons admin et bouton "Rejoindre" des membres)
// ────────────────────────────────────────────────
async function routePartnershipInteraction(interaction) {
  try {
    if (interaction.customId?.startsWith('partner_')) {
      return await handlePartnershipInteraction(interaction);
    }
  } catch (e) {
    console.error('Erreur d\'interaction partenariat :', e);
    const payload = {
      content: '❌ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
    } catch { }
  }
}
async function checkSlashPermissions(interaction) {
  const cmd = interaction.client.commands.get(interaction.commandName);
  if (!cmd) return true;

  // Dashboard : compte chaque commande slash reconnue, avant le check de permissions.
  track(interaction.commandName);
  if (cmd.ownerOnly && !OWNER_IDS.includes(interaction.user.id)) {
    await interaction.reply({
      content: '❌ Cette commande est réservée au propriétaire du bot.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }
  if (cmd.adminOnly && !interaction.member?.permissions.has('Administrator')) {
    await interaction.reply({
      content: '❌ Cette commande est réservée aux administrateurs.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }
  return true;
}
module.exports = {
  routeTicketInteraction,
  routeReglementInteraction,
  routePartnershipInteraction,
  checkSlashPermissions
};