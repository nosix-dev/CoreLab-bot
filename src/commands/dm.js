// !dm — envoi de messages privés en texte brut (pas d'embed).
//
//  • Sur un serveur : `!dm` ouvre un panneau avec un bouton → modal où tu choisis
//    les membres et/ou rôles (ou tout le serveur) + le message à envoyer.
//    Une confirmation (nombre de destinataires) est demandée avant l'envoi.
//  • En MP avec le bot : `!dm <id> <message>` (ancien fonctionnement, conservé).
//
// Réservé au propriétaire du bot (client.BOT_OWNER_ID).

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MentionableSelectMenuBuilder,
} = require('discord.js');

const EXPIRATION_MS = 10 * 60 * 1000;   // validité du panneau / de la confirmation
const DELAI_ENTRE_DM_MS = 1200;          // anti rate-limit / anti-spam Discord
const MAX_MSG = 2000;

// Brouillons en attente de confirmation : ownerId -> { guildId, ids, texte, timeout }
const pending = new Map();

function clearPending(ownerId) {
  const p = pending.get(ownerId);
  if (p?.timeout) clearTimeout(p.timeout);
  pending.delete(ownerId);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Panneau (message avec bouton) ──────────────────────────────────────────
function buildPanel() {
  return {
    content: '✉️ **Envoi de DM** — clique sur le bouton pour choisir les destinataires (membres / rôles / tout le serveur) et écrire ton message.\n*Le message sera envoyé en texte simple, sans embed.*',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dm_open').setLabel('Rédiger le DM').setEmoji('✉️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dm_close').setLabel('Fermer').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ── Modal ──────────────────────────────────────────────────────────────────
function buildModal() {
  const modal = new ModalBuilder().setCustomId('dm_modal').setTitle('Envoyer un DM');

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId('mode')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Uniquement la sélection ci-dessous').setValue('selection').setEmoji('🎯').setDefault(true),
      new StringSelectMenuOptionBuilder().setLabel('Tout le serveur (@everyone)').setValue('everyone').setEmoji('🌐'),
    );
  const modeLabel = new LabelBuilder()
    .setLabel('Destinataires')
    .setDescription('« Tout le serveur » ignore la sélection ci-dessous')
    .setStringSelectMenuComponent(modeSelect);

  const cibles = new MentionableSelectMenuBuilder()
    .setCustomId('cibles')
    .setPlaceholder('Choisir des membres et/ou des rôles')
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(25);
  const ciblesLabel = new LabelBuilder()
    .setLabel('Membres / rôles')
    .setMentionableSelectMenuComponent(cibles);

  const texte = new TextInputBuilder()
    .setCustomId('texte')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_MSG)
    .setPlaceholder('Ton message (texte simple)');
  const texteLabel = new LabelBuilder().setLabel('Message').setTextInputComponent(texte);

  modal.addLabelComponents(modeLabel, ciblesLabel, texteLabel);
  return modal;
}

// ── Résolution des destinataires ───────────────────────────────────────────
async function resoudreDestinataires(guild, mode, membres, roles) {
  // Charge tous les membres (intent GuildMembers déjà activé sur le bot).
  const tous = await guild.members.fetch().catch(() => guild.members.cache);
  const ids = new Set();

  if (mode === 'everyone') {
    for (const m of tous.values()) if (!m.user.bot) ids.add(m.id);
    return [...ids];
  }

  for (const m of membres) if (!(m.user ?? m).bot) ids.add(m.id);
  for (const r of roles) {
    for (const m of tous.values()) {
      if (m.user.bot) continue;
      // Le rôle @everyone (id = id du serveur) concerne tout le monde.
      if (r.id === guild.id || m.roles.cache.has(r.id)) ids.add(m.id);
    }
  }
  return [...ids];
}

// ── Envoi en masse ─────────────────────────────────────────────────────────
async function envoyerATous(client, ids, texte, onProgress) {
  let ok = 0;
  let ko = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const user = await client.users.fetch(ids[i]);
      // Texte simple, aucune mention résolue.
      await user.send({ content: texte, allowedMentions: { parse: [] } });
      ok++;
    } catch (e) {
      ko++; // DM fermés, bot bloqué, etc.
    }
    if (onProgress && ((i + 1) % 10 === 0)) await onProgress(i + 1, ids.length, ok, ko);
    if (i < ids.length - 1) await sleep(DELAI_ENTRE_DM_MS);
  }
  return { ok, ko };
}

// ── Commande préfixe ───────────────────────────────────────────────────────
async function dm(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) {
    // Sur un serveur on reste silencieux, en MP on prévient (comportement d'origine).
    if (!message.guild) return message.channel.send('❌ Vous n\'êtes pas autorisé.');
    return;
  }

  // Sur un serveur → panneau + modal
  if (message.guild) {
    return message.channel.send(buildPanel());
  }

  // En MP → ancien mode : !dm <id> <message>
  const args = message.content.trim().split(/\s+/).slice(1);
  const userId = args.shift();
  const texte = args.join(' ').trim();

  if (!userId || !/^\d{15,25}$/.test(userId)) {
    return message.channel.send('❌ Utilisez `!dm <id> <message>` ici, ou `!dm` sur un serveur pour choisir des rôles / membres.');
  }
  if (!texte) {
    return message.channel.send('❌ Merci de fournir un message à envoyer. Utilisez `!dm <id> <message>`.');
  }

  let user;
  try {
    user = await client.users.fetch(userId);
  } catch (e) {
    return message.channel.send('❌ Utilisateur introuvable pour cet ID.');
  }

  try {
    await user.send({ content: texte, allowedMentions: { parse: [] } });
    message.channel.send(`✅ Message envoyé à **${user.tag}** (${user.id}).`);
  } catch (e) {
    console.error('[!dm] Impossible d\'envoyer le DM :', e.message);
    message.channel.send(`❌ Impossible d'envoyer un message à **${user.tag}** (DM fermés ou bot bloqué).`);
  }
}

