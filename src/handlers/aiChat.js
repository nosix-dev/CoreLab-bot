const {
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const {
  getGuildConfig
} = require('../core/config');
const {
  persist
} = require('../core/data');
const {
  toCV2Payload
} = require('../core/componentsV2');
const {
  pushEvent
} = require('../core/dashboardEvents');

// ────────────────────────────────────────────────
// Config / branding
// ────────────────────────────────────────────────
const IA_CATEGORY_NAME = '🤖〢CoreLab Intélligence';
const ANCIEN_IA_CATEGORY_NAME = '🤖〢ScaraBot Intélligence';
const IA_CHANNEL_NAME = '🌐〢corelab-ia';
const IA_BRAND_COLOR = 0xFFFFFF;
// Google Gemini (gratuit, sans carte bancaire) via son endpoint compatible OpenAI
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const AI_SYSTEM_PROMPT = "Tu es l'assistant IA de CoreLab, un bot Discord communautaire. Tu réponds en français, de façon claire, utile et concise (adapte la longueur à la question). Si on te demande qui tu es, dis que tu es l'assistant IA intégré à CoreLab.";
const MAX_HISTORY_MESSAGES = 20; // nombre de messages (user+assistant) conservés en mémoire par salon

// Édition d'images (modèle Gemini "image", appelé via l'endpoint natif generateContent)
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
const IMAGE_MIME_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 Mo max pour l'image envoyée
const IMAGE_COOLDOWN_MS = 15 * 1000;      // délai mini entre 2 éditions par utilisateur (protège le quota)
const imageCooldowns = new Map();         // userId -> timestamp de la dernière édition

// customIds
const CID_OPEN = 'ia_open_btn';
const CID_CLOSE = 'ia_close_btn';

// État en mémoire : channelId -> { userId, guildId, history: [{role, content}] }
const activeSessions = new Map();

// ────────────────────────────────────────────────
// Construction du message d'accueil (Components V2)
// ────────────────────────────────────────────────
function buildIaPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🤖 CoreLab Intelligence')
    .setDescription(
      "Besoin d'aide, d'une info ou juste envie de discuter ?\n" +
      "Clique sur le bouton ci-dessous pour ouvrir un salon privé avec l'IA de CoreLab, rien que pour toi.\n\n" +
      "💬 Le salon est créé automatiquement et n'est visible que par toi.\n" +
      "🔒 Tu peux le fermer à tout moment."
    )
    .setColor(IA_BRAND_COLOR);
}
function buildIaPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID_OPEN).setLabel('Parler à l\'IA').setEmoji('💬').setStyle(ButtonStyle.Primary)
  );
}
function buildIaWelcomeEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🤖 Assistant IA — CoreLab')
    .setDescription(
      `Salut ${user} ! Écris directement ton message dans ce salon, l'IA te répondra ici.\n\n` +
      "🖼️ **Modifier une image** : envoie-moi une image avec ce que tu veux changer (ex : « mets-la en noir et blanc »), " +
      "ou réponds à une image avec ta demande pour continuer à la modifier.\n\n" +
      "Ferme le salon avec le bouton ci-dessous quand tu as terminé."
    )
    .setColor(IA_BRAND_COLOR)
    .setTimestamp();
}
function buildIaCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID_CLOSE).setLabel('Fermer le salon').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
}

// ────────────────────────────────────────────────
// Catégorie / salon principal — créés par /ai-setup
// ────────────────────────────────────────────────
async function getOrCreateIaCategory(guild, cfg, reason) {
  if (cfg.ia_category_id) {
    const existing = guild.channels.cache.get(String(cfg.ia_category_id));
    if (existing && existing.type === ChannelType.GuildCategory) return existing;
  }
  let found = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === IA_CATEGORY_NAME);
  if (!found) {
    // Serveur où l'ancienne catégorie « ScaraBot » existe encore : on la renomme en CoreLab
    found = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === ANCIEN_IA_CATEGORY_NAME);
    if (found) await found.setName(IA_CATEGORY_NAME, 'Renommage du bot : ScaraBot → CoreLab').catch(() => {});
  }
  if (found) {
    cfg.ia_category_id = found.id;
    return found;
  }
  const category = await guild.channels.create({
    name: IA_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason
  });
  cfg.ia_category_id = category.id;
  return category;
}

