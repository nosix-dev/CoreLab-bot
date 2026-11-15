'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Interserveur (/interserveur) : relie un salon au réseau Chell et discute
// avec d'autres communautés en direct.
//   /interserveur setup   → panneau de configuration (réservé « Gérer le serveur ») :
//                           choisir le salon relié, activer / couper la liaison,
//                           bloquer ou débloquer un membre
//   /interserveur reseau  → voir combien de serveurs sont connectés au réseau
//
// Fonctionnement :
//   • Chaque serveur relie UN salon texte au réseau.
//   • Un message envoyé dans ce salon est recopié dans le salon relié de tous les autres serveurs,
//     avec le pseudo, l'avatar et le nom du serveur de l'auteur (via un webhook créé par le bot).
//   • Modifier ou supprimer son message met aussi à jour les copies.
//   • Sécurité : aucune mention (@everyone, @here, rôles, membres) n'est transmise,
//     les invitations Discord sont refusées, 1 message maximum toutes les 2 secondes par membre.
//   • Un serveur peut bloquer un membre : ses messages ne sortent plus du serveur
//     et ceux qu'il envoie ailleurs ne sont plus affichés ici.
//
// Données :
//   interserveur.json  { [guildId]: { enabled, channelId, blocked: [userId] } }
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  WebhookClient
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');

const FICHIER = 'interserveur.json';
const RESEAU = 'Chell'; // nom du réseau affiché partout
const COULEUR = 0xE8510D; // barre d'accent orange CoreLab
const WEBHOOK_NAME = 'CoreLab Interserveur';
const MSG_MIN_INTERVAL_MS = 2000; // anti-spam : 1 message relayé toutes les 2 s par membre
const MAX_BLOQUES = 25;
const MAX_CONTENT = 1800;
const MAX_PIECES_JOINTES = 5;
const MAX_SUIVI = 3000; // nombre de messages dont on garde les copies (pour éditer / supprimer)
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|discord\.me|discord\.io)\/\S+/i;

// ── Configuration (interserveur.json) ───────────────────────
const donnees = chargerDonnees(FICHIER, {});
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

function cfgOf(guildId, create = false) {
  const g = String(guildId);
  if (!donnees[g]) {
    if (!create) return null;
    donnees[g] = { enabled: true, channelId: null, blocked: [] };
    sauver();
  }
  const c = donnees[g];
  if (c.enabled === undefined) c.enabled = true;
  if (!Array.isArray(c.blocked)) c.blocked = [];
  return c;
}

// Index salon → serveur pour ignorer très vite les messages qui ne concernent pas le réseau
const salons = new Map();
function reindex() {
  salons.clear();
  for (const [g, c] of Object.entries(donnees)) {
    if (c?.channelId) salons.set(String(c.channelId), g);
  }
}
reindex();

function actifs() {
  return Object.entries(donnees).filter(([, c]) => c?.enabled && c.channelId);
}

// ── Webhooks ────────────────────────────────────────────────
const webhooks = new Map(); // channelId → { client: WebhookClient, id, token }

async function getWebhook(channel, clientUserId) {
  const cached = webhooks.get(channel.id);
  if (cached) return cached;
  let hook = null;
  const liste = await channel.fetchWebhooks();
  hook = liste.find(w => w.owner?.id === clientUserId && w.token && w.name === WEBHOOK_NAME)
    || liste.find(w => w.owner?.id === clientUserId && w.token);
  if (!hook) hook = await channel.createWebhook({ name: WEBHOOK_NAME, reason: `Interserveur : réseau ${RESEAU}` });
  const entry = { client: new WebhookClient({ id: hook.id, token: hook.token }), id: hook.id, token: hook.token };
  webhooks.set(channel.id, entry);
  return entry;
}

function dropWebhook(channelId) {
  const w = webhooks.get(channelId);
  if (w) { try { w.client.destroy(); } catch { /* ignoré */ } }
  webhooks.delete(channelId);
}

