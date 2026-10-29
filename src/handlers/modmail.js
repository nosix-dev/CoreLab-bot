'use strict';

// ─────────────────────────────────────────────────────────────────────────
// MODMAIL
//  • Un membre écrit en MP au bot → un salon privé est créé dans le serveur
//    (catégorie réservée au staff) et le message y est transmis.
//  • Le staff répond en écrivant dans ce salon → la réponse est envoyée en MP.
//    Un message qui commence par « // » reste interne (note de staff, non envoyée).
//  • Fermeture : bouton « Fermer » ou /modmail close → transcription dans le
//    salon de logs (optionnel), le membre est prévenu en MP, le salon est supprimé.
//  • Les MP ne sont PLUS transférés au propriétaire du bot.
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { loadData, saveData } = require('../core/data');

const FICHIER = 'modmail.json';
const NOTE_PREFIX = '//';
const PENDING_TTL = 5 * 60 * 1000;

// { [guildId]: { enabled, categoryId, staffRoleId, logChannelId, blocked: [], threads: { [userId]: channelId }, counter } }
const data = loadData(FICHIER, {});

// Messages en attente du choix du serveur (utilisateur présent sur plusieurs serveurs avec Modmail)
const pending = new Map(); // userId → { content, files, expires }

function save() {
  saveData(FICHIER, data);
}

function getCfg(guildId) {
  const id = String(guildId);
  if (!data[id]) {
    data[id] = { enabled: false, categoryId: null, staffRoleId: null, logChannelId: null, blocked: [], threads: {}, counter: 0 };
  }
  const c = data[id];
  c.blocked ||= [];
  c.threads ||= {};
  c.counter ||= 0;
  return c;
}

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!(cfg.staffRoleId && member.roles?.cache?.has(cfg.staffRoleId));
}

// Retrouve (guildId, userId) à partir d'un salon de modmail
function findThreadByChannel(channelId) {
  for (const [guildId, cfg] of Object.entries(data)) {
    for (const [userId, chId] of Object.entries(cfg.threads || {})) {
      if (chId === channelId) return { guildId, userId, cfg };
    }
  }
  return null;
}

function findOpenThreadForUser(client, userId) {
  for (const [guildId, cfg] of Object.entries(data)) {
    const chId = cfg.threads?.[userId];
    if (chId && cfg.enabled && client.guilds.cache.has(guildId)) return { guildId, cfg, channelId: chId };
  }
  return null;
}

function attachmentLinks(message) {
  return [...message.attachments.values()].map(a => a.url);
}

function slugNom(user) {
  const s = (user.username || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  return `modmail-${s || user.id.slice(-6)}`;
}

function buildUserEmbed(message) {
  const files = attachmentLinks(message);
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setDescription((message.content || '*[sans texte]*').slice(0, 4000))
    .setFooter({ text: `ID : ${message.author.id}` })
    .setTimestamp();
  if (files.length) {
    embed.addFields({ name: '📎 Pièces jointes', value: files.map(u => `[Fichier](${u})`).join('\n').slice(0, 1024) });
    const img = [...message.attachments.values()].find(a => a.contentType?.startsWith('image/'));
    if (img) embed.setImage(img.url);
  }
  return embed;
}

function threadButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modmail_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
}