async function setupIaChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  if (cfg.ia_enabled && cfg.ia_channel_id && interaction.guild.channels.cache.has(String(cfg.ia_channel_id))) {
    const disableRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ia_admin_disable').setLabel('🔴 Désactiver').setStyle(ButtonStyle.Danger)
    );
    return interaction.reply({
      content: `🤖 **CoreLab Intelligence**\nDéjà actif sur <#${cfg.ia_channel_id}>.`,
      components: [disableRow],
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  try {
    const category = await getOrCreateIaCategory(guild, cfg, `Config IA par ${interaction.user.tag}`);
    const channel = await guild.channels.create({
      name: IA_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages]
        },
        {
          id: guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ],
      reason: `Config IA par ${interaction.user.tag}`
    });
    cfg.ia_channel_id = channel.id;
    cfg.ia_enabled = true;
    cfg.ia_tickets = cfg.ia_tickets || {};
    const sent = await channel.send(toCV2Payload({
      embeds: [buildIaPanelEmbed()],
      components: [buildIaPanelRow()]
    }));
    cfg.ia_message_id = sent.id;
    persist('config');
    pushEvent({
      icon: '🤖',
      tag: 'tag-sys',
      text: `Salon CoreLab Intelligence configuré par ${interaction.user.tag}`,
      server: guild.name
    });
    return interaction.editReply({
      content: `✅ Catégorie **${IA_CATEGORY_NAME}** et salon <#${channel.id}> créés avec succès.`
    });
  } catch (e) {
    console.error('Erreur création salon IA :', e.message);
    return interaction.editReply({
      content: '❌ Impossible de créer la catégorie/le salon IA (vérifie mes permissions "Gérer les salons").'
    });
  }
}

async function disableIaChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.ia_enabled = false;
  persist('config');
  return interaction.update({
    content: '🔴 CoreLab Intelligence désactivé (le salon et la catégorie ne sont pas supprimés automatiquement).',
    components: []
  });
}