// ── Interactions (customId commençant par dm_) ─────────────────────────────
async function routeDmInteraction(interaction) {
  const client = interaction.client;
  const refuse = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });

  if (interaction.user.id !== client.BOT_OWNER_ID) {
    return refuse('❌ Action réservée au propriétaire du bot.');
  }

  const id = interaction.customId;

  // Bouton « Rédiger le DM » → ouvre le modal
  if (interaction.isButton() && id === 'dm_open') {
    if (!interaction.guild) return refuse('❌ À utiliser sur un serveur.');
    return interaction.showModal(buildModal()).catch(e => console.error('[!dm] showModal :', e.message));
  }

  // Bouton « Fermer »
  if (interaction.isButton() && id === 'dm_close') {
    clearPending(interaction.user.id);
    return interaction.update({ content: '❌ Fermé.', components: [] }).catch(() => { });
  }

  // Soumission du modal → prévisualisation + confirmation
  if (interaction.isModalSubmit() && id === 'dm_modal') {
    if (!interaction.guild) return refuse('❌ À utiliser sur un serveur.');

    const texte = interaction.fields.getTextInputValue('texte').trim();
    if (!texte) return refuse('❌ Le message est vide.');

    let mode = 'selection';
    try { mode = interaction.fields.getStringSelectValues('mode')[0] || 'selection'; } catch (_) { }

    let membres = [];
    let roles = [];
    try {
      const sel = interaction.fields.getSelectedMentionables('cibles', false);
      if (sel) {
        // members = membres présents sur le serveur ; users en repli
        membres = sel.members?.size ? [...sel.members.values()] : [...(sel.users?.values() ?? [])];
        roles = [...(sel.roles?.values() ?? [])];
      }
    } catch (_) { /* rien sélectionné */ }

    if (mode !== 'everyone' && !membres.length && !roles.length) {
      return refuse('❌ Choisis au moins un membre ou un rôle, ou sélectionne « Tout le serveur ».');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ids = await resoudreDestinataires(interaction.guild, mode, membres, roles);
    if (!ids.length) {
      return interaction.editReply({ content: '❌ Aucun destinataire trouvé (les bots sont ignorés).' });
    }

    clearPending(interaction.user.id);
    const timeout = setTimeout(() => pending.delete(interaction.user.id), EXPIRATION_MS);
    pending.set(interaction.user.id, { guildId: interaction.guild.id, ids, texte, timeout });

    const cibleTxt = mode === 'everyone'
      ? `🌐 **Tout le serveur**`
      : [
        membres.length ? `👤 ${membres.length} membre(s)` : null,
        roles.length ? `🏷️ ${roles.length} rôle(s)` : null,
      ].filter(Boolean).join(' + ');
    const dureeEst = Math.ceil((ids.length * DELAI_ENTRE_DM_MS) / 1000);
    const apercu = texte.length > 900 ? texte.slice(0, 900) + '…' : texte;

    return interaction.editReply({
      content: `**Confirmer l'envoi ?**\nCibles : ${cibleTxt}\nDestinataires uniques : **${ids.length}** (durée estimée ~${dureeEst}s)\n\n**Aperçu :**\n>>> ${apercu}`,
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dm_confirm').setLabel(`Envoyer à ${ids.length} personne(s)`).setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('dm_cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
        ),
      ],
    });
  }

  // Annulation
  if (interaction.isButton() && id === 'dm_cancel') {
    clearPending(interaction.user.id);
    return interaction.update({ content: '❌ Envoi annulé.', components: [] }).catch(() => { });
  }

  // Confirmation → envoi
  if (interaction.isButton() && id === 'dm_confirm') {
    const p = pending.get(interaction.user.id);
    if (!p) {
      return interaction.update({ content: '❌ Cette demande a expiré. Relance `!dm`.', components: [] }).catch(() => { });
    }
    clearPending(interaction.user.id);

    await interaction.update({ content: `⏳ Envoi en cours… 0/${p.ids.length}`, components: [] }).catch(() => { });

    const onProgress = (fait, total, ok, ko) =>
      interaction.editReply({ content: `⏳ Envoi en cours… ${fait}/${total} (✅ ${ok} • ❌ ${ko})` }).catch(() => { });

    const { ok, ko } = await envoyerATous(client, p.ids, p.texte, onProgress);
    return interaction.editReply({
      content: `✅ Terminé : **${ok}** DM envoyé(s)` + (ko ? `, **${ko}** échec(s) (DM fermés ou bot bloqué).` : '.'),
    }).catch(() => { });
  }
}

module.exports = { dm, routeDmInteraction };