// ── Création d'un fil ──────────────────────────────────────────────────────
async function openThread(client, guild, user, firstContent, firstFiles) {
  const cfg = getCfg(guild.id);
  const category = cfg.categoryId ? await guild.channels.fetch(cfg.categoryId).catch(() => null) : null;
  if (!category) throw new Error('Catégorie Modmail introuvable.');

  cfg.counter += 1;
  const numero = cfg.counter;
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];
  if (cfg.staffRoleId) {
    overwrites.push({
      id: cfg.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: slugNom(user),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Modmail #${numero} | ${user.tag} (${user.id})`,
    permissionOverwrites: overwrites,
    reason: `Modmail : ${user.tag}`,
  });

  cfg.threads[user.id] = channel.id;
  save();

  const member = await guild.members.fetch(user.id).catch(() => null);
  const infos = new EmbedBuilder()
    .setTitle(`📬 Nouveau Modmail #${numero}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '👤 Membre', value: `${user} (\`${user.tag}\`)`, inline: true },
      { name: '🆔 ID', value: `\`${user.id}\``, inline: true },
      { name: '📅 Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '📥 Arrivé sur le serveur', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true },
    )
    .setDescription(
      `Écris dans ce salon pour répondre au membre : ton message lui sera envoyé en MP.\n` +
      `Commence ton message par \`${NOTE_PREFIX}\` pour une **note interne** (non envoyée).`
    )
    .setTimestamp();

  await channel.send({
    content: cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : undefined,
    embeds: [infos],
    components: [threadButtons()],
    allowedMentions: { roles: cfg.staffRoleId ? [cfg.staffRoleId] : [] },
  });

  if (firstContent || firstFiles?.length) {
    const emb = new EmbedBuilder()
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setDescription((firstContent || '*[sans texte]*').slice(0, 4000))
      .setTimestamp();
    if (firstFiles?.length) emb.addFields({ name: '📎 Pièces jointes', value: firstFiles.map(u => `[Fichier](${u})`).join('\n').slice(0, 1024) });
    await channel.send({ embeds: [emb], allowedMentions: { parse: [] } });
  }
  return channel;
}

// ── Message reçu en MP ────────────────────────────────────────────────────
// Retourne true si le message a été pris en charge par le Modmail.
async function handleDirectMessage(message, client) {
  const user = message.author;
  const files = attachmentLinks(message);
  if (!message.content && !files.length) return false;

  // Fil déjà ouvert → on transmet
  const open = findOpenThreadForUser(client, user.id);
  if (open) {
    const guild = client.guilds.cache.get(open.guildId);
    const channel = await guild.channels.fetch(open.channelId).catch(() => null);
    if (channel) {
      try {
        await channel.send({ embeds: [buildUserEmbed(message)], allowedMentions: { parse: [] } });
        await message.react('✅').catch(() => { });
      } catch (e) {
        console.error('[Modmail] Relais MP → staff :', e.message);
        await message.react('❌').catch(() => { });
      }
      return true;
    }
    // Salon supprimé à la main : on nettoie et on ouvre un nouveau fil plus bas
    delete open.cfg.threads[user.id];
    save();
  }

  // Serveurs éligibles : Modmail actif + l'utilisateur en est membre + pas bloqué
  const eligibles = [];
  for (const guild of client.guilds.cache.values()) {
    const cfg = data[guild.id];
    if (!cfg?.enabled || !cfg.categoryId) continue;
    if (cfg.blocked.includes(user.id)) continue;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) eligibles.push(guild);
  }

  if (!eligibles.length) {
    // Soit le Modmail n'est pas activé, soit la personne est bloquée : on ne transmet rien à personne.
    const bloque = [...client.guilds.cache.values()].some(g => data[g.id]?.enabled && data[g.id].blocked.includes(user.id));
    await message.channel.send(bloque
      ? '⛔ Tu ne peux pas contacter le staff par ce biais.'
      : '❌ Le Modmail n\'est pas disponible pour toi pour le moment.').catch(() => { });
    return true;
  }

  if (eligibles.length === 1) {
    await createAndConfirm(client, eligibles[0], message, message.content, files);
    return true;
  }

  // Plusieurs serveurs : l'utilisateur choisit
  pending.set(user.id, { content: message.content, files, expires: Date.now() + PENDING_TTL });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('modmail_pick')
    .setPlaceholder('Choisis le serveur à contacter')
    .addOptions(eligibles.slice(0, 25).map(g => ({ label: g.name.slice(0, 100), value: g.id })));
  await message.channel.send({
    content: '📬 Tu es sur plusieurs serveurs avec Modmail. **Lequel veux-tu contacter ?**',
    components: [new ActionRowBuilder().addComponents(menu)],
  }).catch(() => { });
  return true;
}

async function createAndConfirm(client, guild, message, content, files) {
  const user = message.author;
  try {
    await openThread(client, guild, user, content, files);
    const emb = new EmbedBuilder()
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setTitle('📬 Message envoyé au staff')
      .setDescription('Ton message a bien été transmis. Tu recevras la réponse ici, en message privé.\nTu peux continuer à écrire pour ajouter des précisions.')
      .setTimestamp();
    await message.channel.send({ embeds: [emb] }).catch(() => { });
  } catch (e) {
    console.error('[Modmail] Création du fil :', e.message);
    await message.channel.send('❌ Impossible de contacter le staff pour le moment, réessaie plus tard.').catch(() => { });
  }
}

// ── Message du staff dans un salon de modmail ────────────────────────────
// Retourne true si le message appartient à un fil Modmail.
async function handleStaffMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const thread = findThreadByChannel(message.channel.id);
  if (!thread) return false;

  if (message.content.startsWith(NOTE_PREFIX)) return true; // note interne
  if (!message.content && !message.attachments.size) return true;
  if (!isStaff(message.member, thread.cfg)) return true;

  try {
    const user = await client.users.fetch(thread.userId);
    const files = attachmentLinks(message);
    const emb = new EmbedBuilder()
      .setAuthor({ name: `${message.member?.displayName || message.author.username} • ${message.guild.name}`, iconURL: message.author.displayAvatarURL() })
      .setDescription((message.content || '*[pièce jointe]*').slice(0, 4000))
      .setTimestamp();
    if (files.length) {
      emb.addFields({ name: '📎 Pièces jointes', value: files.map(u => `[Fichier](${u})`).join('\n').slice(0, 1024) });
      const img = [...message.attachments.values()].find(a => a.contentType?.startsWith('image/'));
      if (img) emb.setImage(img.url);
    }
    await user.send({ embeds: [emb], allowedMentions: { parse: [] } });
    await message.react('✅').catch(() => { });
  } catch (e) {
    console.error('[Modmail] Relais staff → MP :', e.message);
    await message.react('❌').catch(() => { });
    await message.channel.send('⚠️ Impossible d\'envoyer le MP : le membre a probablement fermé ses messages privés ou a quitté.').catch(() => { });
  }
  return true;
}