// ── Suivi des copies (édition / suppression) ────────────────
const suivi = new Map(); // idMessageOriginal → [{ channelId, messageId }]
function suivre(id, copies) {
  if (!copies.length) return;
  suivi.set(id, copies);
  if (suivi.size > MAX_SUIVI) suivi.delete(suivi.keys().next().value);
}

// ── Préparation du message ──────────────────────────────────
function nettoyerNom(nom) {
  // Discord refuse les noms de webhook contenant « discord » ou « clyde »
  return String(nom || 'Membre')
    .replace(/discord/gi, 'D1scord')
    .replace(/clyde/gi, 'Cl_yde')
    .replace(/[@#:`]/g, '')
    .trim()
    .slice(0, 80) || 'Membre';
}

function nomAffiche(message) {
  const auteur = message.member?.displayName || message.author.displayName || message.author.username;
  const serveur = message.guild.name;
  let nom = `${auteur} • ${serveur}`;
  if (nom.length > 80) nom = `${auteur.slice(0, 40)} • ${serveur.slice(0, 36)}`;
  return nettoyerNom(nom);
}

function extrait(texte, max = 90) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function construireContenu(message) {
  let contenu = String(message.content || '').trim();

  // Réponse : petit rappel du message cité
  if (message.reference?.messageId) {
    try {
      const cible = message.channel.messages.cache.get(message.reference.messageId)
        || await message.channel.messages.fetch(message.reference.messageId);
      if (cible) {
        const quiCite = cible.member?.displayName || cible.author?.displayName || cible.author?.username || 'Membre';
        const apercu = extrait(cible.content || (cible.attachments.size ? '[pièce jointe]' : ''));
        contenu = `> ↪ **${nettoyerNom(quiCite)}** : ${apercu}\n${contenu}`;
      }
    } catch { /* message cité introuvable : on ignore */ }
  }

  contenu = contenu.slice(0, MAX_CONTENT);

  const liens = [...message.attachments.values()].slice(0, MAX_PIECES_JOINTES).map(a => a.url);
  if (liens.length) contenu = `${contenu}${contenu ? '\n' : ''}${liens.join('\n')}`;
  return contenu.slice(0, 2000);
}

// ── Relais ──────────────────────────────────────────────────
const dernier = new Map();

async function relayer(client, message) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
  const guildId = salons.get(message.channelId);
  if (!guildId || guildId !== message.guild.id) return;
  const cfg = cfgOf(guildId);
  if (!cfg?.enabled || cfg.channelId !== message.channelId) return;
  if (cfg.blocked.includes(message.author.id)) return;
  if (!message.content?.trim() && !message.attachments.size) return;

  // Anti-spam
  const cle = `${guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (dernier.get(cle) || 0) < MSG_MIN_INTERVAL_MS) {
    message.react('⏳').catch(() => {});
    return;
  }
  dernier.set(cle, now);
  if (dernier.size > 5000) {
    for (const [k, t] of dernier) if (now - t > 60 * 1000) dernier.delete(k);
  }

  // Invitations refusées
  if (INVITE_RE.test(message.content || '')) {
    message.react('🚫').catch(() => {});
    return;
  }

  const contenu = await construireContenu(message);
  if (!contenu) return;
  const username = nomAffiche(message);
  const avatarURL = message.member?.displayAvatarURL?.({ size: 128 }) || message.author.displayAvatarURL({ size: 128 });

  const cibles = actifs().filter(([g]) => g !== guildId);
  const copies = [];
  await Promise.allSettled(cibles.map(async ([g, c]) => {
    if (c.blocked.includes(message.author.id)) return;
    const guild = client.guilds.cache.get(g);
    const channel = guild?.channels.cache.get(c.channelId);
    if (!channel?.isTextBased?.()) return;
    for (let essai = 0; essai < 2; essai++) {
      try {
        const hook = await getWebhook(channel, client.user.id);
        const envoye = await hook.client.send({
          content: contenu,
          username,
          avatarURL,
          allowedMentions: { parse: [] }
        });
        copies.push({ channelId: channel.id, messageId: envoye.id });
        return;
      } catch (e) {
        dropWebhook(channel.id);
        if (e?.code === 10015 && essai === 0) continue; // webhook supprimé : on le recrée une fois
        if (e?.code !== 50013 && e?.code !== 50001) console.error(`[Interserveur] envoi vers ${guild?.name || g} :`, e.message);
        return;
      }
    }
  }));

  suivre(message.id, copies);
  if (copies.length) message.react('🌐').catch(() => {});
}

async function modifierCopies(client, message) {
  const copies = suivi.get(message.id);
  if (!copies?.length) return;
  if (INVITE_RE.test(message.content || '')) return supprimerCopies(client, message.id);
  const contenu = await construireContenu(message);
  if (!contenu) return;
  await Promise.allSettled(copies.map(async cp => {
    try {
      const channel = client.channels.cache.get(cp.channelId);
      if (!channel) return;
      const hook = await getWebhook(channel, client.user.id);
      await hook.client.editMessage(cp.messageId, { content: contenu, allowedMentions: { parse: [] } });
    } catch (e) {
      if (e?.code !== 10008) console.error('[Interserveur] modification :', e.message);
    }
  }));
}

async function supprimerCopies(client, messageId) {
  const copies = suivi.get(messageId);
  if (!copies?.length) return;
  suivi.delete(messageId);
  await Promise.allSettled(copies.map(async cp => {
    try {
      const channel = client.channels.cache.get(cp.channelId);
      if (!channel) return;
      const hook = await getWebhook(channel, client.user.id);
      await hook.client.deleteMessage(cp.messageId);
    } catch (e) {
      if (e?.code !== 10008) console.error('[Interserveur] suppression :', e.message);
    }
  }));
}

// ── Panneau /interserveur setup ─────────────────────────────
const sep = (divider = true) => new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);
const txt = content => new TextDisplayBuilder().setContent(String(content).slice(0, 1800));

function nbServeurs() {
  return actifs().length;
}

function panel(guild, notice = null) {
  const cfg = cfgOf(guild.id, true);
  const c = new ContainerBuilder().setAccentColor(COULEUR);
  c.addTextDisplayComponents(txt(`## 🌐 Interserveur — réseau ${RESEAU}\nRelie un salon au réseau ${RESEAU} et discute avec d'autres communautés en direct.`));
  if (notice) c.addTextDisplayComponents(txt(`> ${notice}`));
  c.addSeparatorComponents(sep());

  const lignes = [
    `**État :** ${cfg.enabled ? '✅ activé' : '⛔ coupé'}`,
    `**Salon relié :** ${cfg.channelId ? `<#${cfg.channelId}>` : 'aucun'}`,
    `**Serveurs connectés :** ${nbServeurs()}`
  ];
  c.addTextDisplayComponents(txt(lignes.join('\n')));
  c.addSeparatorComponents(sep());

  const bloques = cfg.blocked.length
    ? cfg.blocked.slice(0, 10).map(id => `<@${id}>`).join(', ') + (cfg.blocked.length > 10 ? ` … (+${cfg.blocked.length - 10})` : '')
    : '*Aucun membre bloqué.*';
  c.addTextDisplayComponents(txt(`### Membres bloqués (${cfg.blocked.length}/${MAX_BLOQUES})\n${bloques}`));
  c.addSeparatorComponents(sep(false));

  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('interserveur:t:enabled').setLabel(cfg.enabled ? 'Couper la liaison' : 'Réactiver la liaison').setEmoji(cfg.enabled ? '⛔' : '✅').setStyle(ButtonStyle.Secondary).setDisabled(!cfg.channelId)
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('interserveur:chan')
      .setPlaceholder('Salon à relier au réseau (vide pour délier)')
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('interserveur:block')
      .setPlaceholder('Bloquer / débloquer un membre du réseau')
      .setMinValues(1)
      .setMaxValues(1)
  ));
  c.addSeparatorComponents(sep(false));
  c.addTextDisplayComponents(txt("-# Aucune mention n'est transmise • invitations Discord refusées • 1 message toutes les 2 s • modifier ou supprimer un message met à jour les copies"));
  return c;
}