// ────────────────────────────────────────────────
// Ouverture d'un salon IA privé (bouton "Parler à l'IA")
// ────────────────────────────────────────────────
async function openIaTicket(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.ia_tickets = cfg.ia_tickets || {};
  const guild = interaction.guild;
  const user = interaction.user;

  // Un salon déjà ouvert pour cet utilisateur ? On le redirige au lieu d'en recréer un.
  const existingChannelId = cfg.ia_tickets[user.id];
  if (existingChannelId && guild.channels.cache.has(String(existingChannelId))) {
    return interaction.reply({
      content: `❗ Tu as déjà un salon ouvert : <#${existingChannelId}>`,
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const category = await getOrCreateIaCategory(guild, cfg, `Salon IA ouvert par ${user.tag}`);
    const channel = await guild.channels.create({
      name: `ia-${user.username}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Salon IA de ${user.tag}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
      ],
      reason: `Salon IA ouvert par ${user.tag}`
    });

    cfg.ia_tickets[user.id] = channel.id;
    persist('config');
    activeSessions.set(channel.id, { userId: user.id, guildId: guild.id, history: [] });

    await channel.send(toCV2Payload({
      content: `${user}`,
      embeds: [buildIaWelcomeEmbed(user)],
      components: [buildIaCloseRow()]
    }));

    pushEvent({
      icon: '🤖',
      tag: 'tag-sys',
      text: `Salon IA ouvert par ${user.tag}`,
      server: guild.name
    });

    return interaction.editReply({ content: `✅ Ton salon IA est prêt → ${channel}` });
  } catch (e) {
    console.error('Erreur création salon IA (ticket) :', e.message);
    return interaction.editReply({ content: '❌ Impossible de créer ton salon IA (vérifie mes permissions "Gérer les salons").' });
  }
}

async function closeIaTicket(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.ia_tickets = cfg.ia_tickets || {};
  const channelId = interaction.channel.id;
  const ownerId = Object.keys(cfg.ia_tickets).find(uid => String(cfg.ia_tickets[uid]) === String(channelId));
  if (ownerId) delete cfg.ia_tickets[ownerId];
  persist('config');
  activeSessions.delete(channelId);

  await interaction.reply('🔒 Suppression dans 5 secondes...');
  setTimeout(async () => {
    try {
      await interaction.channel.delete('Salon IA fermé');
    } catch {}
  }, 5000);
}

// ────────────────────────────────────────────────
// Routage des interactions (boutons ia_*)
// ────────────────────────────────────────────────
async function routeIaInteraction(interaction) {
  const id = interaction.customId;
  try {
    if (id === CID_OPEN) return openIaTicket(interaction);
    if (id === CID_CLOSE) return closeIaTicket(interaction);
    if (id === 'ia_admin_disable') return disableIaChannel(interaction);
  } catch (e) {
    console.error('Erreur routage interaction IA :', e.message);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ Une erreur est survenue.' }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

// ────────────────────────────────────────────────
// Relais Gemini — messages envoyés dans un salon IA
// ────────────────────────────────────────────────
async function askAi(history) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "❌ Aucune clé GEMINI_API_KEY n'est configurée sur le bot. Ajoute-la dans le fichier .env pour activer l'IA." };
  }
  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history],
        temperature: 0.7,
        max_tokens: 8192
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Erreur API Gemini :', res.status, errText);
      return { error: `❌ Erreur de l'API Gemini (code ${res.status}).` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return { error: '❌ Réponse vide de l\'IA.' };
    return { content };
  } catch (e) {
    console.error('Erreur appel Gemini :', e.message);
    return { error: '❌ Impossible de contacter l\'IA pour le moment.' };
  }
}

// ────────────────────────────────────────────────
// Édition d'images — Gemini (modèle image, endpoint natif generateContent)
// ────────────────────────────────────────────────
function getMimeType(attachment) {
  return (attachment?.contentType || '').split(';')[0].trim().toLowerCase();
}

// Retourne la première pièce jointe image d'un message (ou null)
function findImageAttachment(msg) {
  if (!msg || !msg.attachments) return null;
  return msg.attachments.find(a => getMimeType(a).startsWith('image/')) || null;
}

// Image du message lui-même, sinon image du message auquel il répond
async function resolveImageSource(message) {
  const own = findImageAttachment(message);
  if (own) return own;
  if (message.reference && message.reference.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      return findImageAttachment(referenced);
    } catch {
      return null;
    }
  }
  return null;
}

async function downloadImage(attachment) {
  const mimeType = getMimeType(attachment);
  if (!IMAGE_MIME_OK.includes(mimeType)) {
    return { error: `❌ Format d'image non supporté (${mimeType || 'inconnu'}). Utilise du PNG, JPEG ou WebP.` };
  }
  if (attachment.size && attachment.size > MAX_IMAGE_BYTES) {
    return { error: '❌ Image trop lourde (10 Mo maximum).' };
  }
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return { error: "❌ Impossible de télécharger l'image." };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return { error: '❌ Image trop lourde (10 Mo maximum).' };
    return { buffer, mimeType };
  } catch (e) {
    console.error('Erreur téléchargement image :', e.message);
    return { error: "❌ Impossible de télécharger l'image." };
  }
}

async function editImageWithGemini({ buffer, mimeType, instruction }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "❌ Aucune clé GEMINI_API_KEY n'est configurée sur le bot. Ajoute-la dans le fichier .env pour activer l'IA." };
  }
  const prompt =
    `Modifie cette image selon la demande suivante : ${instruction}\n` +
    "Garde tout le reste de l'image identique, sauf si la demande dit le contraire.";
  try {
    const res = await fetch(GEMINI_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
          ]
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Erreur API Gemini (image) :', res.status, errText);
if (res.status === 429) {
  const noFreeQuota = /limit:\s*0/.test(errText);
  return {
    error: noFreeQuota
      ? "❌ L'édition d'image n'est pas disponible sur ce bot pour le moment."
      : "⏳ Le quota de l'IA image est atteint pour le moment. Réessaie dans un instant."
  };
}
      if (res.status === 404) {
        return { error: `❌ Le modèle image « ${GEMINI_IMAGE_MODEL} » est introuvable. Vérifie GEMINI_IMAGE_MODEL dans le .env.` };
      }
      return { error: `❌ Erreur de l'API Gemini image (code ${res.status}).` };
    }

    const data = await res.json();
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) {
      return { error: `🚫 Gemini a refusé cette demande (${blockReason}). Essaie avec une autre image ou une autre formulation.` };
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    let text = '';
    let image = null;
    for (const part of parts) {
      if (part.text) text += part.text;
      const inline = part.inlineData || part.inline_data;
      if (inline && inline.data && !image) {
        image = {
          buffer: Buffer.from(inline.data, 'base64'),
          mimeType: inline.mimeType || inline.mime_type || 'image/png'
        };
      }
    }

    if (!image) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (text.trim()) return { error: `🖼️ Gemini n'a pas renvoyé d'image : ${text.trim().slice(0, 500)}` };
      return { error: `❌ Gemini n'a pas renvoyé d'image${finishReason ? ` (${finishReason})` : ''}. Essaie de reformuler ta demande.` };
    }
    return { image, text: text.trim() };
  } catch (e) {
    console.error('Erreur appel Gemini (image) :', e.message);
    return { error: "❌ Impossible de contacter l'IA image pour le moment." };
  }
}