// ── Fermeture ────────────────────────────────────────────────────────────
async function closeThread(client, channel, closer, reason) {
  const thread = findThreadByChannel(channel.id);
  if (!thread) return { ok: false, error: 'Ce salon n\'est pas un Modmail.' };
  const { cfg, userId } = thread;
  const guild = channel.guild;

  // Transcription → salon de logs
  if (cfg.logChannelId) {
    try {
      const logCh = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
      if (logCh?.isTextBased()) {
        const { generateTranscriptHtml } = require('../core/ticketTranscript');
        const { html, count } = await generateTranscriptHtml(channel);
        const emb = new EmbedBuilder()
          .setTitle('🔒 Modmail fermé')
          .addFields(
            { name: '👤 Membre', value: `<@${userId}> (\`${userId}\`)`, inline: true },
            { name: '❌ Fermé par', value: `<@${closer.id}>`, inline: true },
            { name: '💬 Messages', value: String(count ?? '—'), inline: true },
            { name: '📝 Raison', value: (reason || 'Aucune raison précisée').slice(0, 1024) },
          )
          .setTimestamp();
        await logCh.send({
          embeds: [emb],
          files: [new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `modmail-${channel.name}.html`.replace(/[^\w.\-]/g, '_') })],
          allowedMentions: { parse: [] },
        });
      }
    } catch (e) {
      console.error('[Modmail] Transcription :', e.message);
    }
  }

  // Prévenir le membre
  try {
    const user = await client.users.fetch(userId);
    const emb = new EmbedBuilder()
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setTitle('🔒 Conversation terminée')
      .setDescription(`Ta conversation avec le staff de **${guild.name}** a été fermée.${reason ? `\n**Raison :** ${reason.slice(0, 500)}` : ''}\n\nSi tu as une nouvelle question, écris-moi simplement à nouveau.`)
      .setTimestamp();
    await user.send({ embeds: [emb] });
  } catch { /* MP fermés */ }

  delete cfg.threads[userId];
  save();
  setTimeout(() => channel.delete(`Modmail fermé par ${closer.tag}`).catch(() => { }), 3000);
  return { ok: true };
}

// ── Interactions (boutons / menu) ────────────────────────────────────────
async function routeModmailInteraction(interaction) {
  const client = interaction.client;
  const id = interaction.customId;

  if (id === 'modmail_close' && interaction.guild) {
    const thread = findThreadByChannel(interaction.channelId);
    if (!thread) return interaction.reply({ content: '❌ Ce salon n\'est pas un Modmail.', flags: MessageFlags.Ephemeral });
    if (!isStaff(interaction.member, thread.cfg)) {
      return interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: '🔒 Fermeture en cours…' }).catch(() => { });
    await closeThread(client, interaction.channel, interaction.user, null);
    return;
  }

  if (id === 'modmail_pick' && interaction.isStringSelectMenu()) {
    const p = pending.get(interaction.user.id);
    if (!p || p.expires < Date.now()) {
      pending.delete(interaction.user.id);
      return interaction.update({ content: '⌛ Demande expirée. Renvoie-moi ton message.', components: [] }).catch(() => { });
    }
    pending.delete(interaction.user.id);
    const guild = client.guilds.cache.get(interaction.values[0]);
    const cfg = guild && data[guild.id];
    if (!guild || !cfg?.enabled || cfg.blocked.includes(interaction.user.id)) {
      return interaction.update({ content: '❌ Ce serveur n\'est plus disponible.', components: [] }).catch(() => { });
    }
    await interaction.update({ content: `⏳ Envoi à **${guild.name}**…`, components: [] }).catch(() => { });
    try {
      await openThread(client, guild, interaction.user, p.content, p.files);
      await interaction.editReply({ content: `📬 Ton message a été transmis au staff de **${guild.name}**. Tu recevras la réponse ici.` }).catch(() => { });
    } catch (e) {
      console.error('[Modmail] Création du fil :', e.message);
      await interaction.editReply({ content: '❌ Impossible de contacter le staff pour le moment.' }).catch(() => { });
    }
  }
}

// ── Nettoyage si un salon de modmail est supprimé à la main ──────────────
function registerModmailHandler(client) {
  client.on('channelDelete', channel => {
    if (!channel.guild) return;
    const cfg = data[channel.guild.id];
    if (!cfg) return;
    for (const [userId, chId] of Object.entries(cfg.threads || {})) {
      if (chId === channel.id) {
        delete cfg.threads[userId];
        save();
      }
    }
  });
}

module.exports = {
  data,
  save,
  getCfg,
  isStaff,
  findThreadByChannel,
  handleDirectMessage,
  handleStaffMessage,
  closeThread,
  routeModmailInteraction,
  registerModmailHandler,
};