const panelReply = (guild, notice) => ({ components: [panel(guild, notice)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const panelUpdate = (guild, notice) => ({ components: [panel(guild, notice)], allowedMentions: { parse: [] } });

function canManage(interaction) {
  const perms = interaction.memberPermissions;
  return !!(perms?.has(P.ManageGuild) || perms?.has(P.Administrator));
}

// ── Commande ────────────────────────────────────────────────
const interserveur = {
  data: new SlashCommandBuilder()
    .setName('interserveur')
    .setDescription(`🌐 Relie un salon au réseau ${RESEAU} et discute avec d'autres communautés`)
    .setDMPermission(false)
    .addSubcommand(s => s.setName('setup').setDescription('Configurer le salon relié au réseau, bloquer des membres'))
    .addSubcommand(s => s.setName('reseau').setDescription('Voir combien de serveurs sont connectés au réseau')),

  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) return reply('❌ Cette commande fonctionne uniquement dans un serveur.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      if (!canManage(interaction)) return reply('❌ Réservé aux personnes ayant la permission « Gérer le serveur ».');
      return interaction.reply(panelReply(guild));
    }

    if (sub === 'reseau') {
      const cfg = cfgOf(guild.id);
      const total = nbServeurs();
      const c = new ContainerBuilder().setAccentColor(COULEUR);
      c.addTextDisplayComponents(txt(`## 🌐 Réseau ${RESEAU}\n**${total}** serveur${total > 1 ? 's' : ''} connecté${total > 1 ? 's' : ''} en ce moment.`));
      c.addSeparatorComponents(sep(false));
      c.addTextDisplayComponents(txt(cfg?.channelId
        ? `Ce serveur est relié via <#${cfg.channelId}> (${cfg.enabled ? '✅ actif' : '⛔ coupé'}).`
        : "Ce serveur n'est pas relié. Un administrateur peut le faire avec `/interserveur setup`."));
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }
};

// ── Interactions du panneau ─────────────────────────────────
async function handleComponent(interaction, client) {
  const guild = interaction.guild;
  if (!guild) return;
  if (!canManage(interaction)) {
    return interaction.reply({ content: '❌ Réservé aux personnes ayant la permission « Gérer le serveur ».', flags: MessageFlags.Ephemeral });
  }
  const id = interaction.customId;
  const cfg = cfgOf(guild.id, true);

  if (id === 'interserveur:t:enabled') {
    if (!cfg.channelId) return interaction.update(panelUpdate(guild, '❌ Choisis d\'abord un salon à relier.'));
    cfg.enabled = !cfg.enabled;
    sauver();
    return interaction.update(panelUpdate(guild, cfg.enabled ? `✅ Liaison réactivée : tu es de nouveau connecté au réseau ${RESEAU}.` : '⛔ Liaison coupée : plus aucun message ne passe.'));
  }

  if (id === 'interserveur:chan') {
    const channelId = interaction.values?.[0] || null;
    if (!channelId) {
      cfg.channelId = null;
      sauver();
      reindex();
      return interaction.update(panelUpdate(guild, 'Salon délié du réseau.'));
    }
    const channel = guild.channels.cache.get(channelId);
    const perms = channel?.permissionsFor(guild.members.me);
    if (!perms?.has(P.ViewChannel) || !perms?.has(P.SendMessages)) {
      return interaction.update(panelUpdate(guild, `❌ Je ne peux pas écrire dans <#${channelId}>.`));
    }
    if (!perms.has(P.ManageWebhooks)) {
      return interaction.update(panelUpdate(guild, `❌ Il me faut la permission « Gérer les webhooks » dans <#${channelId}> pour afficher les pseudos et avatars.`));
    }
    try {
      dropWebhook(channelId);
      await getWebhook(channel, client.user.id);
    } catch (e) {
      return interaction.update(panelUpdate(guild, `❌ Impossible de préparer le salon : ${e.message}`));
    }
    cfg.channelId = channelId;
    cfg.enabled = true;
    sauver();
    reindex();
    channel.send({
      content: `🌐 Ce salon est maintenant relié au réseau **${RESEAU}**. Les messages envoyés ici seront vus par d'autres communautés, et inversement.\n-# Pas de pub ni d'invitation • aucune mention transmise • respecte les règles de ton serveur et de Discord.`,
      allowedMentions: { parse: [] }
    }).catch(() => {});
    return interaction.update(panelUpdate(guild, `✅ <#${channelId}> est relié au réseau ${RESEAU}.`));
  }

  if (id === 'interserveur:block') {
    const userId = interaction.values?.[0];
    if (!userId) return interaction.update(panelUpdate(guild));
    if (userId === interaction.user.id) return interaction.update(panelUpdate(guild, '❌ Tu ne peux pas te bloquer toi-même.'));
    const user = interaction.users?.get(userId);
    if (user?.bot) return interaction.update(panelUpdate(guild, '❌ Les bots ne sont jamais relayés.'));
    if (cfg.blocked.includes(userId)) {
      cfg.blocked = cfg.blocked.filter(u => u !== userId);
      sauver();
      return interaction.update(panelUpdate(guild, `✅ <@${userId}> est débloqué.`));
    }
    if (cfg.blocked.length >= MAX_BLOQUES) return interaction.update(panelUpdate(guild, `❌ Maximum ${MAX_BLOQUES} membres bloqués.`));
    cfg.blocked.push(userId);
    sauver();
    return interaction.update(panelUpdate(guild, `🚫 <@${userId}> est bloqué : ses messages ne sortent plus du serveur et ceux qu'il envoie ailleurs ne sont plus affichés ici.`));
  }
}

function registerInterserveur(client) {
  client.on('interactionCreate', interaction => {
    try {
      const id = interaction.customId;
      if (typeof id !== 'string' || !id.startsWith('interserveur:')) return;
      if (!interaction.isMessageComponent()) return;
      handleComponent(interaction, client).catch(e => {
        if (e?.code !== 10062 && e?.code !== 40060) console.error('[Interserveur] interaction :', e.message);
      });
    } catch (e) { console.error('[Interserveur] interaction :', e.message); }
  });

  client.on('messageCreate', message => {
    try {
      if (!salons.has(message.channelId)) return;
      relayer(client, message).catch(e => console.error('[Interserveur] relais :', e.message));
    } catch (e) { console.error('[Interserveur] message :', e.message); }
  });

  client.on('messageUpdate', (ancien, message) => {
    try {
      if (!suivi.has(message.id)) return;
      if (message.partial) return;
      modifierCopies(client, message).catch(e => console.error('[Interserveur] édition :', e.message));
    } catch (e) { console.error('[Interserveur] édition :', e.message); }
  });

  client.on('messageDelete', message => {
    try {
      if (!suivi.has(message.id)) return;
      supprimerCopies(client, message.id).catch(e => console.error('[Interserveur] suppression :', e.message));
    } catch (e) { console.error('[Interserveur] suppression :', e.message); }
  });

  // Salon supprimé : la liaison disparaît
  client.on('channelDelete', channel => {
    try {
      const g = salons.get(channel.id);
      if (!g) return;
      const cfg = cfgOf(g);
      if (cfg) { cfg.channelId = null; sauver(); }
      dropWebhook(channel.id);
      reindex();
    } catch (e) { console.error('[Interserveur] channelDelete :', e.message); }
  });

  // Bot retiré du serveur : on libère sa place dans le réseau
  client.on('guildDelete', guild => {
    try {
      if (!donnees[guild.id]) return;
      delete donnees[guild.id];
      sauver();
      reindex();
    } catch (e) { console.error('[Interserveur] guildDelete :', e.message); }
  });

  console.log(`✅ Interserveur initialisé (réseau ${RESEAU}).`);
}

module.exports = { commands: [interserveur], registerInterserveur, _test: { cfgOf, INVITE_RE, nettoyerNom } };