function pushHistory(session, role, content) {
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY_MESSAGES) {
    session.history.splice(0, session.history.length - MAX_HISTORY_MESSAGES);
  }
}

async function handleImageEdit(message, session, attachment, text) {
  const reply = content => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});

  if (!text) {
    return reply(
      "🖼️ Dis-moi ce que je dois faire avec cette image (ex : « mets-la en noir et blanc », « supprime l'arrière-plan », « ajoute un chapeau »). " +
      'Réponds à l\'image avec ta demande.'
    );
  }
  if (session.busy) return reply('⏳ Je travaille encore sur ta précédente image, un instant...');

  const wait = IMAGE_COOLDOWN_MS - (Date.now() - (imageCooldowns.get(message.author.id) || 0));
  if (wait > 0) return reply(`⏳ Patiente ${Math.ceil(wait / 1000)} s avant la prochaine modification.`);

  session.busy = true;
  try {
    await message.channel.sendTyping().catch(() => {});
    const dl = await downloadImage(attachment);
    if (dl.error) return reply(dl.error);

    imageCooldowns.set(message.author.id, Date.now());
    const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);
    let result;
    try {
      result = await editImageWithGemini({ buffer: dl.buffer, mimeType: dl.mimeType, instruction: text.slice(0, 1000) });
    } finally {
      clearInterval(typing);
    }
    if (result.error) return reply(result.error);

    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[result.image.mimeType] || 'png';
    const file = new AttachmentBuilder(result.image.buffer, { name: `corelab-edit.${ext}` });
    await message.reply({
      content: result.text
        ? result.text.slice(0, 1900)
        : '✅ Voilà ton image modifiée ! Réponds à cette image pour la modifier encore.',
      files: [file],
      allowedMentions: { repliedUser: false }
    });

    pushHistory(session, 'user', `[Image envoyée à modifier] ${text.slice(0, 500)}`);
    pushHistory(session, 'assistant', '[Image modifiée envoyée]');
  } catch (e) {
    console.error("Erreur édition d'image :", e.message);
    await reply("❌ Impossible d'envoyer l'image modifiée (elle est peut-être trop lourde pour ce serveur).");
  } finally {
    session.busy = false;
  }
}

function registerIaMessageHandler(client) {
  client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const session = activeSessions.get(message.channel.id);
    if (!session) return; // pas un salon IA connu (ou bot redémarré depuis)
    if (message.author.id !== session.userId) return;

    const text = (message.content || '').trim();

    // Image jointe (ou message qui répond à une image) → édition d'image
    const imageAttachment = await resolveImageSource(message);
    if (imageAttachment) return handleImageEdit(message, session, imageAttachment, text);

    if (!text) return;

    session.history.push({ role: 'user', content: message.content.slice(0, 4000) });
    if (session.history.length > MAX_HISTORY_MESSAGES) {
      session.history.splice(0, session.history.length - MAX_HISTORY_MESSAGES);
    }

    await message.channel.sendTyping().catch(() => {});
    const result = await askAi(session.history);

    if (result.error) {
      await message.channel.send(result.error).catch(() => {});
      return;
    }

    session.history.push({ role: 'assistant', content: result.content });
    if (session.history.length > MAX_HISTORY_MESSAGES) {
      session.history.splice(0, session.history.length - MAX_HISTORY_MESSAGES);
    }

    // Découpe si la réponse dépasse la limite Discord (2000 caractères)
    const chunks = result.content.match(/[\s\S]{1,1900}/g) || [result.content];
    for (const chunk of chunks) {
      await message.channel.send(chunk).catch(() => {});
    }
  });
}

// Reconstitue les sessions actives en mémoire après un redémarrage du bot,
// à partir des salons encore présents dans cfg.ia_tickets (sans historique).
function rehydrateIaSessions(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = getGuildConfig(guild.id);
    const tickets = cfg.ia_tickets || {};
    for (const [userId, channelId] of Object.entries(tickets)) {
      if (guild.channels.cache.has(String(channelId))) {
        activeSessions.set(String(channelId), { userId, guildId: guild.id, history: [] });
      }
    }
  }
}

module.exports = {
  setupIaChannel,
  routeIaInteraction,
  registerIaMessageHandler,
  rehydrateIaSessions
};