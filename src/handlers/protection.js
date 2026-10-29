const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  PermissionFlagsBits,
  GuildVerificationLevel,
  AttachmentBuilder,
  AuditLogEvent,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ComponentType
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const {
  getGuildConfig,
  persist
} = require('../core/config');
const {
  logInfraction
} = require('../core/infractionLogger');
const {
  traduireDeepL
} = require('../core/deeplTranslate');

// ────────────────────────────────────────────────
// Suivi en mémoire (reset si le bot redémarre — comportement attendu,
// comme la plupart des bots de protection : pas besoin de persister
// des timestamps de spam/join).
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const joinTimestamps = new Map(); // guildId -> [timestamps]
const spamTracker = new Map(); // "guildId_userId" -> [timestamps]
const lockdowns = new Map(); // guildId -> { until, previousLevel }
const nukeTracker = new Map(); // guildId -> Map(executorId -> [timestamps])

const SPAM_MAX_MESSAGES = 6;
const SPAM_WINDOW_MS = 7000;
const SPAM_TIMEOUT_MS = 5 * 60 * 1000;
const { getProtectionLogChannelId } = require('../core/protectionLog');
async function sendProtectionLog(guild, embed, files = []) {
  const cfg = getGuildConfig(guild.id);
  const channelId = getProtectionLogChannelId(cfg);
  if (channelId) {
    const channel = guild.channels.cache.get(String(channelId));
    if (channel?.isTextBased?.()) {
      await channel.send(toCV2Payload({
        embeds: [embed],
        files
      })).catch(() => { });
    }
  }
  if (cfg.transparence_enabled && cfg.transparence_channel_id) {
    const publicChannel = guild.channels.cache.get(String(cfg.transparence_channel_id));
    if (publicChannel?.isTextBased?.()) {
      await publicChannel.send(toCV2Payload({
        embeds: [embed],
        files
      })).catch(() => { });
    }
  }
}

// ────────────────────────────────────────────────
// Âge minimum du compte
// ────────────────────────────────────────────────
async function checkAccountAge(member) {
  const cfg = getGuildConfig(member.guild.id);
  const minDays = Number(cfg.min_account_age_days) || 0;
  if (!minDays) return false;
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
  if (ageDays >= minDays) return false;
  try {
    await member.kick(`Âge minimum du compte non atteint (${Math.floor(ageDays)}j < ${minDays}j requis)`);
  } catch (e) {
    console.error('Erreur kick âge minimum :', e.message);
    return false;
  }
  const embed = new EmbedBuilder().setTitle('⏳ Âge minimum non respecté').setDescription(`${member.user.tag} (\`${member.id}\`) a été expulsé — compte créé il y a **${Math.floor(ageDays)} jour(s)** (minimum requis : **${minDays}j**).`).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(member.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Anti-bot (autorise ou non les bots à rejoindre le serveur)
// ────────────────────────────────────────────────
async function checkAntiBot(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.anti_bot_enabled) return false;
  try {
    await member.kick('Anti-bot — les bots ne sont pas autorisés à rejoindre ce serveur');
  } catch (e) {
    console.error('Erreur kick anti-bot :', e.message);
    return false;
  }
  const embed = new EmbedBuilder().setTitle('🤖 Anti-bot').setDescription(`${member.user.tag} (\`${member.id}\`) est un bot et a été expulsé automatiquement (Anti-bot activé).`).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(member.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Anti-alt (détecte les comptes probablement secondaires)
// ────────────────────────────────────────────────
async function checkAntiAlt(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.anti_alt_enabled) return false;
  const minDays = Number(cfg.anti_alt_min_days) || 7;
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
  const hasDefaultAvatar = !member.user.avatar;
  // Heuristique : compte très récent ET sans avatar personnalisé = probable alt
  if (ageDays >= minDays || !hasDefaultAvatar) return false;
  try {
    await member.kick(`Anti-alt — compte suspect (créé il y a ${Math.floor(ageDays)}j, sans avatar personnalisé)`);
  } catch (e) {
    console.error('Erreur kick anti-alt :', e.message);
    return false;
  }
  const embed = new EmbedBuilder().setTitle('👤 Anti-alt').setDescription(`${member.user.tag} (\`${member.id}\`) a été expulsé — compte suspecté d'être un alt (créé il y a **${Math.floor(ageDays)} jour(s)**, avatar par défaut, minimum requis : **${minDays}j**).`).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(member.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Anti-lien (supprime les messages contenant des liens)
// ────────────────────────────────────────────────
const ANTI_LINK_URL_REGEX = /https?:\/\/[^\s]+/i;
async function checkAntiLink(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.anti_link_enabled) return false;
  if (message.webhookId) return false; // les messages envoyés via webhook ne sont pas concernés
  const member = message.member;
  if (member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false; // staff exempté
  if (!ANTI_LINK_URL_REGEX.test(message.content || '')) return false;
  const contenu = message.content;
  try {
    await message.delete();
  } catch (e) {
    console.error('Erreur suppression message anti-lien :', e.message);
  }
  const warn = await message.channel.send(toCV2Payload({
    content: `${message.author}, les liens ne sont pas autorisés sur ce serveur.`
  })).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => { }), 6000);
  const embed = new EmbedBuilder().setTitle('🔗 Anti-lien').setDescription(`Message de ${message.author} (\`${message.author.id}\`) supprimé dans ${message.channel} — contenait un lien.`).addFields({
    name: 'Contenu',
    value: contenu?.slice(0, 1000) || '—'
  }).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(message.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Anti-Nuke (détecte les rafales d'actions destructrices)
// ────────────────────────────────────────────────
async function findAuditExecutor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: auditType,
      limit: 5
    });
    const entry = logs.entries.find(e => !targetId || e.target?.id === targetId || e.targetId === targetId) || logs.entries.first();
    if (!entry) return null;
    if (Date.now() - entry.createdTimestamp > 10000) return null; // entrée trop ancienne, pas fiable
    return entry.executor;
  } catch (e) {
    console.error('Erreur lecture audit log anti-nuke :', e.message);
    return null;
  }
}
async function recordNukeAction(guild, executor, actionLabel) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.anti_nuke_enabled || !executor || executor.bot) return;
  if (executor.id === guild.ownerId) return; // ne sanctionne jamais le propriétaire du serveur
  const gid = String(guild.id);
  const now = Date.now();
  const windowMs = (cfg.anti_nuke_window_seconds || 10) * 1000;
  const guildMap = nukeTracker.get(gid) || new Map();
  const list = (guildMap.get(executor.id) || []).filter(t => now - t < windowMs);
  list.push(now);
  guildMap.set(executor.id, list);
  nukeTracker.set(gid, guildMap);
  const threshold = cfg.anti_nuke_threshold || 3;
  if (list.length < threshold) return;
  guildMap.set(executor.id, []); // reset après sanction
  const member = await guild.members.fetch(executor.id).catch(() => null);
  let sanction = 'aucune (permissions insuffisantes ou membre introuvable)';
  if (member) {
    try {
      await member.roles.set([], 'Anti-Nuke — actions destructrices en rafale détectées');
      sanction = 'rôles retirés';
    } catch (e) {
      console.error('Erreur retrait rôles anti-nuke :', e.message);
    }
    try {
      await member.ban({
        reason: 'Anti-Nuke — actions destructrices en rafale détectées'
      });
      sanction = 'banni';
    } catch (e) {
      console.error('Erreur ban anti-nuke :', e.message);
    }
  }
  const embed = new EmbedBuilder().setTitle('💣 Anti-Nuke déclenché').setDescription(`${executor.tag} (\`${executor.id}\`) a déclenché **${list.length}** action(s) destructrices (${actionLabel}) en moins de **${cfg.anti_nuke_window_seconds}s**.\nSanction appliquée : **${sanction}**`).setColor(0xff0000).setTimestamp();
  await sendProtectionLog(guild, embed);
  try {
    await logInfraction(guild, {
      type: 'ban',
      target: executor,
      moderator: guild.client.user,
      reason: `Anti-Nuke — ${actionLabel} en rafale`
    });
  } catch (e) {
    console.error('Erreur journalisation anti-nuke :', e.message);
  }
}

// ────────────────────────────────────────────────
// Anti-Ghostping (signale les messages avec mention supprimés rapidement)
// ────────────────────────────────────────────────
async function checkGhostPing(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.anti_ghostping_enabled) return false;
  if (message.partial || message.author?.bot) return false;
  const hasMentions = message.mentions.users.size > 0 || message.mentions.roles.size > 0 || message.mentions.everyone;
  if (!hasMentions) return false;
  const pinged = [...message.mentions.users.map(u => `${u}`), ...message.mentions.roles.map(r => `${r}`)];
  if (message.mentions.everyone) pinged.push('@everyone/@here');
  const embed = new EmbedBuilder().setTitle('👻 Ghost Ping détecté').setDescription(`${message.author} (\`${message.author.id}\`) a supprimé un message qui mentionnait : ${pinged.join(', ') || '—'}`).addFields({
    name: 'Salon',
    value: `${message.channel}`,
    inline: true
  }, {
    name: 'Contenu',
    value: message.content?.slice(0, 1000) || '—'
  }).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(message.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Auto RaidMode (anti-raid)
// ────────────────────────────────────────────────
async function checkRaidMode(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.raidmode_enabled) return false;
  const gid = String(member.guild.id);
  const now = Date.now();
  const windowMs = (cfg.raidmode_window_seconds || 30) * 1000;
  const list = (joinTimestamps.get(gid) || []).filter(t => now - t < windowMs);
  list.push(now);
  joinTimestamps.set(gid, list);
  const alreadyLocked = lockdowns.get(gid);
  if (alreadyLocked && alreadyLocked.until > now) {
    // Lockdown déjà actif : on sanctionne aussi ce nouvel arrivant
    await applyRaidAction(member, cfg);
    return true;
  }
  if (list.length < (cfg.raidmode_threshold || 10)) return false;

  // Seuil dépassé → activation du lockdown
  let previousLevel = null;
  try {
    previousLevel = member.guild.verificationLevel;
    if (cfg.raidmode_action === 'lockdown') {
      await member.guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Auto RaidMode — vague de connexions suspecte');
    }
  } catch (e) {
    console.error('Erreur activation lockdown RaidMode :', e.message);
  }
  const durationMs = (cfg.raidmode_duration_minutes || 15) * 60000;
  lockdowns.set(gid, {
    until: now + durationMs,
    previousLevel
  });
  setTimeout(async () => {
    const l = lockdowns.get(gid);
    if (!l) return;
    lockdowns.delete(gid);
    try {
      if (cfg.raidmode_action === 'lockdown' && l.previousLevel !== null) {
        await member.guild.setVerificationLevel(l.previousLevel, 'Fin du lockdown Auto RaidMode');
      }
    } catch (e) {
      console.error('Erreur fin de lockdown :', e.message);
    }
    const embed = new EmbedBuilder().setTitle('🛡️ Auto RaidMode — fin du lockdown').setDescription('Le lockdown automatique a été levé.').setColor(0xFFFFFF).setTimestamp();
    sendProtectionLog(member.guild, embed).catch(() => { });
  }, durationMs);
  let embed = new EmbedBuilder().setTitle('🚨 Auto RaidMode déclenché').setDescription(`**${list.length}** arrivées détectées en moins de **${cfg.raidmode_window_seconds}s**.\n` + `Action : **${cfg.raidmode_action}** • Durée du lockdown : **${cfg.raidmode_duration_minutes} min**`).setColor(0xff0000).setTimestamp();
  let raidFiles = [];
  try {
    const { generateLogCard } = require('./logCardImage');
    const buf = generateLogCard({
      guildId: gid,
      theme: 'danger',
      title: 'Raid détecté',
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      blocks: [
        { label: 'Action', value: String(cfg.raidmode_action || 'lockdown') },
        { label: 'Fenêtre', value: `${cfg.raidmode_window_seconds} s` },
        { label: 'Durée du lockdown', value: `${cfg.raidmode_duration_minutes || 15} min` }
      ],
      bigLabel: 'Arrivées suspectes',
      bigValue: String(list.length),
      pills: [{ text: 'Auto RaidMode', tone: 'bad' }],
      footerLeft: `Seuil : ${cfg.raidmode_threshold || 10}`,
      footerRight: member.guild.name
    });
    raidFiles = [new AttachmentBuilder(buf, { name: 'raid.png' })];
    embed = new EmbedBuilder().setColor(0xff0000).setImage('attachment://raid.png').setTimestamp();
  } catch (e) {
    console.error('Erreur carte raid :', e.message);
  }
  await sendProtectionLog(member.guild, embed, raidFiles);
  await applyRaidAction(member, cfg);
  return true;
}
async function applyRaidAction(member, cfg) {
  try {
    if (cfg.raidmode_action === 'kick') {
      await member.kick('Auto RaidMode — vague de connexions suspecte');
    } else if (cfg.raidmode_action === 'ban') {
      await member.ban({
        reason: 'Auto RaidMode — vague de connexions suspecte'
      });
    }
    // action 'lockdown' : on ne sanctionne pas le membre, on relève juste le niveau de vérification du serveur
  } catch (e) {
    console.error('Erreur action RaidMode :', e.message);
  }
}

// ────────────────────────────────────────────────
// Anti-DDoS (inondation de messages distribuée : bots, webhooks, comptes jetables)
// ────────────────────────────────────────────────
// Principe : on compte les messages du serveur sur une fenêtre glissante. Si le total dépasse le
// seuil ET qu'il vient d'au moins N auteurs distincts (donc pas un simple spammeur isolé, géré par
// l'Anti-spam), une « alerte » démarre : slowmode sur les salons inondés, puis selon l'action
// choisie verrouillage du serveur (vérif. max) ou timeout des auteurs les plus actifs.
// À la fin de l'alerte (ou via « Lever l'alerte »), tout est remis comme avant.
// L'état de l'alerte est persisté dans la config : il survit à un redémarrage du bot.
const ddosTracker = new Map(); // guildId -> [{ t, uid, cid, mid }]
const ddosTimers = new Map(); // guildId -> Timeout (fin d'alerte)
const ddosBusy = new Set(); // guildId dont un déclenchement est en cours
const ddosLastRun = new Map(); // guildId -> timestamp du dernier traitement
const DDOS_SLOWMODE_SECONDS = 10;
const DDOS_TIMEOUT_MS = 10 * 60 * 1000;
const DDOS_MAX_TRACKED = 3000;
const DDOS_RERUN_MS = 5000;
const DDOS_ACTIONS = ['slowmode', 'lockdown', 'timeout'];

function ddosSettings(cfg) {
  return {
    threshold: Number(cfg.anti_ddos_threshold) || 30,
    windowMs: (Number(cfg.anti_ddos_window_seconds) || 10) * 1000,
    minUsers: Number(cfg.anti_ddos_min_users) || 5,
    durationMs: (Number(cfg.anti_ddos_duration_minutes) || 10) * 60000,
    action: DDOS_ACTIONS.includes(cfg.anti_ddos_action) ? cfg.anti_ddos_action : 'slowmode'
  };
}
function isDdosActive(cfg) {
  return Boolean(cfg.anti_ddos_state && cfg.anti_ddos_state.until > Date.now());
}

// Appelé pour chaque message (humains + webhooks). Détection synchrone, traitement en arrière-plan.
async function checkAntiDdos(message) {
  const guild = message.guild;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.anti_ddos_enabled) return false;
  const isWebhook = Boolean(message.webhookId);
  if (message.author?.bot && !isWebhook) return false; // les bots « normaux » (musique, etc.) ne comptent pas
  if (!isWebhook && message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false; // staff exempté
  const s = ddosSettings(cfg);
  const gid = String(guild.id);
  const now = Date.now();
  const list = (ddosTracker.get(gid) || []).filter(e => now - e.t < s.windowMs);
  list.push({
    t: now,
    uid: String(message.webhookId || message.author.id),
    cid: String(message.channelId),
    mid: message.id
  });
  if (list.length > DDOS_MAX_TRACKED) list.splice(0, list.length - DDOS_MAX_TRACKED);
  ddosTracker.set(gid, list);
  if (list.length < s.threshold) return false;
  if (new Set(list.map(e => e.uid)).size < s.minUsers) return false;
  if (ddosBusy.has(gid) || now - (ddosLastRun.get(gid) || 0) < DDOS_RERUN_MS) return true;
  ddosBusy.add(gid);
  ddosLastRun.set(gid, now);
  handleDdosTrigger(guild, cfg, s, [...list])
    .catch(e => console.error('Erreur Anti-DDoS :', e))
    .finally(() => ddosBusy.delete(gid));
  return true;
}

// Slowmode sur un salon inondé (on mémorise la valeur d'origine pour la remettre ensuite)
async function applyDdosSlowmode(guild, state, channelId, reason) {
  if (Object.prototype.hasOwnProperty.call(state.channels, channelId)) return false; // déjà fait
  const ch = guild.channels.cache.get(String(channelId));
  if (!ch || typeof ch.setRateLimitPerUser !== 'function') return false;
  const previous = Number(ch.rateLimitPerUser) || 0;
  if (previous >= DDOS_SLOWMODE_SECONDS) return false; // déjà au moins aussi strict : on n'y touche pas
  try {
    await ch.setRateLimitPerUser(DDOS_SLOWMODE_SECONDS, reason);
    state.channels[channelId] = previous;
    return true;
  } catch (e) {
    console.error('Erreur slowmode Anti-DDoS :', e.message);
    return false;
  }
}

async function handleDdosTrigger(guild, cfg, s, list) {
  const now = Date.now();
  const reason = 'Anti-DDoS — inondation de messages détectée';
  const existing = cfg.anti_ddos_state;
  const first = !existing || existing.until <= now;
  const state = first ? { started_at: now, until: now + s.durationMs, previous_verification: null, channels: {} } : existing;
  state.until = now + s.durationMs; // alerte « glissante » : tant que ça inonde, elle est prolongée
  state.channels = state.channels || {};
  cfg.anti_ddos_state = state; // enregistré tout de suite : si le bot plante en route, la fin d'alerte restera possible

  // 1. Slowmode sur les salons les plus touchés
  const perChannel = new Map();
  for (const e of list) perChannel.set(e.cid, (perChannel.get(e.cid) || 0) + 1);
  const minPerChannel = Math.max(3, Math.ceil(list.length * 0.15));
  const flooded = [...perChannel.entries()].filter(([, n]) => n >= minPerChannel).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  let slowed = 0;
  for (const cid of flooded) {
    if (await applyDdosSlowmode(guild, state, cid, reason)) slowed++;
  }

  // 2. Verrouillage du serveur (niveau de vérification maximal)
  let locked = false;
  if (s.action === 'lockdown' && (state.previous_verification === null || state.previous_verification === undefined) && guild.verificationLevel !== GuildVerificationLevel.VeryHigh) {
    const previous = guild.verificationLevel;
    try {
      await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, reason);
      state.previous_verification = previous;
      locked = true;
    } catch (e) {
      console.error('Erreur verrouillage Anti-DDoS :', e.message);
    }
  }

  // 3. Timeout des auteurs les plus actifs + purge de leurs messages
  const sanctioned = [];
  if (s.action === 'timeout') {
    const perUser = new Map();
    for (const e of list) perUser.set(e.uid, (perUser.get(e.uid) || 0) + 1);
    const offenders = [...perUser.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([uid]) => uid);
    for (const uid of offenders) {
      const member = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(() => null); // un webhook n'est pas un membre → ignoré
      if (!member || member.id === guild.ownerId || !member.moderatable) continue;
      if (member.permissions.has(PermissionFlagsBits.ManageMessages)) continue;
      try {
        await member.timeout(DDOS_TIMEOUT_MS, reason);
        sanctioned.push(uid);
      } catch (e) {
        console.error('Erreur timeout Anti-DDoS :', e.message);
      }
    }
    const byChannel = new Map();
    for (const e of list) {
      if (!sanctioned.includes(e.uid)) continue;
      byChannel.set(e.cid, [...(byChannel.get(e.cid) || []), e.mid]);
    }
    for (const [cid, ids] of byChannel) {
      const ch = guild.channels.cache.get(cid);
      if (ch && typeof ch.bulkDelete === 'function') await ch.bulkDelete(ids.slice(0, 100), true).catch(() => { });
    }
  }

  persist('configuration');
  scheduleDdosEnd(guild, state.until - Date.now());
  if (first || sanctioned.length) {
    await sendDdosAlert(guild, s, {
      total: list.length,
      distinct: new Set(list.map(e => e.uid)).size,
      slowed, locked, sanctioned: sanctioned.length, first
    });
  }
}

async function sendDdosAlert(guild, s, info) {
  const actionText = {
    slowmode: 'Slowmode des salons inondés',
    lockdown: 'Slowmode + verrouillage du serveur',
    timeout: 'Slowmode + timeout des auteurs les plus actifs'
  }[s.action];
  const lines = [
    `**${info.total}** messages de **${info.distinct}** auteurs différents en moins de **${s.windowMs / 1000}s**.`,
    `Action : **${actionText}** • Durée de l'alerte : **${s.durationMs / 60000} min**`,
    `Salons ralentis : **${info.slowed}**${info.locked ? ' • Serveur verrouillé' : ''}${info.sanctioned ? ` • Timeouts : **${info.sanctioned}**` : ''}`
  ];
  let embed = new EmbedBuilder().setTitle(info.first ? '🌊 Anti-DDoS déclenché' : '🌊 Anti-DDoS — alerte prolongée').setDescription(lines.join('\n')).setColor(0xff0000).setTimestamp();
  let files = [];
  try {
    const { generateLogCard } = require('./logCardImage');
    const buf = generateLogCard({
      guildId: String(guild.id),
      theme: 'danger',
      title: info.first ? 'Attaque détectée' : 'Alerte prolongée',
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      blocks: [
        { label: 'Action', value: actionText },
        { label: 'Fenêtre', value: `${s.windowMs / 1000} s` },
        { label: 'Durée de l\'alerte', value: `${s.durationMs / 60000} min` }
      ],
      bigLabel: 'Messages en rafale',
      bigValue: String(info.total),
      pills: [{ text: 'Anti-DDoS', tone: 'bad' }],
      footerLeft: `${info.distinct} auteurs • seuil ${s.threshold}`,
      footerRight: guild.name
    });
    files = [new AttachmentBuilder(buf, { name: 'ddos.png' })];
    embed = new EmbedBuilder().setColor(0xff0000).setImage('attachment://ddos.png').setTimestamp();
  } catch (e) {
    console.error('Erreur carte Anti-DDoS :', e.message);
  }
  await sendProtectionLog(guild, embed, files);
}

function scheduleDdosEnd(guild, delayMs) {
  const gid = String(guild.id);
  const old = ddosTimers.get(gid);
  if (old) clearTimeout(old);
  const delay = Math.max(1000, Math.min(Number(delayMs) || 0, 2000000000));
  ddosTimers.set(gid, setTimeout(() => {
    endDdos(guild, 'auto').catch(e => console.error('Erreur fin Anti-DDoS :', e));
  }, delay));
}

// Fin d'alerte : remet les slowmodes et le niveau de vérification comme avant.
// how : 'auto' (expiration) | 'manual' (bouton « Lever l'alerte » / désactivation) | 'restart'
async function endDdos(guild, how = 'auto') {
  const gid = String(guild.id);
  const cfg = getGuildConfig(gid);
  const timer = ddosTimers.get(gid);
  if (timer) clearTimeout(timer);
  ddosTimers.delete(gid);
  ddosTracker.delete(gid);
  const state = cfg.anti_ddos_state;
  if (!state) return false;
  cfg.anti_ddos_state = null;
  persist('configuration');
  const reason = 'Fin de l\'alerte Anti-DDoS';
  let restored = 0;
  for (const [cid, previous] of Object.entries(state.channels || {})) {
    const ch = guild.channels.cache.get(String(cid));
    // On ne touche pas au salon si le staff a changé le slowmode entre-temps
    if (ch && typeof ch.setRateLimitPerUser === 'function' && ch.rateLimitPerUser === DDOS_SLOWMODE_SECONDS) {
      try {
        await ch.setRateLimitPerUser(Number(previous) || 0, reason);
        restored++;
      } catch (e) {
        console.error('Erreur restauration slowmode Anti-DDoS :', e.message);
      }
    }
  }
  let unlocked = false;
  if (state.previous_verification !== null && state.previous_verification !== undefined && guild.verificationLevel === GuildVerificationLevel.VeryHigh) {
    try {
      await guild.setVerificationLevel(state.previous_verification, reason);
      unlocked = true;
    } catch (e) {
      console.error('Erreur restauration verrouillage Anti-DDoS :', e.message);
    }
  }
  const origin = how === 'manual' ? 'levée manuellement' : (how === 'restart' ? 'terminée (redémarrage du bot)' : 'terminée');
  const embed = new EmbedBuilder().setTitle('🌊 Anti-DDoS — fin de l\'alerte').setDescription(`L'alerte a été **${origin}**.\nSalons remis à la normale : **${restored}**${unlocked ? ' • Verrouillage levé' : ''}`).setColor(0xFFFFFF).setTimestamp();
  await sendProtectionLog(guild, embed);
  return true;
}

// Au démarrage : termine les alertes expirées, reprogramme celles qui sont encore en cours
function rehydrateDdos(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      const st = cfg.anti_ddos_state;
      if (!st) continue;
      const left = st.until - Date.now();
      if (left <= 0) endDdos(guild, 'restart').catch(e => console.error('Erreur reprise Anti-DDoS :', e));
      else scheduleDdosEnd(guild, left);
    } catch (e) {
      console.error('Erreur reprise Anti-DDoS :', e.message);
    }
  }
}

// ────────────────────────────────────────────────
// Anti-DDoS vocal (raid de connexions en salon vocal)
// ────────────────────────────────────────────────
// Deux protections :
//  1. Raid vocal : trop de connexions vocales en peu de temps, venant de nombreux comptes différents.
//     Action « lock » : @everyone ne peut plus se connecter aux salons vocaux touchés pendant l'alerte.
//     Action « disconnect » : idem + déconnexion des comptes qui viennent de rejoindre en rafale.
//  2. Saute-salon : un même membre qui change de salon vocal en boucle est déconnecté puis mis en timeout.
// L'état de l'alerte est persisté (survit à un redémarrage) ; les permissions sont remises comme avant à la fin.
const ddosVoiceTracker = new Map(); // guildId -> [{ t, uid, cid }]
const ddosVoiceHops = new Map(); // "guildId_userId" -> [timestamps]
const ddosVoiceTimers = new Map();
const ddosVoiceBusy = new Set();
const ddosVoiceLastRun = new Map();
const DDOS_VOICE_ACTIONS = ['lock', 'disconnect'];
const DDOS_VOICE_HOP_MAX = 6; // changements de salon...
const DDOS_VOICE_HOP_WINDOW_MS = 15000; // ...en 15 s
const DDOS_VOICE_HOP_TIMEOUT_MS = 5 * 60 * 1000;

function ddosVoiceSettings(cfg) {
  return {
    threshold: Number(cfg.anti_ddos_voice_threshold) || 15,
    windowMs: (Number(cfg.anti_ddos_voice_window_seconds) || 10) * 1000,
    minUsers: Number(cfg.anti_ddos_voice_min_users) || 6,
    durationMs: (Number(cfg.anti_ddos_voice_duration_minutes) || 10) * 60000,
    action: DDOS_VOICE_ACTIONS.includes(cfg.anti_ddos_voice_action) ? cfg.anti_ddos_voice_action : 'lock'
  };
}
function isDdosVoiceActive(cfg) {
  return Boolean(cfg.anti_ddos_voice_state && cfg.anti_ddos_voice_state.until > Date.now());
}
function isVoiceExempt(member) {
  if (!member) return true;
  const p = member.permissions;
  return Boolean(p?.has(PermissionFlagsBits.Administrator) || p?.has(PermissionFlagsBits.MoveMembers) || p?.has(PermissionFlagsBits.ManageChannels));
}

// Appelé à chaque voiceStateUpdate
async function checkAntiDdosVoice(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return false;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.anti_ddos_voice_enabled) return false;
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return false;
  if (!newState.channelId || newState.channelId === oldState.channelId) return false; // on ne compte que les connexions / changements de salon
  if (isVoiceExempt(member)) return false;
  const s = ddosVoiceSettings(cfg);
  const gid = String(guild.id);
  const now = Date.now();

  // 2. Saute-salon (changements répétés de salon par un même membre)
  if (oldState.channelId) {
    const hk = `${gid}_${member.id}`;
    const hops = (ddosVoiceHops.get(hk) || []).filter(t => now - t < DDOS_VOICE_HOP_WINDOW_MS);
    hops.push(now);
    ddosVoiceHops.set(hk, hops);
    if (hops.length >= DDOS_VOICE_HOP_MAX) {
      ddosVoiceHops.delete(hk);
      handleVoiceHop(guild, member).catch(e => console.error('Erreur Anti-DDoS vocal (saute-salon) :', e));
    }
  }

  // 1. Raid vocal (connexions distribuées)
  const list = (ddosVoiceTracker.get(gid) || []).filter(e => now - e.t < s.windowMs);
  list.push({ t: now, uid: member.id, cid: String(newState.channelId) });
  if (list.length > 1000) list.splice(0, list.length - 1000);
  ddosVoiceTracker.set(gid, list);
  if (list.length < s.threshold) return false;
  if (new Set(list.map(e => e.uid)).size < s.minUsers) return false;
  if (ddosVoiceBusy.has(gid) || now - (ddosVoiceLastRun.get(gid) || 0) < DDOS_RERUN_MS) return true;
  ddosVoiceBusy.add(gid);
  ddosVoiceLastRun.set(gid, now);
  handleVoiceTrigger(guild, cfg, s, [...list])
    .catch(e => console.error('Erreur Anti-DDoS vocal :', e))
    .finally(() => ddosVoiceBusy.delete(gid));
  return true;
}

async function handleVoiceHop(guild, member) {
  const reason = 'Anti-DDoS vocal — changements de salon vocal en rafale';
  let sanction = 'aucune (permissions insuffisantes)';
  try {
    if (member.voice?.channelId) await member.voice.disconnect(reason);
    sanction = 'déconnecté';
  } catch (e) {
    console.error('Erreur déconnexion saute-salon :', e.message);
  }
  try {
    if (member.moderatable) {
      await member.timeout(DDOS_VOICE_HOP_TIMEOUT_MS, reason);
      sanction = 'déconnecté + timeout 5 min';
    }
  } catch (e) {
    console.error('Erreur timeout saute-salon :', e.message);
  }
  const embed = new EmbedBuilder().setTitle('🔊 Anti-DDoS vocal — saute-salon').setDescription(`${member.user.tag} (\`${member.id}\`) a changé de salon vocal **${DDOS_VOICE_HOP_MAX}** fois en moins de **${DDOS_VOICE_HOP_WINDOW_MS / 1000}s**.\nSanction : **${sanction}**`).setColor(0xffa500).setTimestamp();
  await sendProtectionLog(guild, embed);
}

// État précédent de la permission Connect de @everyone sur un salon : true / false / null (neutre)
function readConnectOverwrite(channel, everyoneId) {
  const ow = channel.permissionOverwrites?.cache?.get(everyoneId);
  if (!ow) return null;
  if (ow.allow.has(PermissionFlagsBits.Connect)) return true;
  if (ow.deny.has(PermissionFlagsBits.Connect)) return false;
  return null;
}

async function handleVoiceTrigger(guild, cfg, s, list) {
  const now = Date.now();
  const reason = 'Anti-DDoS vocal — raid de connexions vocales détecté';
  const existing = cfg.anti_ddos_voice_state;
  const first = !existing || existing.until <= now;
  const state = first ? { started_at: now, until: now + s.durationMs, channels: {} } : existing;
  state.until = now + s.durationMs;
  state.channels = state.channels || {};
  cfg.anti_ddos_voice_state = state;

  // 1. Verrouillage des salons vocaux touchés (@everyone ne peut plus se connecter)
  const perChannel = new Map();
  for (const e of list) perChannel.set(e.cid, (perChannel.get(e.cid) || 0) + 1);
  const targets = [...perChannel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const everyoneId = guild.roles.everyone.id;
  let locked = 0;
  for (const cid of targets) {
    if (Object.prototype.hasOwnProperty.call(state.channels, cid)) continue;
    const ch = guild.channels.cache.get(cid);
    if (!ch || !ch.permissionOverwrites?.edit) continue;
    const previous = readConnectOverwrite(ch, everyoneId);
    if (previous === false) continue; // déjà verrouillé par le staff : on n'y touche pas
    try {
      await ch.permissionOverwrites.edit(everyoneId, { Connect: false }, { reason });
      state.channels[cid] = previous;
      locked++;
    } catch (e) {
      console.error('Erreur verrouillage vocal Anti-DDoS :', e.message);
    }
  }

  // 2. Déconnexion des comptes de la rafale (action « disconnect »)
  let disconnected = 0;
  if (s.action === 'disconnect') {
    const uids = [...new Set(list.map(e => e.uid))].slice(0, 50);
    for (const uid of uids) {
      const member = guild.members.cache.get(uid);
      if (!member || isVoiceExempt(member) || member.id === guild.ownerId || !member.voice?.channelId) continue;
      try {
        await member.voice.disconnect(reason);
        disconnected++;
      } catch (e) {
        console.error('Erreur déconnexion vocal Anti-DDoS :', e.message);
      }
    }
  }

  persist('configuration');
  scheduleDdosVoiceEnd(guild, state.until - Date.now());
  if (first || disconnected) {
    const actionText = s.action === 'disconnect' ? 'Verrouillage + déconnexion des arrivants' : 'Verrouillage des salons vocaux touchés';
    const embed = new EmbedBuilder().setTitle(first ? '🔊 Anti-DDoS vocal déclenché' : '🔊 Anti-DDoS vocal — alerte prolongée').setDescription(`**${list.length}** connexions vocales de **${new Set(list.map(e => e.uid)).size}** comptes différents en moins de **${s.windowMs / 1000}s**.\nAction : **${actionText}** • Durée de l'alerte : **${s.durationMs / 60000} min**\nSalons verrouillés : **${locked}**${disconnected ? ` • Déconnectés : **${disconnected}**` : ''}`).setColor(0xff0000).setTimestamp();
    await sendProtectionLog(guild, embed);
  }
}

function scheduleDdosVoiceEnd(guild, delayMs) {
  const gid = String(guild.id);
  const old = ddosVoiceTimers.get(gid);
  if (old) clearTimeout(old);
  const delay = Math.max(1000, Math.min(Number(delayMs) || 0, 2000000000));
  ddosVoiceTimers.set(gid, setTimeout(() => {
    endDdosVoice(guild, 'auto').catch(e => console.error('Erreur fin Anti-DDoS vocal :', e));
  }, delay));
}

async function endDdosVoice(guild, how = 'auto') {
  const gid = String(guild.id);
  const cfg = getGuildConfig(gid);
  const timer = ddosVoiceTimers.get(gid);
  if (timer) clearTimeout(timer);
  ddosVoiceTimers.delete(gid);
  ddosVoiceTracker.delete(gid);
  const state = cfg.anti_ddos_voice_state;
  if (!state) return false;
  cfg.anti_ddos_voice_state = null;
  persist('configuration');
  const everyoneId = guild.roles.everyone.id;
  const reason = 'Fin de l\'alerte Anti-DDoS vocal';
  let restored = 0;
  for (const [cid, previous] of Object.entries(state.channels || {})) {
    const ch = guild.channels.cache.get(String(cid));
    if (!ch || !ch.permissionOverwrites?.edit) continue;
    if (readConnectOverwrite(ch, everyoneId) !== false) continue; // le staff a modifié la permission entre-temps : on ne touche pas
    try {
      await ch.permissionOverwrites.edit(everyoneId, { Connect: previous === undefined ? null : previous }, { reason });
      restored++;
    } catch (e) {
      console.error('Erreur restauration vocal Anti-DDoS :', e.message);
    }
  }
  const origin = how === 'manual' ? 'levée manuellement' : (how === 'restart' ? 'terminée (redémarrage du bot)' : 'terminée');
  const embed = new EmbedBuilder().setTitle('🔊 Anti-DDoS vocal — fin de l\'alerte').setDescription(`L'alerte a été **${origin}**.\nSalons vocaux déverrouillés : **${restored}**`).setColor(0xFFFFFF).setTimestamp();
  await sendProtectionLog(guild, embed);
  return true;
}

function rehydrateDdosVoice(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      const st = cfg.anti_ddos_voice_state;
      if (!st) continue;
      const left = st.until - Date.now();
      if (left <= 0) endDdosVoice(guild, 'restart').catch(e => console.error('Erreur reprise Anti-DDoS vocal :', e));
      else scheduleDdosVoiceEnd(guild, left);
    } catch (e) {
      console.error('Erreur reprise Anti-DDoS vocal :', e.message);
    }
  }
}

// ────────────────────────────────────────────────
// Captcha de vérification (code à taper dans un salon)
// ────────────────────────────────────────────────
// Suivi en mémoire des vérifications en cours : "guildId_userId" -> {
//   code, attempts, maxAttempts, timeoutHandle, channelId,
//   unverifiedRoleId, verifiedRoleId, kickOnFail
// }
const captchaPending = new Map();
function generateCaptchaCode(length = 5) {
  // Lettres + chiffres, sans les caractères ambigus (0, O, 1, I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
function buildCaptchaEmbed(code, attemptsLeft, timeoutMinutes) {
  return new EmbedBuilder().setTitle('🔒 Vérification Captcha').setDescription('Bienvenue ! Pour accéder au serveur, veuillez taper le code suivant :').addFields({
    name: '📋 Code à taper :',
    value: `\`\`\`${code}\`\`\``,
    inline: false
  }, {
    name: '⏰ Temps restant :',
    value: `${timeoutMinutes} minute(s)`,
    inline: true
  }, {
    name: '🔄 Tentatives restantes :',
    value: `${attemptsLeft}`,
    inline: true
  }, {
    name: 'ℹ️ Instructions :',
    value: 'Tapez exactement le code affiché ci-dessus (sensible à la casse).',
    inline: false
  }).setColor(0xFFFFFF).setFooter({
    text: '⚠️ Attention : vous serez expulsé si vous échouez ou si le temps expire.'
  });
}
async function assignCaptcha(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.captcha_enabled || !cfg.captcha_role_id || !cfg.captcha_channel_id) return;
  const guild = member.guild;
  const unverifiedRole = guild.roles.cache.get(String(cfg.captcha_role_id));
  const channel = guild.channels.cache.get(String(cfg.captcha_channel_id));
  if (!unverifiedRole || !channel || !channel.isTextBased?.()) return;
  try {
    await member.roles.add(unverifiedRole, 'Captcha — en attente de vérification');
  } catch (e) {
    console.error('Erreur attribution rôle captcha :', e.message);
    return;
  }
  const key = `${guild.id}_${member.id}`;
  // Nettoyage d'une éventuelle vérification précédente (ex : re-join rapide)
  clearCaptchaPending(key);
  const maxAttempts = Number(cfg.captcha_max_attempts) || 3;
  const timeoutMinutes = Number(cfg.captcha_timeout_minutes) || 5;
  const code = generateCaptchaCode();
  const entry = {
    code,
    attempts: maxAttempts,
    maxAttempts,
    channelId: channel.id,
    unverifiedRoleId: unverifiedRole.id,
    verifiedRoleId: cfg.captcha_verified_role_id || null,
    kickOnFail: cfg.captcha_kick_on_fail !== false,
    timeoutHandle: null
  };
  captchaPending.set(key, entry);
  entry.timeoutHandle = setTimeout(() => {
    handleCaptchaTimeout(guild, member.id).catch(e => console.error('Erreur timeout captcha :', e.message));
  }, timeoutMinutes * 60000);
  const embed = buildCaptchaEmbed(code, maxAttempts, timeoutMinutes);
  try {
    await channel.send(toCV2Payload({
      content: `👋 ${member} Bienvenue sur **${guild.name}** !`,
      embeds: [embed]
    }));
  } catch (e) {
    console.error('Erreur envoi captcha :', e.message);
  }
}
function clearCaptchaPending(key) {
  const entry = captchaPending.get(key);
  if (entry?.timeoutHandle) clearTimeout(entry.timeoutHandle);
  captchaPending.delete(key);
}

// Traite un message envoyé dans le salon de vérification.
// Retourne true si le message a été géré par le captcha (pour stopper la chaîne de traitement).
async function handleCaptchaMessage(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.captcha_enabled || !cfg.captcha_channel_id) return false;
  if (message.channel.id !== String(cfg.captcha_channel_id)) return false;
  const key = `${message.guild.id}_${message.author.id}`;
  const entry = captchaPending.get(key);
  if (!entry) return false;

  // Garder le salon propre
  await message.delete().catch(() => { });
  if (message.content.trim() === entry.code) {
    await captchaVerifySuccess(message.guild, message.author.id, entry);
  } else {
    entry.attempts -= 1;
    if (entry.attempts <= 0) {
      await captchaVerifyFailed(message.guild, message.author.id, entry, 'attempts');
    } else {
      entry.code = generateCaptchaCode();
      const cfgTimeout = Number(cfg.captcha_timeout_minutes) || 5;
      const channel = message.channel;
      const errorEmbed = new EmbedBuilder().setTitle('❌ Code incorrect').setDescription(`<@${message.author.id}> Code incorrect ! Il vous reste **${entry.attempts}** tentative(s).`).setColor(0xff0000);
      await channel.send(toCV2Payload({
        embeds: [errorEmbed]
      })).catch(() => { });
      await channel.send(toCV2Payload({
        embeds: [buildCaptchaEmbed(entry.code, entry.attempts, cfgTimeout)]
      })).catch(() => { });
    }
  }
  return true;
}
async function captchaVerifySuccess(guild, userId, entry) {
  const key = `${guild.id}_${userId}`;
  clearCaptchaPending(key);
  const member = await guild.members.fetch(userId).catch(() => null);
  const channel = guild.channels.cache.get(entry.channelId);
  if (member) {
    try {
      const unverifiedRole = guild.roles.cache.get(entry.unverifiedRoleId);
      if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.remove(unverifiedRole, 'Captcha validé');
      }
      if (entry.verifiedRoleId) {
        const verifiedRole = guild.roles.cache.get(entry.verifiedRoleId);
        if (verifiedRole) await member.roles.add(verifiedRole, 'Captcha validé');
      }
    } catch (e) {
      console.error('Erreur retrait/ajout rôle captcha :', e.message);
    }
  }
  if (channel?.isTextBased?.()) {
    const embed = new EmbedBuilder().setTitle('✅ Vérification réussie !').setDescription(`${member ?? `<@${userId}>`} a été vérifié avec succès ! Bienvenue sur le serveur ! 🎉`).setColor(0x57F287);
    const sent = await channel.send(toCV2Payload({
      embeds: [embed]
    })).catch(() => null);
    if (sent) {
      setTimeout(() => sent.delete().catch(() => { }), 10000);
    }
  }
  const logEmbed = new EmbedBuilder().setTitle('✅ Captcha validé').setDescription(`${member ?? `<@${userId}>`} (\`${userId}\`) a validé le captcha.`).setColor(0x57F287).setTimestamp();
  await sendProtectionLog(guild, logEmbed);
}
async function captchaVerifyFailed(guild, userId, entry, reason) {
  const key = `${guild.id}_${userId}`;
  clearCaptchaPending(key);
  const member = await guild.members.fetch(userId).catch(() => null);
  const channel = guild.channels.cache.get(entry.channelId);
  const target = member ?? `<@${userId}>`;
  if (channel?.isTextBased?.()) {
    const embed = new EmbedBuilder().setColor(reason === 'timeout' ? 0xffa500 : 0xff0000).setTitle(reason === 'timeout' ? '⏰ Temps écoulé' : '❌ Vérification échouée').setDescription(reason === 'timeout' ? `${target} n'a pas réussi à se vérifier dans les temps.` : entry.kickOnFail ? `${target} a échoué à la vérification et va être expulsé.` : `${target} a échoué à la vérification. Contactez un administrateur.`);
    await channel.send(toCV2Payload({
      embeds: [embed]
    })).catch(() => { });
  }
  if (member && entry.kickOnFail) {
    try {
      await member.kick('Échec de la vérification captcha');
    } catch (e) {
      console.error('Erreur kick captcha :', e.message);
    }
  }
  const logEmbed = new EmbedBuilder().setTitle('❌ Captcha échoué').setDescription(`${target} (\`${userId}\`) a échoué la vérification captcha (${reason === 'timeout' ? 'temps écoulé' : 'tentatives épuisées'}).`).setColor(0xff0000).setTimestamp();
  await sendProtectionLog(guild, logEmbed);
}
async function handleCaptchaTimeout(guild, userId) {
  const key = `${guild.id}_${userId}`;
  const entry = captchaPending.get(key);
  if (!entry) return; // déjà résolu (validé, échoué, ou membre parti entre-temps
  await captchaVerifyFailed(guild, userId, entry, 'timeout');
}

// ────────────────────────────────────────────────
// Rôle de Tag (tag de serveur Discord)
// Fonctionnalité dépendante de l'exposition du champ "primaryGuild" par
// discord.js — best-effort : si le champ n'existe pas encore dans la
// version installée, cette vérification ne fait simplement rien.
// ────────────────────────────────────────────────
function getPrimaryGuildId(user) {
  const pg = user?.primaryGuild;
  if (!pg) return null;
  return pg.identityGuildId ?? pg.identity_guild_id ?? null;
}
async function checkTagRole(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.tag_role_enabled || !cfg.tag_role_id) return;
  const role = member.guild.roles.cache.get(String(cfg.tag_role_id));
  if (!role) return;
  const hasTag = getPrimaryGuildId(member.user) === member.guild.id;
  const hasRole = member.roles.cache.has(role.id);
  try {
    if (hasTag && !hasRole) await member.roles.add(role, 'Tag de serveur détecté'); else if (!hasTag && hasRole) await member.roles.remove(role, 'Tag de serveur retiré');
  } catch (e) {
    console.error('Erreur rôle de tag :', e.message);
  }
}

// ────────────────────────────────────────────────
// Anti-spam (fréquence de messages)
// ────────────────────────────────────────────────
async function checkAntiSpam(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.antispam) return false;
  const key = `${message.guild.id}_${message.author.id}`;
  const now = Date.now();
  const list = (spamTracker.get(key) || []).filter(t => now - t < SPAM_WINDOW_MS);
  list.push(now);
  spamTracker.set(key, list);
  if (list.length < SPAM_MAX_MESSAGES) return false;
  spamTracker.set(key, []); // évite de re-sanctionner en boucle

  try {
    if (message.member?.moderatable) {
      await message.member.timeout(SPAM_TIMEOUT_MS, 'Anti-spam — envoi massif de messages');
    }
  } catch (e) {
    console.error('Erreur sanction anti-spam :', e.message);
  }
  const embed = new EmbedBuilder().setTitle('🚫 Anti-spam déclenché').setDescription(`${message.author} (\`${message.author.id}\`) a envoyé **${list.length}** messages en moins de **${SPAM_WINDOW_MS / 1000}s**.\nSanction : timeout 5 minutes.`).setColor(0xff0000).setTimestamp();
  await sendProtectionLog(message.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// Anti-@everyone / mention de masse
// ────────────────────────────────────────────────
async function checkAntiEveryone(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.antieveryone) return false;
  const mentionsEveryone = message.mentions.everyone;
  const massUserMentions = message.mentions.users.size >= 5;
  if (!mentionsEveryone && !massUserMentions) return false;
  const me = message.guild.members.me;
  if (message.deletable && me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => { });
  }
  const embed = new EmbedBuilder().setTitle('🔕 Anti-@everyone déclenché').setDescription(`${message.author} (\`${message.author.id}\`) a envoyé un message contenant ${mentionsEveryone ? '**@everyone/@here**' : `**${message.mentions.users.size} mentions**`}.`).setColor(0xff0000).setTimestamp();
  await sendProtectionLog(message.guild, embed);
  return true;
}

// ────────────────────────────────────────────────
// HoneyPot (salon piège)
// ────────────────────────────────────────────────
async function checkHoneypot(message) {
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.honeypot_enabled || !cfg.honeypot_channel_id) return false;
  if (message.channel.id !== String(cfg.honeypot_channel_id)) return false;
  const member = message.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return false; // on épargne le staff

  // Capture les pièces jointes AVANT suppression du message (les URLs Discord expirent une fois le message supprimé)
  const originalAttachments = message.attachments?.size ? Array.from(message.attachments.values()) : [];
  const imageAttachment = originalAttachments.find(a => (a.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
  let honeypotImageFile = null;
  let honeypotImageName = null;
  if (imageAttachment) {
    try {
      const resp = await fetch(imageAttachment.url);
      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        honeypotImageName = imageAttachment.name || 'image.png';
        honeypotImageFile = new AttachmentBuilder(buffer, {
          name: honeypotImageName
        });
      }
    } catch (e) {
      console.error('Erreur récupération image HoneyPot :', e.message);
    }
  }
  if (message.deletable) await message.delete().catch(() => { });

  // Mode "revue staff" : timeout 24 h + MP au membre + carte Bannir / Ne pas bannir dans le salon staff
  const reviewChannel = cfg.honeypot_review_channel_id ? message.guild.channels.cache.get(String(cfg.honeypot_review_channel_id)) : null;
  if (reviewChannel?.isTextBased?.()) {
    return handleHoneypotReview(message, cfg, reviewChannel, originalAttachments, honeypotImageFile, honeypotImageName);
  }

  // Détermine l'action à appliquer selon la configuration
  const action = cfg.infraction_default_action || 'ban';
  const reason = 'HoneyPot — message envoyé dans le salon piège';
  let actionLabel = 'sanction appliquée';
  let sanctionApplied = false;
  let sanctionError = null;
  try {
    if (action === 'ban') {
      if (member?.bannable) {
        await member.ban({
          reason
        });
        sanctionApplied = true;
      } else sanctionError = 'permissions insuffisantes pour bannir ce membre';
      actionLabel = 'a été banni';
    } else if (action === 'kick') {
      if (member?.kickable) {
        await member.kick(reason);
        sanctionApplied = true;
      } else sanctionError = 'permissions insuffisantes pour expulser ce membre';
      actionLabel = 'a été expulsé';
    } else if (action === 'timeout' || action === 'mute') {
      const minutes = Number(cfg.infraction_default_duration_minutes) || 10;
      const ms = minutes * 60 * 1000;
      if (member?.moderatable) {
        await member.timeout(ms, reason);
        sanctionApplied = true;
      } else sanctionError = 'permissions insuffisantes pour mettre ce membre en timeout';
      actionLabel = `mis en timeout (${minutes} min)`;
    } else if (action === 'warn') {
      // Pas de sanction, juste journaliser
      actionLabel = 'avertissement enregistré';
      sanctionApplied = true;
    } else {
      // fallback : ban
      if (member?.bannable) {
        await member.ban({
          reason
        });
        sanctionApplied = true;
      } else sanctionError = 'permissions insuffisantes pour bannir ce membre';
      actionLabel = 'a été banni';
    }
  } catch (e) {
    console.error('Erreur sanction HoneyPot :', e.message);
    sanctionError = e.message;
  }

  // Journalise l'infraction via le logger centralisé
  try {
    await logInfraction(message.guild, {
      type: action === 'timeout' ? 'timeout' : action || 'ban',
      target: member?.user || message.author,
      moderator: message.client.user,
      reason: reason,
      duration: action === 'timeout' ? cfg.infraction_default_duration_minutes ? `${cfg.infraction_default_duration_minutes} minute(s)` : null : null
    });
  } catch (e) {
    // ne bloque pas l'exécution si le logger échoue
    console.error('Erreur journalisation infraction HoneyPot :', e.message);
  }

  // Met à jour le compteur de sanctions sur l'embed d'avertissement du salon
  cfg.honeypot_sanctions_count = (cfg.honeypot_sanctions_count || 0) + 1;
  persist('configuration');
  if (cfg.honeypot_message_id) {
    try {
      const warningMsg = await message.channel.messages.fetch(cfg.honeypot_message_id);
      const description = cfg.honeypot_lang === 'en' ? cfg.honeypot_text_en || buildHoneypotText(cfg) : buildHoneypotText(cfg);
      const row = buildHoneypotWarningRow(cfg);
      row.components[1].setLabel(cfg.honeypot_lang === 'en' ? '🌐 Français' : '🌐 Translate');
      await warningMsg.edit({ ...buildHoneypotWarningPayload(cfg, description, row), attachments: [] });
    } catch (e) {
      console.error('Erreur mise à jour compteur HoneyPot :', e.message);
    }
  }
  const content = (message.content || '').trim();
  const embed = new EmbedBuilder().setTitle('🍯 HoneyPot déclenché').setColor(sanctionApplied ? 0xff0000 : 0xffa500).setThumbnail(message.author.displayAvatarURL({
    size: 256
  })).addFields({
    name: '👤 Membre',
    value: `${message.author} (\`${message.author.id}\`)`,
    inline: true
  }, {
    name: '📍 Salon',
    value: `${message.channel}`,
    inline: true
  }, {
    name: '\u200B',
    value: '\u200B',
    inline: true
  }, {
    name: '🛡️ Sanction',
    value: sanctionApplied ? `✅ ${actionLabel}` : `❌ Échec (${sanctionError || 'raison inconnue'})`,
    inline: true
  }, {
    name: '📅 Compte créé',
    value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`,
    inline: true
  }, {
    name: '📥 A rejoint le serveur',
    value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu',
    inline: true
  }, {
    name: '💬 Message envoyé',
    value: content ? `\`\`\`${content.slice(0, 900)}\`\`\`` : '*(vide)*',
    inline: false
  }).setTimestamp();
  const logFiles = [];
  if (originalAttachments.length) {
    embed.addFields({
      name: '📎 Pièces jointes',
      value: originalAttachments.map(a => `[${a.name}](${a.url})`).join('\n').slice(0, 1024),
      inline: false
    });
  }
  if (honeypotImageFile) {
    embed.setImage(`attachment://${honeypotImageName}`);
    logFiles.push(honeypotImageFile);
  }
  await sendProtectionLog(message.guild, embed, logFiles);
  return true;
}

// ────────────────────────────────────────────────
// HoneyPot — mode "revue staff"
//  1. le membre est mis en timeout 24 h automatiquement
//  2. il reçoit un MP du bot qui l'explique
//  3. le staff reçoit une carte avec [Bannir] / [Ne pas bannir]
//     - Bannir      → ban définitif
//     - Ne pas bannir → timeout retiré + MP "sanction levée"
// ────────────────────────────────────────────────
const HONEYPOT_REVIEW_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// "guildId_userId" -> id du message de revue en attente (pour regrouper les messages suivants du même membre)
const honeypotPendingReviews = new Map();

async function handleHoneypotReview(message, cfg, reviewChannel, originalAttachments, imageFile, imageName) {
  const guild = message.guild;
  const author = message.author;
  const member = message.member;
  const key = `${guild.id}_${author.id}`;
  const content = (message.content || '').trim();
  const reason = 'HoneyPot — message envoyé dans le salon piège (timeout 24 h en attente de décision du staff)';

  // Le membre a déjà une revue en cours : on ajoute juste son nouveau message sous la carte existante
  const pendingId = honeypotPendingReviews.get(key);
  if (pendingId) {
    const extra = new EmbedBuilder().setTitle('💬 Nouveau message dans le salon piège').setDescription(`${author} (\`${author.id}\`) a encore écrit dans ${message.channel}.`).addFields({
      name: '💬 Message envoyé',
      value: content ? `\`\`\`${content.slice(0, 900)}\`\`\`` : '*(vide)*',
      inline: false
    }).setColor(0xffa500).setTimestamp();
    if (originalAttachments.length) {
      extra.addFields({
        name: '📎 Pièces jointes',
        value: originalAttachments.map(a => `[${a.name}](${a.url})`).join('\n').slice(0, 1024),
        inline: false
      });
    }
    const files = [];
    if (imageFile) {
      extra.setImage(`attachment://${imageName}`);
      files.push(imageFile);
    }
    await reviewChannel.send(toCV2Payload({
      embeds: [extra],
      files,
      reply: {
        messageReference: pendingId,
        failIfNotExists: false
      }
    })).catch(e => console.error('Erreur envoi message supplémentaire HoneyPot :', e?.message || e));
    return true;
  }

  // 1) Timeout 24 h
  let timeoutApplied = false;
  let sanctionError = null;
  try {
    if (member?.moderatable) {
      await member.timeout(HONEYPOT_REVIEW_TIMEOUT_MS, reason);
      timeoutApplied = true;
    } else sanctionError = 'permissions insuffisantes pour mettre ce membre en timeout';
  } catch (e) {
    console.error('Erreur timeout HoneyPot (revue) :', e.message);
    sanctionError = e.message;
  }

  // 2) MP au membre
  let dmSent = false;
  try {
    await author.send(`⏳ Tu as été mis en **timeout pendant 24 heures** sur le serveur **${guild.name}**, car tu as écrit un message dans le salon piège (HoneyPot).\n\nUn membre du staff va examiner la situation et décidera de la suite. Si tu es victime d'un compte piraté, change ton mot de passe et active la double authentification.`);
    dmSent = true;
  } catch (e) {
    // MP fermés : on continue
  }

  // 3) Journalisation + compteur
  try {
    await logInfraction(guild, {
      type: 'timeout',
      target: author,
      moderator: message.client.user,
      reason,
      duration: '24 heure(s)'
    });
  } catch (e) {
    console.error('Erreur journalisation infraction HoneyPot (revue) :', e.message);
  }
  cfg.honeypot_sanctions_count = (cfg.honeypot_sanctions_count || 0) + 1;
  persist('configuration');
  if (cfg.honeypot_message_id) {
    try {
      const warningMsg = await message.channel.messages.fetch(cfg.honeypot_message_id);
      const description = cfg.honeypot_lang === 'en' ? cfg.honeypot_text_en || buildHoneypotText(cfg) : buildHoneypotText(cfg);
      const row = buildHoneypotWarningRow(cfg);
      row.components[1].setLabel(cfg.honeypot_lang === 'en' ? '🌐 Français' : '🌐 Translate');
      await warningMsg.edit({ ...buildHoneypotWarningPayload(cfg, description, row), attachments: [] });
    } catch (e) {
      console.error('Erreur mise à jour compteur HoneyPot :', e.message);
    }
  }

  // 4) Carte de revue pour le staff
  const embed = new EmbedBuilder().setTitle('🍯 HoneyPot — décision requise').setColor(timeoutApplied ? 0xffa500 : 0xff0000).setThumbnail(author.displayAvatarURL({
    size: 256
  })).addFields({
    name: '👤 Membre',
    value: `${author} (\`${author.id}\`)`,
    inline: true
  }, {
    name: '📍 Salon',
    value: `${message.channel}`,
    inline: true
  }, {
    name: '⏳ Timeout 24 h',
    value: timeoutApplied ? '✅ Appliqué' : `❌ Échec (${sanctionError || 'raison inconnue'})`,
    inline: true
  }, {
    name: '✉️ MP envoyé au membre',
    value: dmSent ? '✅ Oui' : '❌ Impossible (MP fermés)',
    inline: true
  }, {
    name: '📅 Compte créé',
    value: `<t:${Math.floor(author.createdTimestamp / 1000)}:R>`,
    inline: true
  }, {
    name: '📥 A rejoint le serveur',
    value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu',
    inline: true
  }, {
    name: '💬 Message envoyé',
    value: content ? `\`\`\`${content.slice(0, 900)}\`\`\`` : '*(vide)*',
    inline: false
  }).setTimestamp();
  const files = [];
  if (originalAttachments.length) {
    embed.addFields({
      name: '📎 Pièces jointes',
      value: originalAttachments.map(a => `[${a.name}](${a.url})`).join('\n').slice(0, 1024),
      inline: false
    });
  }
  if (imageFile) {
    embed.setImage(`attachment://${imageName}`);
    files.push(imageFile);
  }
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`protect_honeypot_ban_${guild.id}_${author.id}`).setLabel('Bannir').setEmoji('🔨').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`protect_honeypot_keep_${guild.id}_${author.id}`).setLabel('Ne pas bannir').setEmoji('🕊️').setStyle(ButtonStyle.Success));
  const sent = await reviewChannel.send(toCV2Payload({
    embeds: [embed],
    components: [row],
    files
  })).catch(e => {
    console.error('Erreur envoi carte de revue HoneyPot :', e?.message || e);
    return null;
  });
  if (sent) honeypotPendingReviews.set(key, sent.id);
  return true;
}

// Boutons [Bannir] / [Ne pas bannir] de la carte de revue
async function resolveHoneypotReview(interaction, ban) {
  const [, , , guildId, userId] = interaction.customId.split('_');
  if (!interaction.inGuild() || interaction.guild.id !== guildId) {
    return interaction.reply({
      content: '❌ Serveur introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({
      content: '❌ Il faut la permission **Bannir des membres** pour traiter cette demande.',
      flags: MessageFlags.Ephemeral
    });
  }
  const guild = interaction.guild;
  const key = `${guildId}_${userId}`;
  const staff = interaction.user;
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  const userLabel = user ? `${user} (\`${userId}\`)` : `\`${userId}\``;
  let resultLine;
  let color;
  if (ban) {
    try {
      await guild.members.ban(userId, {
        reason: `HoneyPot — bannissement confirmé par ${staff.tag}`
      });
      resultLine = `🔨 ${userLabel} a été **banni** par ${staff}.`;
      color = 0xff0000;
      if (user) {
        try {
          await logInfraction(guild, {
            type: 'ban',
            target: user,
            moderator: staff,
            reason: 'HoneyPot — bannissement confirmé par le staff'
          });
        } catch (e) {
          console.error('Erreur journalisation ban HoneyPot :', e.message);
        }
      }
    } catch (e) {
      console.error('Erreur ban HoneyPot (revue) :', e.message);
      return interaction.reply({
        content: '❌ Impossible de bannir ce membre (permissions ou hiérarchie des rôles).',
        flags: MessageFlags.Ephemeral
      });
    }
  } else {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.timeout(null, `HoneyPot — sanction levée par ${staff.tag}`).catch(e => console.error('Erreur retrait timeout HoneyPot :', e.message));
    }
    if (user) {
      await user.send(`🕊️ Ta sanction sur le serveur **${guild.name}** a été **levée** : ton timeout est retiré.\n\nÀ l'avenir, évite d'écrire dans le salon piège (HoneyPot).`).catch(() => { });
    }
    resultLine = `🕊️ Sanction de ${userLabel} **levée** par ${staff} (timeout retiré${member ? '' : ' — le membre a quitté le serveur'}).`;
    color = 0x57f287;
    if (user) {
      try {
        await logInfraction(guild, {
          type: 'untimeout',
          target: user,
          moderator: staff,
          reason: 'HoneyPot — bannissement refusé par le staff, sanction levée'
        });
      } catch (e) {
        console.error('Erreur journalisation levée de sanction HoneyPot :', e.message);
      }
    }
  }
  honeypotPendingReviews.delete(key);

  // On garde la carte d'origine (infos + message) et on remplace les boutons par le résultat
  const kept = [];
  for (const c of interaction.message.components || []) {
    if (c.type === ComponentType.ActionRow) continue;
    kept.push(typeof c.toJSON === 'function' ? c.toJSON() : c);
  }
  kept.push(new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(resultLine)));
  return interaction.update({
    components: kept,
    flags: MessageFlags.IsComponentsV2
  });
}

// ────────────────────────────────────────────────
// Cadenas sur les salons verrouillés (lockdown manuel)
// ────────────────────────────────────────────────
async function lockAllChannels(guild) {
  const cfg = getGuildConfig(guild.id);
  const everyoneId = guild.roles.everyone.id;
  const previousState = {};
  const lockedIds = [];
  const textChannels = guild.channels.cache.filter(c => c.isTextBased?.() && !c.isThread?.());
  for (const channel of textChannels.values()) {
    try {
      const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
      const current = overwrite?.deny?.has(PermissionFlagsBits.SendMessages) ? 'deny' : overwrite?.allow?.has(PermissionFlagsBits.SendMessages) ? 'allow' : 'neutral';
      previousState[channel.id] = current;
      await channel.permissionOverwrites.edit(everyoneId, {
        SendMessages: false
      }, {
        reason: 'Cadenas — verrouillage manuel du serveur'
      });
      lockedIds.push(channel.id);
    } catch (e) {
      console.error(`Erreur verrouillage salon ${channel.id} :`, e.message);
    }
  }
  cfg.lockdown_active = true;
  cfg.lockdown_channel_ids = lockedIds;
  cfg.lockdown_previous_state = previousState;
  persist('configuration');
}
async function unlockAllChannels(guild) {
  const cfg = getGuildConfig(guild.id);
  const everyoneId = guild.roles.everyone.id;
  const previousState = cfg.lockdown_previous_state || {};
  for (const channelId of cfg.lockdown_channel_ids || []) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    try {
      const state = previousState[channelId] || 'neutral';
      if (state === 'neutral') {
        await channel.permissionOverwrites.edit(everyoneId, {
          SendMessages: null
        }, {
          reason: 'Cadenas — fin du verrouillage manuel'
        });
      } else {
        await channel.permissionOverwrites.edit(everyoneId, {
          SendMessages: state === 'allow'
        }, {
          reason: 'Cadenas — fin du verrouillage manuel'
        });
      }
    } catch (e) {
      console.error(`Erreur déverrouillage salon ${channelId} :`, e.message);
    }
  }
  cfg.lockdown_active = false;
  cfg.lockdown_channel_ids = [];
  cfg.lockdown_previous_state = {};
  persist('configuration');
}
async function toggleLockdown(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.deferUpdate();
  if (cfg.lockdown_active) {
    await unlockAllChannels(interaction.guild);
    const embed = new EmbedBuilder().setTitle('🔓 Serveur déverrouillé').setDescription(`${interaction.user} a levé le verrouillage manuel des salons.`).setColor(0x57F287).setTimestamp();
    await sendProtectionLog(interaction.guild, embed);
  } else {
    await lockAllChannels(interaction.guild);
    const embed = new EmbedBuilder().setTitle('🔒 Serveur verrouillé').setDescription(`${interaction.user} a verrouillé manuellement tous les salons textuels.`).setColor(0xff0000).setTimestamp();
    await sendProtectionLog(interaction.guild, embed);
  }
  return interaction.editReply({
    ...buildProtectPayload(interaction.guild)
  });
}

// ────────────────────────────────────────────────
// Authentification Manager (validation manuelle des nouveaux membres)
// ────────────────────────────────────────────────
async function assignAuthReview(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.auth_enabled || !cfg.auth_pending_role_id || !cfg.auth_review_channel_id) return;
  const role = member.guild.roles.cache.get(String(cfg.auth_pending_role_id));
  const channel = member.guild.channels.cache.get(String(cfg.auth_review_channel_id));
  if (!role || !channel?.isTextBased?.()) return;
  try {
    await member.roles.add(role, 'Authentification Manager — en attente de validation manuelle');
  } catch (e) {
    console.error('Erreur attribution rôle en attente (auth) :', e.message);
    return;
  }
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`protect_auth_accept_${member.guild.id}_${member.id}`).setLabel('✅ Accepter').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`protect_auth_refuse_${member.guild.id}_${member.id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`protect_auth_double_${member.guild.id}_${member.id}`).setLabel('⚠️ Compte double').setStyle(ButtonStyle.Danger));
  const embed = new EmbedBuilder().setTitle('🪪 Nouveau membre en attente de validation').setDescription(`${member} (\`${member.id}\`) a rejoint le serveur et attend une validation manuelle.`).setThumbnail(member.user.displayAvatarURL()).setColor(0xFFFFFF).setTimestamp();
  await channel.send(toCV2Payload({
    embeds: [embed],
    components: [row]
  })).catch(e => {
    console.error('Erreur envoi message revue Authentification Manager :', e?.message || e);
  });
}
async function resolveAuthReview(interaction, accepted) {
  const [, , , guildId, userId] = interaction.customId.split('_');
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) return interaction.reply({
    content: '❌ Serveur introuvable.',
    flags: MessageFlags.Ephemeral
  });
  const member = await guild.members.fetch(userId).catch(() => null);
  const cfg = getGuildConfig(guild.id);
  if (!member) {
    return interaction.update({
      content: '⚠️ Ce membre a déjà quitté le serveur.',
      embeds: [],
      components: []
    });
  }
  if (accepted) {
    const role = cfg.auth_pending_role_id ? guild.roles.cache.get(String(cfg.auth_pending_role_id)) : null;
    if (role) await member.roles.remove(role, `Authentification acceptée par ${interaction.user.tag}`).catch(() => { });
    await interaction.update({
      content: `✅ ${member} a été validé par ${interaction.user}.`,
      embeds: [],
      components: []
    });
  } else {
    await member.kick(`Authentification refusée par ${interaction.user.tag}`).catch(() => { });
    await interaction.update({
      content: `❌ ${member.user.tag} a été refusé et expulsé par ${interaction.user}.`,
      embeds: [],
      components: []
    });
  }
}
async function resolveAuthDouble(interaction) {
  const parts = interaction.customId.split('_');
  const guildId = parts[3];
  const userId = parts[4];
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) return interaction.reply({
    content: '❌ Serveur introuvable.',
    flags: MessageFlags.Ephemeral
  });
  const member = await guild.members.fetch(userId).catch(() => null);
  const cfg = getGuildConfig(guild.id);
  if (!member) {
    return interaction.update({
      content: '⚠️ Ce membre a déjà quitté le serveur.',
      embeds: [],
      components: []
    });
  }
  const reason = 'Compte double / Compromis — action prise par le staff via Auth Manager';
  try {
    await member.ban({
      reason
    });
  } catch (e) {
    console.error('Erreur ban compte double :', e.message);
    return interaction.reply({
      content: '❌ Impossible de bannir ce membre (permissions).',
      flags: MessageFlags.Ephemeral
    });
  }

  // journalise l'infraction
  try {
    await logInfraction(guild, {
      type: 'ban',
      target: member.user,
      moderator: interaction.user,
      reason
    });
  } catch (e) {
    console.error('Erreur journalisation compte double :', e.message);
  }
  return interaction.update({
    content: `⚠️ ${member.user.tag} a été banni pour compte double/compromis par ${interaction.user}.`,
    embeds: [],
    components: []
  });
}

// ────────────────────────────────────────────────
// Enregistrement des events
// ────────────────────────────────────────────────
function registerProtectionHandlers(client) {
  // Reprise des alertes Anti-DDoS en cours (le bot a pu redémarrer pendant une alerte)
  const resumeDdos = () => {
    try { rehydrateDdos(client); rehydrateDdosVoice(client); } catch (e) { console.error('Erreur reprise Anti-DDoS :', e.message); }
  };
  if (client.isReady?.()) resumeDdos(); else client.once('ready', resumeDdos);
  client.on('guildMemberAdd', async member => {
    try {
      if (member.user.bot) {
        await checkAntiBot(member); // expulse le bot si Anti-bot est activé
        return; // les bots ne passent pas par les autres vérifications (raid/âge/alt/tag/auth/captcha)
      }
      if (await checkRaidMode(member)) return; // membre déjà sanctionné par le raidmode
      if (await checkAccountAge(member)) return;
      if (await checkAntiAlt(member)) return;
      await checkTagRole(member);
      await assignAuthReview(member); // mis en attente si l'Authentification Manager est actif
      await assignCaptcha(member);
    } catch (e) {
      console.error('Erreur handler protection (guildMemberAdd) :', e);
    }
  });
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      await checkAntiDdosVoice(oldState, newState);
    } catch (e) {
      console.error('Erreur handler protection (voiceStateUpdate) :', e);
    }
  });
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      await checkTagRole(newMember);
    } catch (e) {
      console.error('Erreur handler protection (guildMemberUpdate) :', e);
    }
  });
  client.on('guildMemberRemove', member => {
    // Nettoie une vérification captcha en cours si le membre quitte le serveur
    clearCaptchaPending(`${member.guild.id}_${member.id}`);
  });
  client.on('messageCreate', async message => {
    try {
      if (!message.guild || message.author.id === message.client.user.id) return;
      if (message.author.bot) {
        // Les bots/webhooks (souvent utilisés pour spammer des liens/invitations)
        // ne passent pas par le captcha/honeypot/anti-spam, mais restent
        // vérifiés par l'Anti-lien (et comptés par l'Anti-DDoS pour les webhooks).
        if (message.webhookId) await checkAntiDdos(message);
        await checkAntiLink(message);
        return;
      }
      await checkAntiDdos(message); // compte le message (détection d'inondation distribuée)
      if (await handleCaptchaMessage(message)) return; // géré par le captcha
      if (await checkHoneypot(message)) return;
      if (await checkAntiEveryone(message)) return;
      if (await checkAntiLink(message)) return;
      await checkAntiSpam(message);
    } catch (e) {
      console.error('Erreur handler protection (messageCreate) :', e);
    }
  });
  client.on('messageDelete', async message => {
    try {
      if (!message.guild) return;
      if (require('../core/silentMessages').isMuted(message.id)) return;
      await checkGhostPing(message);
    } catch (e) {
      console.error('Erreur handler protection (messageDelete) :', e);
    }
  });
  client.on('channelDelete', async channel => {
    try {
      if (!channel.guild) return;
      const cfg = getGuildConfig(channel.guild.id);
      if (!cfg.anti_nuke_enabled) return;
      const executor = await findAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
      await recordNukeAction(channel.guild, executor, 'suppression de salon');
    } catch (e) {
      console.error('Erreur handler anti-nuke (channelDelete) :', e);
    }
  });
  client.on('roleDelete', async role => {
    try {
      const cfg = getGuildConfig(role.guild.id);
      if (!cfg.anti_nuke_enabled) return;
      const executor = await findAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
      await recordNukeAction(role.guild, executor, 'suppression de rôle');
    } catch (e) {
      console.error('Erreur handler anti-nuke (roleDelete) :', e);
    }
  });
  client.on('guildBanAdd', async ban => {
    try {
      const cfg = getGuildConfig(ban.guild.id);
      if (!cfg.anti_nuke_enabled) return;
      const executor = await findAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      await recordNukeAction(ban.guild, executor, 'bannissement de membre');
    } catch (e) {
      console.error('Erreur handler anti-nuke (guildBanAdd) :', e);
    }
  });
  console.log('✅ Système de protection (RaidMode / Captcha / Anti-spam / Anti-bot / Anti-alt / Anti-lien / Anti-Nuke / Anti-Ghostping / Anti-DDoS / Rôle de tag) initialisé.');
}

const { buildProtectPayload, TOGGLE_KEYS, buildConfigImage, nameOf } = require('../core/protectCard');

// ────────────────────────────────────────────────
// Dashboard /protect-settings
// ────────────────────────────────────────────────
function buildProtectDashboard(guild) {
  const cfg = getGuildConfig(guild.id);
  const dot = v => v ? '🟢' : '🔴';
  const line = (...items) => items.map(([label, active]) => `${dot(active)} ${label}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 128 }) || undefined })
    .setTitle('🛡️ Panneau de protection')
    .setDescription('Clique sur un bouton ci-dessous pour ouvrir sa configuration.')
    .setThumbnail(guild.iconURL({ size: 256 }) || null)
    .addFields(
      {
        name: '🚨 Anti-Raid & Accès',
        value: line(
          ['RaidMode', cfg.raidmode_enabled],
          ['Captcha', cfg.captcha_enabled],
          ['Âge minimum', !!cfg.min_account_age_days],
          ['Anti-bot', cfg.anti_bot_enabled],
          ['Anti-alt', cfg.anti_alt_enabled]
        ),
        inline: true
      }, {
      name: '🧹 Anti-Abus',
      value: line(
        ['Anti-spam', cfg.antispam],
        ['Anti-@everyone', cfg.antieveryone],
        ['Anti-lien', cfg.anti_link_enabled],
        ['Anti-Nuke', cfg.anti_nuke_enabled],
        ['Anti-Ghostping', cfg.anti_ghostping_enabled],
        ['Anti-phishing', cfg.anti_phishing],
        ['Anti-arnaque (OCR)', cfg.anti_scam_image]
      ),
      inline: true
    }, {
      name: '🗂️ Modération & Suivi',
      value: line(
        ['Logs', !!getProtectionLogChannelId(cfg)],
        ['Signalements', cfg.signalement_enabled],
        ['Sanctions', !!cfg.infraction_channel_id],
        ['Transparence', cfg.transparence_enabled],
        ['Rôle de Tag', cfg.tag_role_enabled]
      ),
      inline: true
    }, {
      name: '🔐 Accès serveur',
      value: line(
        ['Authentification', cfg.auth_enabled],
        ['Fermeture des MP', cfg.dm_lock_enabled],
        ['Cadenas', !cfg.lockdown_active],
        ['HoneyPot', cfg.honeypot_enabled]
      ),
      inline: true
    }
    )
    .setFooter({
      text: 'CoreLab • Protection',
      iconURL: guild.client?.user?.displayAvatarURL?.() || undefined
    });
  return embed;
}
function buildProtectRows(guild) {
  const cfg = getGuildConfig(guild.id);
  const simpleActive = Boolean(cfg.antispam && cfg.antieveryone && (cfg.raidmode_enabled || cfg.captcha_enabled));
  // Boutons regroupés par catégorie, dans le même ordre que les champs de l'embed.
  // Discord limite à 5 ActionRow de 5 boutons max (25 au total).
  const row0 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_raidmode_btn').setLabel('🚨 RaidMode').setStyle(cfg.raidmode_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_captcha_btn').setLabel('🔒 Captcha').setStyle(cfg.captcha_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_minage_btn').setLabel('⏳ Âge minimum').setStyle(cfg.min_account_age_days ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antibot_btn').setLabel('🤖 Anti-bot').setStyle(cfg.anti_bot_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antialt_btn').setLabel('👤 Anti-alt').setStyle(cfg.anti_alt_enabled ? ButtonStyle.Success : ButtonStyle.Secondary));
  const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_antispam_btn').setLabel('🚫 Anti-spam').setStyle(cfg.antispam ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antieveryone_btn').setLabel('🔕 Anti-@everyone').setStyle(cfg.antieveryone ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antilink_btn').setLabel('🔗 Anti-lien').setStyle(cfg.anti_link_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antinuke_btn').setLabel('💣 Anti-Nuke').setStyle(cfg.anti_nuke_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antighostping_btn').setLabel('👻 Anti-Ghostping').setStyle(cfg.anti_ghostping_enabled ? ButtonStyle.Success : ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_antiphishing_btn').setLabel('🎣 Anti-phishing').setStyle(cfg.anti_phishing ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_antiscamimage_btn').setLabel('🖼️ Anti-arnaque (OCR)').setStyle(cfg.anti_scam_image ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_logs_btn').setLabel('📋 Logs').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_signalement_btn').setLabel('🚩 Signalements').setStyle(cfg.signalement_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_sanctions_btn').setLabel('⚠️ Sanctions').setStyle(cfg.infraction_channel_id ? ButtonStyle.Success : ButtonStyle.Secondary));
  const row3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_transparence_btn').setLabel('📖 Transparence').setStyle(cfg.transparence_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_tagrole_btn').setLabel('🏷️ Rôle de Tag').setStyle(cfg.tag_role_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_auth_btn').setLabel('🪪 Authentification').setStyle(cfg.auth_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_dmlock_btn').setLabel('📪 Fermeture des MP').setStyle(cfg.dm_lock_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_lockdown_btn').setLabel('🔒 Cadenas').setStyle(cfg.lockdown_active ? ButtonStyle.Danger : ButtonStyle.Primary));
  const row4 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_honeypot_btn').setLabel('🍯 HoneyPot').setStyle(cfg.honeypot_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_honeypot_reset_btn').setLabel('🔄 Reset HoneyPot').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_mark_double_btn').setLabel('⚠️ Compte double').setStyle(cfg.auth_double_detection_enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('protect_simple_btn').setLabel('🛡️ Mode Simple').setStyle(simpleActive ? ButtonStyle.Success : ButtonStyle.Secondary));
  return [row0, row1, row2, row3, row4];
}
async function openMarkDoubleModal(interaction) {
  const modal = new ModalBuilder().setCustomId('protect_mark_double_modal').setTitle('⚠️ Marquer compte double / bannir');
  const idInput = new TextInputBuilder().setCustomId('double_user_id').setLabel('ID du membre').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32);
  const reasonInput = new TextInputBuilder().setCustomId('double_reason').setLabel('Raison (optionnel)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(idInput), new ActionRowBuilder().addComponents(reasonInput));
  return interaction.showModal(modal);
}
async function submitMarkDoubleModal(interaction) {
  const guild = interaction.guild;
  const cfg = getGuildConfig(guild.id);
  const userId = interaction.fields.getTextInputValue('double_user_id').trim();
  const reason = interaction.fields.getTextInputValue('double_reason').trim() || 'Compte double/compromis (signalé via panneau)';
  if (!/^[0-9]{16,20}$/.test(userId)) {
    return interaction.reply({
      content: '❌ ID invalide.',
      flags: MessageFlags.Ephemeral
    });
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return interaction.reply({
    content: '❌ Membre introuvable sur ce serveur.',
    flags: MessageFlags.Ephemeral
  });
  try {
    await member.ban({
      reason
    });
  } catch (e) {
    console.error('Erreur ban via mark double :', e.message);
    return interaction.reply({
      content: '❌ Impossible de bannir ce membre (permissions).',
      flags: MessageFlags.Ephemeral
    });
  }
  try {
    await logInfraction(guild, {
      type: 'ban',
      target: member.user,
      moderator: interaction.user,
      reason
    });
  } catch (e) {
    console.error('Erreur journalisation mark double :', e.message);
  }
  return interaction.reply({
    content: `✅ ${member.user.tag} banni et journalisé.`,
    flags: MessageFlags.Ephemeral
  });
}
async function toggleMarkDoubleDetection(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.auth_double_detection_enabled = !cfg.auth_double_detection_enabled;
  persist('configuration');
  const status = cfg.auth_double_detection_enabled ? '🟢 Activée' : '🔴 Désactivée';
  return interaction.update({
    ...buildProtectPayload(interaction.guild, `⚠️ Détection compte double ${status}.`)
  });
}
async function handleSimpleProtectToggle(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  // Considère le mode simple actif si plusieurs protections de base sont activées
  const simpleActive = Boolean(cfg.antispam && cfg.antieveryone && (cfg.raidmode_enabled || cfg.captcha_enabled));
  if (simpleActive) {
    // Désactive les protections basiques
    cfg.antispam = false;
    cfg.antieveryone = false;
    cfg.raidmode_enabled = false;
    cfg.captcha_enabled = false;
    cfg.min_account_age_days = 0;
    cfg.tag_role_enabled = false;
    cfg.honeypot_enabled = false;
    cfg.anti_ddos_enabled = false;
    cfg.anti_ddos_voice_enabled = false;
    persist('configuration');
    return interaction.update({
      ...buildProtectPayload(interaction.guild, '🔴 Mode Simple désactivé : protections basiques désactivées.')
    });
  }

  // Active un ensemble de protections basiques avec des valeurs par défaut
  cfg.antispam = true;
  cfg.antieveryone = true;
  cfg.raidmode_enabled = true;
  cfg.raidmode_threshold = cfg.raidmode_threshold || 8;
  cfg.raidmode_window_seconds = cfg.raidmode_window_seconds || 20;
  cfg.raidmode_action = cfg.raidmode_action || 'kick';
  cfg.raidmode_duration_minutes = cfg.raidmode_duration_minutes || 15;
  cfg.min_account_age_days = cfg.min_account_age_days || 3;
  cfg.anti_ddos_enabled = true;
  cfg.anti_ddos_voice_enabled = true;
  // Ne pas activer automatiquement le captcha ni le honeypot sans configuration (rôle/salon)
  cfg.captcha_enabled = cfg.captcha_role_id ? true : false;
  cfg.honeypot_enabled = cfg.honeypot_channel_id ? true : false;
  persist('configuration');
  return interaction.update({
    ...buildProtectPayload(interaction.guild, '🟢 Mode Simple activé : protections basiques appliquées (tu peux affiner ensuite).')
  });
}
async function refreshDashboard(interaction) {
  return interaction.update({
    ...buildProtectPayload(interaction.guild)
  });
}
async function toggleAndRefresh(interaction, field) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg[field] = !cfg[field];
  persist('configuration');
  return refreshDashboard(interaction);
}

// Réinitialise le compteur de sanctions du HoneyPot (sans désactiver ni recréer le salon)
async function resetHoneypotSanctions(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.honeypot_sanctions_count = 0;
  persist('configuration');
  await refreshHoneypotMessage(interaction.guild, cfg);
  await refreshDashboard(interaction);
  return interaction.followUp({
    content: '✅ Compteur de sanctions HoneyPot réinitialisé.',
    flags: MessageFlags.Ephemeral
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Panneaux de réglage de /protect-settings : carte image (canvas) + composants, en Components V2
// ─────────────────────────────────────────────────────────────────────────
const ACTION_LABELS = {
  kick: 'Expulsion', ban: 'Bannissement', timeout: 'Timeout', mute: 'Mute permanent',
  warn: 'Avertissement', lockdown: 'Verrouillage'
};
function rowOf(...components) {
  return new ActionRowBuilder().addComponents(...components);
}
function backRow() {
  return new ActionRowBuilder().addComponents(backButton());
}
function backButton() {
  return new ButtonBuilder().setCustomId('protect_back').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary);
}
// Ajoute le bouton Retour à la dernière rangée si elle ne contient que des boutons (et reste sous 5), sinon dans une nouvelle rangée
function withBackRow(rows) {
  const out = [...rows];
  const last = out[out.length - 1];
  const comps = last?.components || [];
  if (comps.length > 0 && comps.length < 5 && comps.every(c => c instanceof ButtonBuilder)) last.addComponents(backButton());
  else out.push(rowOf(backButton()));
  return out;
}
// card = AttachmentBuilder (config.png), rows = ActionRowBuilder[]
function cfgPanel({ title, intro, notice, card, rows }) {
  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 500)));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://config.png')));
  if (intro) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(intro));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(...withBackRow(rows));
  // `attachments: []` retire l'ancienne image lors d'un interaction.update()
  return { components: [container], files: [card], attachments: [], flags: MessageFlags.IsComponentsV2 };
}
// Réponse d'un panneau : met à jour le message d'origine (bouton, menu ou modal ouvert depuis le panneau), sinon répond en éphémère
function sendPanel(interaction, payload) {
  const fromPanel = interaction.isMessageComponent?.() || (interaction.isModalSubmit?.() && interaction.isFromMessage?.());
  if (fromPanel) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
}

function buildRaidmodePanel(guild, cfg, notice = null) {
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'RaidMode', subtitle: `Protection anti-raid automatique — ${guild.name}`, icon: 'bolt', enabled: !!cfg.raidmode_enabled,
    tiles: [
      { label: 'Seuil', value: `${cfg.raidmode_threshold || 10} arrivées`, set: true },
      { label: 'Fenêtre', value: `${cfg.raidmode_window_seconds || 30} s`, set: true },
      { label: 'Action', value: ACTION_LABELS[cfg.raidmode_action] || '—', set: !!cfg.raidmode_action },
      { label: 'Durée du lockdown', value: `${cfg.raidmode_duration_minutes || 15} min`, set: true }
    ]
  });
  return cfgPanel({
    title: '🚨 Configuration du RaidMode',
    intro: 'Quand trop de membres rejoignent en peu de temps, le serveur applique l\'action choisie pendant la durée du lockdown.\n-# Le bouton « Modifier » ouvre le formulaire de réglage.',
    notice, card,
    rows: [rowOf(
      new ButtonBuilder().setCustomId('protect_raidmode_edit').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('protect_raidmode_disable').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger)
    )]
  });
}
function buildMinAgePanel(guild, cfg, notice = null) {
  const d = Number(cfg.min_account_age_days) || 0;
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Âge minimum', subtitle: `Filtre des comptes trop récents — ${guild.name}`, icon: 'clock', enabled: d > 0,
    tiles: [
      { label: 'Âge minimum du compte', value: d > 0 ? `${d} jour(s)` : 'désactivé', set: d > 0 },
      { label: 'Action', value: 'Expulsion automatique', set: d > 0 }
    ]
  });
  return cfgPanel({
    title: '⏳ Âge minimum du compte',
    intro: 'Les comptes plus récents que la limite sont expulsés automatiquement à leur arrivée.\n-# Le bouton « Modifier » ouvre le formulaire de réglage.',
    notice, card,
    rows: [rowOf(
      new ButtonBuilder().setCustomId('protect_minage_edit').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('protect_minage_disable').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger)
    )]
  });
}
async function openRaidmodePanel(interaction) {
  return sendPanel(interaction, buildRaidmodePanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function openMinAgePanel(interaction) {
  return sendPanel(interaction, buildMinAgePanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}

// ── Auto RaidMode : modal de configuration ──
function buildRaidmodeModal(cfg) {
  const modal = new ModalBuilder().setCustomId('protect_raidmode_modal').setTitle('🚨 Auto RaidMode');
  const seuilInput = new TextInputBuilder().setCustomId('seuil').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(cfg.raidmode_threshold ?? 10));
  const seuilLabel = new LabelBuilder().setLabel('Nombre d\'arrivées déclenchant le mode').setTextInputComponent(seuilInput);
  const fenetreInput = new TextInputBuilder().setCustomId('fenetre').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(cfg.raidmode_window_seconds ?? 30));
  const fenetreLabel = new LabelBuilder().setLabel('Fenêtre de temps (secondes)').setTextInputComponent(fenetreInput);
  const dureeInput = new TextInputBuilder().setCustomId('duree').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(cfg.raidmode_duration_minutes ?? 15));
  const dureeLabel = new LabelBuilder().setLabel('Durée du lockdown (minutes)').setTextInputComponent(dureeInput);
  const actionSelect = new StringSelectMenuBuilder().setCustomId('action').setRequired(true).setMinValues(1).setMaxValues(1).addOptions(new StringSelectMenuOptionBuilder().setLabel('Expulser les nouveaux arrivants').setEmoji('👢').setValue('kick').setDefault(cfg.raidmode_action === 'kick'), new StringSelectMenuOptionBuilder().setLabel('Bannir les nouveaux arrivants').setEmoji('🔨').setValue('ban').setDefault(cfg.raidmode_action === 'ban'), new StringSelectMenuOptionBuilder().setLabel('Verrouiller le serveur (vérif. max)').setEmoji('🔒').setValue('lockdown').setDefault(cfg.raidmode_action === 'lockdown'), new StringSelectMenuOptionBuilder().setLabel('Désactiver le Auto RaidMode').setEmoji('🔴').setValue('off').setDefault(false));
  const actionLabel = new LabelBuilder().setLabel('Action').setDescription('Que faire pendant la vague détectée ? (ou désactiver)').setStringSelectMenuComponent(actionSelect);
  modal.addLabelComponents(seuilLabel, fenetreLabel, dureeLabel, actionLabel);
  return modal;
}
async function openRaidmodeModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  return interaction.showModal(buildRaidmodeModal(cfg));
}
async function submitRaidmodeModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const seuil = parseInt(interaction.fields.getTextInputValue('seuil'), 10);
  const fenetre = parseInt(interaction.fields.getTextInputValue('fenetre'), 10);
  const duree = parseInt(interaction.fields.getTextInputValue('duree'), 10);
  let action;
  try {
    action = interaction.fields.getStringSelectValues('action')[0];
  } catch {
    action = undefined;
  }
  if (action === 'off') {
    cfg.raidmode_enabled = false;
    persist('configuration');
    return sendPanel(interaction, buildRaidmodePanel(interaction.guild, cfg, '🔴 Auto RaidMode désactivé.'));
  }
  if (!Number.isFinite(seuil) || seuil < 2) return interaction.reply({
    content: '❌ Le nombre d\'arrivées doit être un nombre ≥ 2.',
    flags: MessageFlags.Ephemeral
  });
  if (!Number.isFinite(fenetre) || fenetre < 5) return interaction.reply({
    content: '❌ La fenêtre doit être un nombre de secondes ≥ 5.',
    flags: MessageFlags.Ephemeral
  });
  if (!Number.isFinite(duree) || duree < 1) return interaction.reply({
    content: '❌ La durée doit être un nombre de minutes ≥ 1.',
    flags: MessageFlags.Ephemeral
  });
  cfg.raidmode_threshold = seuil;
  cfg.raidmode_window_seconds = fenetre;
  cfg.raidmode_duration_minutes = duree;
  if (action) cfg.raidmode_action = action;
  cfg.raidmode_enabled = true;
  persist('configuration');
  return sendPanel(interaction, buildRaidmodePanel(interaction.guild, cfg, '✅ Auto RaidMode configuré et activé.'));
}

// ── Âge minimum : modal ──
async function openMinAgeModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId('protect_minage_modal').setTitle('⏳ Âge minimum du compte');
  const input = new TextInputBuilder().setCustomId('jours').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(cfg.min_account_age_days ?? 0));
  const label = new LabelBuilder().setLabel('Âge minimum en jours (0 = désactivé)').setTextInputComponent(input);
  modal.addLabelComponents(label);
  return interaction.showModal(modal);
}
async function submitMinAgeModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const jours = parseInt(interaction.fields.getTextInputValue('jours'), 10);
  if (!Number.isFinite(jours) || jours < 0) {
    return interaction.reply({
      content: '❌ Indique un nombre de jours valide (0 pour désactiver).',
      flags: MessageFlags.Ephemeral
    });
  }
  cfg.min_account_age_days = jours;
  persist('configuration');
  return sendPanel(interaction, buildMinAgePanel(interaction.guild, cfg, jours > 0 ? `✅ Âge minimum fixé à **${jours} jour(s)**.` : '✅ Âge minimum désactivé.'));
}

// ── Anti-DDoS : panneau + modal ──
const DDOS_ACTION_LABELS = { slowmode: 'Slowmode', lockdown: 'Verrouillage', timeout: 'Timeout' };
function buildDdosPanel(guild, cfg, notice = null) {
  const s = ddosSettings(cfg);
  const active = isDdosActive(cfg);
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Anti-DDoS', subtitle: `Protection contre les inondations de messages — ${guild.name}`, icon: 'hex', enabled: !!cfg.anti_ddos_enabled,
    tiles: [
      { label: 'Seuil', value: `${s.threshold} messages`, set: true },
      { label: 'Fenêtre', value: `${s.windowMs / 1000} s`, set: true },
      { label: 'Auteurs min.', value: `${s.minUsers}`, set: true },
      { label: 'Action', value: DDOS_ACTION_LABELS[s.action], set: true }
    ],
    stats: [
      { label: 'Durée de l\'alerte', value: `${s.durationMs / 60000} min` },
      { label: 'Slowmode appliqué', value: `${DDOS_SLOWMODE_SECONDS} s` },
      { label: 'État', value: active ? 'EN COURS' : 'Aucune alerte' }
    ]
  });
  return cfgPanel({
    title: '🌊 Configuration de l\'Anti-DDoS',
    intro: 'Détecte une inondation de messages venant de nombreux comptes/webhooks à la fois (≠ Anti-spam, qui vise un seul membre). Pendant l\'alerte : slowmode sur les salons touchés, puis verrouillage du serveur ou timeout des auteurs les plus actifs selon l\'action choisie. Tout est remis à la normale à la fin.\n-# Le staff (Gérer les messages) n\'est jamais compté ni sanctionné. Permissions du bot : Gérer les salons (+ Gérer le serveur pour le verrouillage, Modérer les membres pour le timeout).',
    notice, card,
    rows: [rowOf(
      new ButtonBuilder().setCustomId('protect_ddos_edit').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('protect_ddos_toggle').setLabel(cfg.anti_ddos_enabled ? 'Désactiver' : 'Activer').setEmoji(cfg.anti_ddos_enabled ? '🔴' : '🟢').setStyle(cfg.anti_ddos_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('protect_ddos_clear').setLabel('Lever l\'alerte').setEmoji('🧯').setStyle(ButtonStyle.Secondary).setDisabled(!active)
    )]
  });
}
async function openDdosPanel(interaction) {
  return sendPanel(interaction, buildDdosPanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
function buildDdosModal(cfg) {
  const s = ddosSettings(cfg);
  const modal = new ModalBuilder().setCustomId('protect_ddos_modal').setTitle('🌊 Anti-DDoS');
  const seuilInput = new TextInputBuilder().setCustomId('seuil').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(s.threshold));
  const seuilLabel = new LabelBuilder().setLabel('Messages (total) déclenchant l\'alerte').setTextInputComponent(seuilInput);
  const fenetreInput = new TextInputBuilder().setCustomId('fenetre').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(s.windowMs / 1000));
  const fenetreLabel = new LabelBuilder().setLabel('Fenêtre de temps (secondes)').setTextInputComponent(fenetreInput);
  const auteursInput = new TextInputBuilder().setCustomId('auteurs').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(s.minUsers));
  const auteursLabel = new LabelBuilder().setLabel('Auteurs différents minimum').setTextInputComponent(auteursInput);
  const dureeInput = new TextInputBuilder().setCustomId('duree').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(s.durationMs / 60000));
  const dureeLabel = new LabelBuilder().setLabel('Durée de l\'alerte (minutes)').setTextInputComponent(dureeInput);
  const actionSelect = new StringSelectMenuBuilder().setCustomId('action').setRequired(true).setMinValues(1).setMaxValues(1).addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Slowmode des salons inondés').setEmoji('🐌').setValue('slowmode').setDefault(s.action === 'slowmode'),
    new StringSelectMenuOptionBuilder().setLabel('Slowmode + verrouiller le serveur').setEmoji('🔒').setValue('lockdown').setDefault(s.action === 'lockdown'),
    new StringSelectMenuOptionBuilder().setLabel('Slowmode + timeout des auteurs actifs').setEmoji('⏳').setValue('timeout').setDefault(s.action === 'timeout'),
    new StringSelectMenuOptionBuilder().setLabel('Désactiver l\'Anti-DDoS').setEmoji('🔴').setValue('off').setDefault(false)
  );
  const actionLabel = new LabelBuilder().setLabel('Action').setDescription('Que faire pendant l\'alerte ? (ou désactiver)').setStringSelectMenuComponent(actionSelect);
  modal.addLabelComponents(seuilLabel, fenetreLabel, auteursLabel, dureeLabel, actionLabel);
  return modal;
}
async function openDdosModal(interaction) {
  return interaction.showModal(buildDdosModal(getGuildConfig(interaction.guild.id)));
}
// Désactivation / levée d'alerte : plusieurs appels API → on accuse réception d'abord (limite des 3 s de Discord)
async function endDdosFromPanel(interaction, notice, { disable = false } = {}) {
  const cfg = getGuildConfig(interaction.guild.id);
  if (disable) cfg.anti_ddos_enabled = false;
  persist('configuration');
  await interaction.deferUpdate();
  await endDdos(interaction.guild, 'manual').catch(e => console.error('Erreur fin Anti-DDoS :', e));
  return interaction.editReply(buildDdosPanel(interaction.guild, cfg, notice));
}
async function submitDdosModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  let action;
  try {
    action = interaction.fields.getStringSelectValues('action')[0];
  } catch {
    action = undefined;
  }
  if (action === 'off') return endDdosFromPanel(interaction, '🔴 Anti-DDoS désactivé.', { disable: true });
  const seuil = parseInt(interaction.fields.getTextInputValue('seuil'), 10);
  const fenetre = parseInt(interaction.fields.getTextInputValue('fenetre'), 10);
  const auteurs = parseInt(interaction.fields.getTextInputValue('auteurs'), 10);
  const duree = parseInt(interaction.fields.getTextInputValue('duree'), 10);
  const fail = msg => interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  if (!Number.isFinite(seuil) || seuil < 5 || seuil > 1000) return fail('❌ Le seuil de messages doit être compris entre 5 et 1000.');
  if (!Number.isFinite(fenetre) || fenetre < 3 || fenetre > 120) return fail('❌ La fenêtre doit être comprise entre 3 et 120 secondes.');
  if (!Number.isFinite(auteurs) || auteurs < 2 || auteurs > seuil) return fail('❌ Le nombre d\'auteurs doit être ≥ 2 et ne pas dépasser le seuil de messages.');
  if (!Number.isFinite(duree) || duree < 1 || duree > 1440) return fail('❌ La durée doit être comprise entre 1 et 1440 minutes.');
  cfg.anti_ddos_threshold = seuil;
  cfg.anti_ddos_window_seconds = fenetre;
  cfg.anti_ddos_min_users = auteurs;
  cfg.anti_ddos_duration_minutes = duree;
  if (DDOS_ACTIONS.includes(action)) cfg.anti_ddos_action = action;
  cfg.anti_ddos_enabled = true;
  persist('configuration');
  return sendPanel(interaction, buildDdosPanel(interaction.guild, cfg, '✅ Anti-DDoS configuré et activé.'));
}

// ── Anti-DDoS vocal : panneau + modal ──
const DDOS_VOICE_ACTION_LABELS = { lock: 'Verrouillage', disconnect: 'Verrou + déco' };
function buildDdosVoicePanel(guild, cfg, notice = null) {
  const s = ddosVoiceSettings(cfg);
  const active = isDdosVoiceActive(cfg);
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Anti-DDoS vocal', subtitle: `Protection contre les raids en salon vocal — ${guild.name}`, icon: 'hex', enabled: !!cfg.anti_ddos_voice_enabled,
    tiles: [
      { label: 'Seuil', value: `${s.threshold} connexions`, set: true },
      { label: 'Fenêtre', value: `${s.windowMs / 1000} s`, set: true },
      { label: 'Comptes min.', value: `${s.minUsers}`, set: true },
      { label: 'Action', value: DDOS_VOICE_ACTION_LABELS[s.action], set: true }
    ],
    stats: [
      { label: 'Durée de l\'alerte', value: `${s.durationMs / 60000} min` },
      { label: 'Saute-salon', value: `${DDOS_VOICE_HOP_MAX} en ${DDOS_VOICE_HOP_WINDOW_MS / 1000} s` },
      { label: 'État', value: active ? 'EN COURS' : 'Aucune alerte' }
    ]
  });
  return cfgPanel({
    title: '🔊 Configuration de l\'Anti-DDoS vocal',
    intro: 'Détecte une vague de connexions en vocal venant de nombreux comptes à la fois : les salons touchés sont verrouillés (plus de connexion pour @everyone) pendant l\'alerte, et selon l\'action les arrivants sont déconnectés. Un membre qui saute de salon en boucle est aussi déconnecté puis mis en timeout 5 min. Tout est remis à la normale à la fin.\n-# Les membres avec Déplacer des membres / Gérer les salons ne sont jamais comptés ni sanctionnés. Permissions du bot : Gérer les salons, Déplacer des membres (+ Modérer les membres pour le timeout).',
    notice, card,
    rows: [rowOf(
      new ButtonBuilder().setCustomId('protect_ddosv_edit').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('protect_ddosv_toggle').setLabel(cfg.anti_ddos_voice_enabled ? 'Désactiver' : 'Activer').setEmoji(cfg.anti_ddos_voice_enabled ? '🔴' : '🟢').setStyle(cfg.anti_ddos_voice_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('protect_ddosv_clear').setLabel('Lever l\'alerte').setEmoji('🧯').setStyle(ButtonStyle.Secondary).setDisabled(!active)
    )]
  });
}
async function openDdosVoicePanel(interaction) {
  return sendPanel(interaction, buildDdosVoicePanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
function buildDdosVoiceModal(cfg) {
  const s = ddosVoiceSettings(cfg);
  const modal = new ModalBuilder().setCustomId('protect_ddosv_modal').setTitle('🔊 Anti-DDoS vocal');
  const mk = (id, label, max, value) => new LabelBuilder().setLabel(label).setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setValue(String(value)));
  const actionSelect = new StringSelectMenuBuilder().setCustomId('action').setRequired(true).setMinValues(1).setMaxValues(1).addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Verrouiller les salons touchés').setEmoji('🔒').setValue('lock').setDefault(s.action === 'lock'),
    new StringSelectMenuOptionBuilder().setLabel('Verrouiller + déconnecter les arrivants').setEmoji('🚪').setValue('disconnect').setDefault(s.action === 'disconnect'),
    new StringSelectMenuOptionBuilder().setLabel('Désactiver l\'Anti-DDoS vocal').setEmoji('🔴').setValue('off').setDefault(false)
  );
  const actionLabel = new LabelBuilder().setLabel('Action').setDescription('Que faire pendant l\'alerte ? (ou désactiver)').setStringSelectMenuComponent(actionSelect);
  modal.addLabelComponents(
    mk('seuil', 'Connexions vocales déclenchant l\'alerte', 4, s.threshold),
    mk('fenetre', 'Fenêtre de temps (secondes)', 3, s.windowMs / 1000),
    mk('comptes', 'Comptes différents minimum', 3, s.minUsers),
    mk('duree', 'Durée de l\'alerte (minutes)', 4, s.durationMs / 60000),
    actionLabel
  );
  return modal;
}
async function openDdosVoiceModal(interaction) {
  return interaction.showModal(buildDdosVoiceModal(getGuildConfig(interaction.guild.id)));
}
async function endDdosVoiceFromPanel(interaction, notice, { disable = false } = {}) {
  const cfg = getGuildConfig(interaction.guild.id);
  if (disable) cfg.anti_ddos_voice_enabled = false;
  persist('configuration');
  await interaction.deferUpdate();
  await endDdosVoice(interaction.guild, 'manual').catch(e => console.error('Erreur fin Anti-DDoS vocal :', e));
  return interaction.editReply(buildDdosVoicePanel(interaction.guild, cfg, notice));
}
async function submitDdosVoiceModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  let action;
  try {
    action = interaction.fields.getStringSelectValues('action')[0];
  } catch {
    action = undefined;
  }
  if (action === 'off') return endDdosVoiceFromPanel(interaction, '🔴 Anti-DDoS vocal désactivé.', { disable: true });
  const seuil = parseInt(interaction.fields.getTextInputValue('seuil'), 10);
  const fenetre = parseInt(interaction.fields.getTextInputValue('fenetre'), 10);
  const comptes = parseInt(interaction.fields.getTextInputValue('comptes'), 10);
  const duree = parseInt(interaction.fields.getTextInputValue('duree'), 10);
  const fail = msg => interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  if (!Number.isFinite(seuil) || seuil < 4 || seuil > 500) return fail('❌ Le seuil de connexions doit être compris entre 4 et 500.');
  if (!Number.isFinite(fenetre) || fenetre < 3 || fenetre > 120) return fail('❌ La fenêtre doit être comprise entre 3 et 120 secondes.');
  if (!Number.isFinite(comptes) || comptes < 2 || comptes > seuil) return fail('❌ Le nombre de comptes doit être ≥ 2 et ne pas dépasser le seuil de connexions.');
  if (!Number.isFinite(duree) || duree < 1 || duree > 1440) return fail('❌ La durée doit être comprise entre 1 et 1440 minutes.');
  cfg.anti_ddos_voice_threshold = seuil;
  cfg.anti_ddos_voice_window_seconds = fenetre;
  cfg.anti_ddos_voice_min_users = comptes;
  cfg.anti_ddos_voice_duration_minutes = duree;
  if (DDOS_VOICE_ACTIONS.includes(action)) cfg.anti_ddos_voice_action = action;
  cfg.anti_ddos_voice_enabled = true;
  persist('configuration');
  return sendPanel(interaction, buildDdosVoicePanel(interaction.guild, cfg, '✅ Anti-DDoS vocal configuré et activé.'));
}

// ── Captcha : sélection du rôle "non vérifié", du salon de vérification et du rôle "vérifié" (optionnel) ──
function maybeEnableCaptcha(cfg) {
  cfg.captcha_enabled = Boolean(cfg.captcha_role_id && cfg.captcha_channel_id);
}
function buildCaptchaConfigView(cfg, guild, notice = null) {
  const roleSelect = new RoleSelectMenuBuilder().setCustomId('protect_captcha_role_select').setPlaceholder('Rôle "non vérifié" (accès restreint)').setMinValues(1).setMaxValues(1);
  const channelSelect = new ChannelSelectMenuBuilder().setCustomId('protect_captcha_channel_select').setPlaceholder('Salon où taper le code (existant)').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  const verifiedRoleSelect = new RoleSelectMenuBuilder().setCustomId('protect_captcha_verified_role_select').setPlaceholder('Rôle "vérifié" à donner (optionnel)').setMinValues(1).setMaxValues(1);
  const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_captcha_create_channel').setLabel('➕ Créer le salon').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('protect_captcha_disable').setLabel('🔴 Désactiver le captcha').setStyle(ButtonStyle.Danger), backButton());

  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🔒 Configuration du Captcha'));
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 500)));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://captcha.png')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Un code à taper est envoyé dans le salon choisi à chaque arrivée. En attendant, le membre reçoit le rôle "non vérifié" (qui doit restreindre l'accès via les permissions).\n-# Le bouton ➕ Créer le salon crée automatiquement un salon dans la même catégorie que le HoneyPot.`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(verifiedRoleSelect), actionRow);

  // Components V2 : pas de `content` ; l'image est jointe et `attachments: []` retire l'ancienne lors d'un update()
  return {
    components: [container],
    files: [require('../core/protectCard').buildCaptchaImage(guild, cfg)],
    attachments: [],
    flags: MessageFlags.IsComponentsV2
  };
}
async function openCaptchaConfig(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  return sendPanel(interaction, buildCaptchaConfigView(cfg, interaction.guild));
}

// Crée automatiquement le salon captcha dans la même catégorie que le HoneyPot ("🛡️ CoreLab Protect")
async function createCaptchaChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.deferUpdate();
  try {
    const category = await getOrCreateProtectCategory(interaction.guild, cfg, `Salon Captcha configuré par ${interaction.user.tag}`);
    const channel = await interaction.guild.channels.create({
      name: '🔐・vérification',
      type: ChannelType.GuildText,
      parent: category.id,
      reason: `Salon Captcha configuré par ${interaction.user.tag}`
    });
    cfg.captcha_channel_id = channel.id;
    maybeEnableCaptcha(cfg);
    persist('configuration');
  } catch (e) {
    console.error('Erreur création salon Captcha :', e.message);
    return interaction.editReply(buildCaptchaConfigView(cfg, interaction.guild, '❌ Impossible de créer le salon Captcha (vérifie mes permissions "Gérer les salons").'));
  }
  return interaction.editReply(buildCaptchaConfigView(cfg, interaction.guild));
}
async function saveCaptchaRole(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.captcha_role_id = interaction.values[0];
  maybeEnableCaptcha(cfg);
  persist('configuration');
  return interaction.update(buildCaptchaConfigView(cfg, interaction.guild));
}
async function saveCaptchaChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.captcha_channel_id = interaction.values[0];
  maybeEnableCaptcha(cfg);
  persist('configuration');
  return interaction.update(buildCaptchaConfigView(cfg, interaction.guild));
}
async function saveCaptchaVerifiedRole(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.captcha_verified_role_id = interaction.values[0];
  persist('configuration');
  return interaction.update(buildCaptchaConfigView(cfg, interaction.guild));
}

// ── Rôle de Tag : sélection du rôle ──
function buildTagRolePanel(guild, cfg, notice = null) {
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Rôle de Tag', subtitle: `Rôle automatique selon le tag du serveur — ${guild.name}`, icon: 'tag', enabled: !!cfg.tag_role_enabled,
    tiles: [
      { label: 'Rôle attribué', value: nameOf(guild, 'role', cfg.tag_role_id), set: !!cfg.tag_role_id },
      { label: 'Condition', value: 'Tag du serveur sur le profil', set: true }
    ]
  });
  return cfgPanel({
    title: '🏷️ Rôle de Tag',
    intro: 'Attribue automatiquement un rôle aux membres ayant le tag de ce serveur sur leur profil.\n-# ⚠️ Fonctionnalité dépendante de l\'API Discord (peut ne pas fonctionner selon la version de discord.js installée).',
    notice, card,
    rows: [
      rowOf(new RoleSelectMenuBuilder().setCustomId('protect_tagrole_role_select').setPlaceholder('Choisis le rôle à attribuer').setMinValues(1).setMaxValues(1)),
      rowOf(new ButtonBuilder().setCustomId('protect_tagrole_disable').setLabel('🔴 Désactiver').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openTagRoleConfig(interaction) {
  return sendPanel(interaction, buildTagRolePanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function saveTagRole(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.tag_role_id = interaction.values[0];
  cfg.tag_role_enabled = true;
  persist('configuration');
  return interaction.update(buildTagRolePanel(interaction.guild, cfg, `✅ Rôle de Tag activé avec le rôle <@&${cfg.tag_role_id}>.`));
}

// ── Logs : sélection du salon ──
function buildLogsPanel(guild, cfg, notice = null) {
  const chId = getProtectionLogChannelId(cfg);
  const chName = nameOf(guild, 'channel', chId);
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Logs de protection', subtitle: `Journal des alertes — ${guild.name}`, icon: 'doc', enabled: !!chId,
    tiles: [
      { label: 'Salon de logs', value: chName ? chName + (cfg.protection_log_channel_id ? '' : ' (général)') : null, set: !!chId },
      { label: 'Alertes envoyées', value: 'RaidMode · Captcha · Spam', set: true }
    ]
  });
  return cfgPanel({
    title: '📋 Logs de protection',
    intro: 'Choisis le salon où seront envoyées les alertes (RaidMode, captcha, anti-spam, anti-@everyone...).',
    notice, card,
    rows: [
      rowOf(new ChannelSelectMenuBuilder().setCustomId('protect_logs_channel_select').setPlaceholder('Choisis le salon de logs').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      rowOf(new ButtonBuilder().setCustomId('protect_logs_disable').setLabel('🔴 Retirer').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openLogsConfig(interaction) {
  return sendPanel(interaction, buildLogsPanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function saveLogsChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.protection_log_channel_id = interaction.values[0];
  persist('configuration');
  return interaction.update(buildLogsPanel(interaction.guild, cfg, `✅ Logs de protection envoyés dans <#${cfg.protection_log_channel_id}>.`));
}

// ── Signalements : sélection du salon ──
function buildSignalementPanel(guild, cfg, notice = null) {
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Signalements', subtitle: `Commande /report — ${guild.name}`, icon: 'flag', enabled: !!cfg.signalement_enabled,
    tiles: [
      { label: 'Salon des signalements', value: nameOf(guild, 'channel', cfg.signalement_channel_id), set: !!cfg.signalement_channel_id },
      { label: 'Commande', value: '/report', set: true }
    ]
  });
  return cfgPanel({
    title: '🚩 Signalements',
    intro: 'Choisis le salon où arriveront les signalements faits via `/report`.',
    notice, card,
    rows: [
      rowOf(new ChannelSelectMenuBuilder().setCustomId('protect_signalement_channel_select').setPlaceholder('Choisis le salon des signalements').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      rowOf(new ButtonBuilder().setCustomId('protect_signalement_disable').setLabel('🔴 Désactiver').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openSignalementConfig(interaction) {
  return sendPanel(interaction, buildSignalementPanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function saveSignalementChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.signalement_channel_id = interaction.values[0];
  cfg.signalement_enabled = true;
  persist('configuration');
  return interaction.update(buildSignalementPanel(interaction.guild, cfg, `✅ Signalements activés dans <#${cfg.signalement_channel_id}>.`));
}

// ── Catégorie partagée "🛡️ CoreLab Protect" (Captcha + HoneyPot) ──
const PROTECT_CATEGORY_NAME = '🛡️ CoreLab Protect';
// Ancien nom (avant le renommage en CoreLab) : la catégorie existante est renommée
// au lieu d'être dupliquée sur les serveurs où ScaraBot était déjà installé.
const ANCIEN_PROTECT_CATEGORY_NAME = '🛡️ ScaraBot Protect';
async function getOrCreateProtectCategory(guild, cfg, reason) {
  // Réutilise la catégorie déjà connue si elle existe toujours
  if (cfg.protect_category_id) {
    const existing = guild.channels.cache.get(String(cfg.protect_category_id));
    if (existing && existing.type === ChannelType.GuildCategory) return existing;
  }
  // Repli : réutilise une catégorie déjà créée par le bot (ex. après perte de config)
  const found = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === PROTECT_CATEGORY_NAME);
  if (found) {
    cfg.protect_category_id = found.id;
    return found;
  }
  const ancienne = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === ANCIEN_PROTECT_CATEGORY_NAME);
  if (ancienne) {
    await ancienne.setName(PROTECT_CATEGORY_NAME, 'Renommage du bot : ScaraBot → CoreLab').catch(e => {
      console.error('Erreur renommage catégorie Protect :', e.message);
    });
    cfg.protect_category_id = ancienne.id;
    return ancienne;
  }
  const category = await guild.channels.create({
    name: PROTECT_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    position: 0,
    reason
  });
  try {
    await category.setPosition(0);
  } catch (e) {
    console.error('Erreur positionnement catégorie Protect :', e.message);
  }
  cfg.protect_category_id = category.id;
  return category;
}

// ── HoneyPot : création automatique de la catégorie + du salon piège ──
async function createHoneypotChannel(interaction, cfg) {
  const guild = interaction.guild;
  const category = await getOrCreateProtectCategory(guild, cfg, `HoneyPot configuré par ${interaction.user.tag}`);
  const channel = await guild.channels.create({
    name: '🚷・anti-scam',
    type: ChannelType.GuildText,
    parent: category.id,
    reason: `HoneyPot configuré par ${interaction.user.tag}`
  });
  cfg.honeypot_channel_id = channel.id;
  cfg.honeypot_enabled = true;
  cfg.honeypot_sanctions_count = 0;
  cfg.honeypot_message_id = null;
  try {
    const sent = await channel.send(buildHoneypotWarningPayload(cfg));
    cfg.honeypot_message_id = sent.id;
  } catch (e) {
    console.error('Erreur envoi message HoneyPot :', e.message);
  }
  persist('configuration');
  return channel;
}

// Libellé court de l'action de sanction, pour l'affichage dans le panneau
function getHoneypotActionLabel(cfg) {
  switch (cfg.infraction_default_action || 'ban') {
    case 'ban':
      return 'Bannissement';
    case 'kick':
      return 'Expulsion';
    case 'timeout':
      return 'Mise en timeout';
    case 'mute':
      return 'Mise en sourdine';
    case 'warn':
      return 'Avertissement';
    default:
      return 'Bannissement';
  }
}
const HONEYPOT_DURATION_PRESETS = [{
  label: '10 minutes',
  value: '10'
}, {
  label: '30 minutes',
  value: '30'
}, {
  label: '1 heure',
  value: '60'
}, {
  label: '6 heures',
  value: '360'
}, {
  label: '1 jour',
  value: '1440'
}, {
  label: '7 jours',
  value: '10080'
}];

// Construit le panneau de configuration complet du HoneyPot (façon RaidProtect)
function buildHoneypotConfigPanel(guild, cfg) {
  const action = cfg.infraction_default_action || 'ban';
  const isTimeout = action === 'timeout';
  const durationLabel = isTimeout ? `${cfg.infraction_default_duration_minutes || 10} minute(s)` : '—';
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'HoneyPot', subtitle: `Salon piège anti-comptes piratés — ${guild.name}`, icon: 'hex', enabled: !!cfg.honeypot_enabled,
    tiles: [
      { label: 'Salon HoneyPot', value: nameOf(guild, 'channel', cfg.honeypot_channel_id), set: !!cfg.honeypot_channel_id },
      { label: 'Sanction appliquée', value: cfg.honeypot_review_channel_id ? 'Timeout 24 h + revue' : (ACTION_LABELS[action] || action), set: true },
      cfg.honeypot_review_channel_id
        ? { label: 'Salon de revue staff', value: nameOf(guild, 'channel', cfg.honeypot_review_channel_id), set: true }
        : { label: 'Durée', value: isTimeout ? `${cfg.infraction_default_duration_minutes || 10} min` : '—', set: isTimeout, optional: true },
      { label: 'Membres ignorés', value: cfg.honeypot_ignored_role_id ? nameOf(guild, 'role', cfg.honeypot_ignored_role_id) : 'Non modérables', set: true }
    ]
  });
  const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_honeypot_regen_btn').setLabel('Régénérer le salon').setEmoji('🔄').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('protect_honeypot_disable').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('protect_honeypot_duration_custom_btn').setLabel('Durée personnalisée').setEmoji('✏️').setStyle(ButtonStyle.Secondary));
  const actionSelect = new StringSelectMenuBuilder().setCustomId('protect_honeypot_action_select').setPlaceholder('Sanction appliquée').setMinValues(1).setMaxValues(1).addOptions(new StringSelectMenuOptionBuilder().setLabel('Bannissement').setValue('ban').setDefault(action === 'ban'), new StringSelectMenuOptionBuilder().setLabel('Expulsion').setValue('kick').setDefault(action === 'kick'), new StringSelectMenuOptionBuilder().setLabel('Timeout (mute temporaire)').setValue('timeout').setDefault(action === 'timeout'), new StringSelectMenuOptionBuilder().setLabel('Mise en sourdine permanente').setValue('mute').setDefault(action === 'mute'), new StringSelectMenuOptionBuilder().setLabel('Avertissement').setValue('warn').setDefault(action === 'warn'));
  const durationSelect = new StringSelectMenuBuilder().setCustomId('protect_honeypot_duration_select').setPlaceholder(isTimeout ? durationLabel : 'Durée (timeout uniquement)').setMinValues(1).setMaxValues(1).setDisabled(!isTimeout).addOptions(HONEYPOT_DURATION_PRESETS.map(p => new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.value).setDefault(isTimeout && String(cfg.infraction_default_duration_minutes || 10) === p.value)));
  const reviewSelect = new ChannelSelectMenuBuilder().setCustomId('protect_honeypot_review_channel_select').setPlaceholder(cfg.honeypot_review_channel_id ? 'Salon de revue staff (vider pour désactiver)' : 'Salon de revue staff (timeout 24 h + ban au choix)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  const ignoredSelect = new RoleSelectMenuBuilder().setCustomId('protect_honeypot_ignored_role_select').setPlaceholder('Rôle supplémentaire à ignorer (optionnel)').setMinValues(0).setMaxValues(1);
  return cfgPanel({
    title: '🍯 Configuration du HoneyPot',
    intro: 'Le **HoneyPot** est un salon piège visible et accessible en écriture par tous les membres. Tout membre qui y envoie un message est **automatiquement sanctionné** par CoreLab.\n-# Le salon est créé dans une catégorie dédiée en haut du serveur, avec un message d\'avertissement (et un bouton de traduction).',
    card,
    rows: [buttonRow, new ActionRowBuilder().addComponents(reviewSelect), new ActionRowBuilder().addComponents(actionSelect), new ActionRowBuilder().addComponents(durationSelect), new ActionRowBuilder().addComponents(ignoredSelect)]
  });
}
async function refreshHoneypotPanel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  await refreshHoneypotMessage(interaction.guild, cfg);
  return interaction.update(toCV2Payload({
    ...buildHoneypotConfigPanel(interaction.guild, cfg),
    ephemeral: true
  }));
}
async function openHoneypotConfig(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  if (cfg.honeypot_enabled && cfg.honeypot_channel_id) {
    return sendPanel(interaction, toCV2Payload(buildHoneypotConfigPanel(interaction.guild, cfg)));
  }
  // Depuis le panneau principal : on remplace le message en place (pas de nouveau message)
  if (interaction.isMessageComponent?.()) await interaction.deferUpdate();
  else await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  try {
    await createHoneypotChannel(interaction, cfg);
    return interaction.editReply(toCV2Payload(buildHoneypotConfigPanel(interaction.guild, cfg)));
  } catch (e) {
    console.error('Erreur création HoneyPot :', e.message);
    return interaction.editReply(toCV2Payload({
      content: `❌ Impossible de créer la catégorie/le salon HoneyPot (vérifie mes permissions "Gérer les salons").`,
      components: [backRow()],
      files: [],
      attachments: []
    }));
  }
}

// ── Boutons/menus du panneau de configuration HoneyPot ──
async function regenerateHoneypotChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.deferUpdate();
  const oldChannel = cfg.honeypot_channel_id ? interaction.guild.channels.cache.get(String(cfg.honeypot_channel_id)) : null;
  if (oldChannel) {
    try {
      await oldChannel.delete('Régénération du salon HoneyPot');
    } catch (e) {
      console.error('Erreur suppression ancien salon HoneyPot :', e.message);
    }
  }
  try {
    await createHoneypotChannel(interaction, cfg);
  } catch (e) {
    console.error('Erreur régénération HoneyPot :', e.message);
    return interaction.followUp({
      content: `❌ Impossible de régénérer le salon HoneyPot (vérifie mes permissions "Gérer les salons").`,
      flags: MessageFlags.Ephemeral
    });
  }
  return interaction.editReply(toCV2Payload(buildHoneypotConfigPanel(interaction.guild, cfg)));
}
async function saveHoneypotAction(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const action = interaction.values[0];
  if (action === 'timeout') {
    const modal = new ModalBuilder().setCustomId('protect_honeypot_duration_modal').setTitle('Timeout — durée personnalisée');
    const input = new TextInputBuilder().setCustomId('duree_minutes').setLabel('Durée en minutes').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(cfg.infraction_default_duration_minutes || 10));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
  cfg.infraction_default_action = action;
  cfg.infraction_default_duration_minutes = null;
  persist('configuration');
  return refreshHoneypotPanel(interaction);
}
async function saveHoneypotDuration(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.infraction_default_action = 'timeout';
  cfg.infraction_default_duration_minutes = parseInt(interaction.values[0], 10);
  persist('configuration');
  return refreshHoneypotPanel(interaction);
}
async function openHoneypotDurationCustomModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId('protect_honeypot_duration_modal').setTitle('Timeout — durée personnalisée');
  const input = new TextInputBuilder().setCustomId('duree_minutes').setLabel('Durée en minutes').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(cfg.infraction_default_duration_minutes || 10));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}
async function submitHoneypotDurationModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const minutes = parseInt(interaction.fields.getTextInputValue('duree_minutes'), 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return interaction.reply({
      content: '❌ Durée invalide (minutes).',
      flags: MessageFlags.Ephemeral
    });
  }
  cfg.infraction_default_action = 'timeout';
  cfg.infraction_default_duration_minutes = minutes;
  persist('configuration');
  await refreshHoneypotMessage(interaction.guild, cfg);
  if (interaction.isFromMessage?.()) {
    return interaction.update(toCV2Payload({
      ...buildHoneypotConfigPanel(interaction.guild, cfg),
      ephemeral: true
    }));
  }
  return interaction.reply({
    content: `✅ Timeout HoneyPot défini : ${minutes} minute(s).`,
    flags: MessageFlags.Ephemeral
  });
}
async function saveHoneypotReviewChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.honeypot_review_channel_id = interaction.values[0] || null;
  persist('configuration');
  return refreshHoneypotPanel(interaction);
}
async function saveHoneypotIgnoredRole(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.honeypot_ignored_role_id = interaction.values[0] || null;
  persist('configuration');
  return refreshHoneypotPanel(interaction);
}
// ── Médias du message HoneyPot (bannière + miniature) ──
// Dépose simplement un fichier dans src/data/protect_images/ nommé
//   honeypot_banner.<ext>     (bannière)
//   honeypot_thumbnail.<ext>  (miniature)
// avec <ext> = png, jpg, jpeg, gif ou mp4. Le bot détecte automatiquement le
// format (si plusieurs fichiers existent, le plus récent est utilisé).
const HONEYPOT_MEDIA_DIR = path.join(__dirname, '..', 'data', 'protect_images');
const HONEYPOT_MEDIA_RE = /\.(png|jpe?g|gif|mp4)$/i;

// Renvoie { path, name, ext, isVideo } ou null si aucun fichier n'est présent
function findHoneypotMedia(kind) {
  try {
    const prefix = `honeypot_${kind}`.toLowerCase();
    const candidates = fs.readdirSync(HONEYPOT_MEDIA_DIR).filter(f => {
      const lower = f.toLowerCase();
      return lower.startsWith(prefix + '.') && HONEYPOT_MEDIA_RE.test(lower);
    }).map(f => {
      const full = path.join(HONEYPOT_MEDIA_DIR, f);
      return { file: f, full, mtime: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    if (!candidates.length) return null;
    const ext = path.extname(candidates[0].file).slice(1).toLowerCase();
    return {
      path: candidates[0].full,
      // nom normalisé, sans caractères spéciaux (utilisé dans attachment://)
      name: `honeypot_${kind}.${ext}`,
      ext,
      isVideo: ext === 'mp4'
    };
  } catch (e) {
    console.error(`Erreur lecture média HoneyPot (${kind}) :`, e.message);
    return null;
  }
}

// Traduit l'action de sanction configurée (bouton "Sanctions") en phrase française
function getHoneypotSanctionPhrase(cfg) {
  const action = cfg.infraction_default_action || 'ban';
  switch (action) {
    case 'ban':
      return 'un bannissement';
    case 'kick':
      return 'une expulsion';
    case 'timeout':
      {
        const minutes = Number(cfg.infraction_default_duration_minutes) || 10;
        return `une mise en timeout de ${minutes} minute(s)`;
      }
    case 'mute':
      return 'une mise en sourdine permanente';
    case 'warn':
      return 'un avertissement';
    default:
      return 'un bannissement';
  }
}

// Génère dynamiquement le texte FR selon la sanction actuellement choisie dans le bouton "Sanctions"
function buildHoneypotText(cfg) {
  if (cfg.honeypot_review_channel_id) {
    return 'Ce salon sert à piéger les comptes hackés / arnaqueurs. Tout message envoyé ici entraînera automatiquement un timeout de 24 heures pour son auteur, puis le staff décidera d\'un éventuel bannissement.';
  }
  return `Ce salon sert à piéger les comptes hackés / arnaqueurs. Tout message envoyé ici entraînera automatiquement ${getHoneypotSanctionPhrase(cfg)} pour son auteur.`;
}
// Conservé pour compatibilité (repli DeepL, etc.) — préférer buildHoneypotText(cfg) qui est dynamique
const HONEYPOT_TEXT_FR = 'Ce salon sert à piéger les comptes hackés / arnaqueurs. Tout message envoyé ici entraînera automatiquement une sanction pour son auteur.';
// Construit le message d'avertissement complet (Components V2 + fichiers).
// - Bannière : png / jpg / jpeg / gif / mp4 (Galerie de médias)
// - Miniature : png / jpg / jpeg / gif (accessoire du texte). Discord n'accepte pas
//   de vidéo comme miniature : un mp4 est donc affiché en petit lecteur vidéo au-dessus du texte.
// Nouveaux AttachmentBuilder à chaque appel (utilisables une seule fois).
function buildHoneypotWarningPayload(cfg, description = buildHoneypotText(cfg), row = buildHoneypotWarningRow(cfg)) {
  const banner = findHoneypotMedia('banner');
  const thumb = findHoneypotMedia('thumbnail');
  const files = [];
  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);

  // Miniature vidéo (mp4) : lecteur en haut du message
  if (thumb && thumb.isVideo) {
    files.push(new AttachmentBuilder(thumb.path, { name: thumb.name }));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${thumb.name}`)));
  }

  const headerText = `## 🛡️〢NE PAS ENVOYER DE MESSAGE DANS CE SALON\n${description}`;
  if (thumb && !thumb.isVideo) {
    files.push(new AttachmentBuilder(thumb.path, { name: thumb.name }));
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${thumb.name}`)));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  }

  // Bannière (image, gif ou vidéo)
  if (banner) {
    files.push(new AttachmentBuilder(banner.path, { name: banner.name }));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${banner.name}`)));
  }

  return {
    components: [container, row],
    files,
    flags: MessageFlags.IsComponentsV2
  };
}

// Édite le message d'avertissement publié dans le salon HoneyPot pour refléter la sanction actuellement configurée
async function refreshHoneypotMessage(guild, cfg) {
  if (!cfg.honeypot_channel_id || !cfg.honeypot_message_id) return;
  try {
    const channel = guild.channels.cache.get(String(cfg.honeypot_channel_id));
    if (!channel?.isTextBased?.()) return;
    const warningMsg = await channel.messages.fetch(cfg.honeypot_message_id);
    const textFr = buildHoneypotText(cfg);
    let description = textFr;
    if (cfg.honeypot_lang === 'en') {
      try {
        const {
          text
        } = await traduireDeepL(textFr, 'en', 'fr');
        cfg.honeypot_text_en = text;
        cfg.honeypot_text_en_source = textFr;
        description = text;
      } catch (e) {
        console.error('Erreur traduction HoneyPot (refresh) :', e.message);
        description = cfg.honeypot_text_en || textFr;
      }
    }
    await warningMsg.edit({ ...buildHoneypotWarningPayload(cfg, description), attachments: [] });
  } catch (e) {
    console.error('Erreur rafraîchissement message HoneyPot :', e.message);
  }
}
function buildHoneypotWarningRow(cfg) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_honeypot_sanctions_display').setLabel(`🛡️ Sanctions : ${cfg.honeypot_sanctions_count || 0}`).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('protect_honeypot_translate').setLabel('🌐 Translate').setStyle(ButtonStyle.Primary));
}
async function toggleHoneypotTranslate(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Réservé au staff.',
      flags: MessageFlags.Ephemeral
    });
  }
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.deferUpdate();
  const currentLang = cfg.honeypot_lang || 'fr';
  const textFr = buildHoneypotText(cfg);
  let description;
  if (currentLang === 'fr') {
    // Retraduit si pas de cache ou si la sanction a changé depuis la dernière traduction
    if (!cfg.honeypot_text_en || cfg.honeypot_text_en_source !== textFr) {
      try {
        const {
          text
        } = await traduireDeepL(textFr, 'en', 'fr');
        cfg.honeypot_text_en = text;
        cfg.honeypot_text_en_source = textFr;
      } catch (e) {
        console.error('Erreur traduction HoneyPot :', e.message);
        cfg.honeypot_text_en = textFr; // repli si DeepL indisponible
        cfg.honeypot_text_en_source = textFr;
      }
    }
    description = cfg.honeypot_text_en;
    cfg.honeypot_lang = 'en';
  } else {
    description = textFr;
    cfg.honeypot_lang = 'fr';
  }
  persist('configuration');
  const row = buildHoneypotWarningRow(cfg);
  row.components[1].setLabel(cfg.honeypot_lang === 'en' ? '🌐 Français' : '🌐 Translate');
  return interaction.editReply({ ...buildHoneypotWarningPayload(cfg, description, row), attachments: [] });
}
async function saveHoneypotChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const channelId = interaction.values[0];
  cfg.honeypot_channel_id = channelId;
  cfg.honeypot_enabled = true;
  cfg.honeypot_sanctions_count = 0;
  cfg.honeypot_message_id = null;
  const channel = interaction.guild.channels.cache.get(String(channelId));
  if (channel?.isTextBased?.()) {
    try {
      const sent = await channel.send(buildHoneypotWarningPayload(cfg));
      cfg.honeypot_message_id = sent.id;
    } catch (e) {
      console.error('Erreur envoi message HoneyPot :', e.message);
    }
  }
  persist('configuration');
  return interaction.update(toCV2Payload({
    content: `✅ HoneyPot activé sur <#${channelId}>. Pense à masquer ce salon aux membres normaux dans ses permissions.`,
    components: [],
    files: [],
    attachments: []
  }));
}

// ── Sanctions : sélection du salon de journalisation des infractions ──
function buildSanctionsPanel(guild, cfg, notice = null) {
  const act = cfg.infraction_default_action;
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Sanctions', subtitle: `Journal et action par défaut — ${guild.name}`, icon: 'gavel', enabled: !!cfg.infraction_channel_id,
    tiles: [
      { label: 'Salon des sanctions', value: nameOf(guild, 'channel', cfg.infraction_channel_id), set: !!cfg.infraction_channel_id },
      { label: 'Action par défaut', value: ACTION_LABELS[act] || 'aucune', set: !!act },
      { label: 'Durée du timeout', value: act === 'timeout' && cfg.infraction_default_duration_minutes ? `${cfg.infraction_default_duration_minutes} min` : '—', set: act === 'timeout' && !!cfg.infraction_default_duration_minutes, optional: true }
    ]
  });
  const actionSelect = new StringSelectMenuBuilder().setCustomId('protect_sanctions_action_select').setPlaceholder('Choisis l\'action par défaut pour les sanctions').setMinValues(1).setMaxValues(1).addOptions({
    label: 'Avertir (warn)', value: 'warn', description: 'Ne fait qu\'enregistrer/avertir', default: act === 'warn'
  }, {
    label: 'Timeout (mute temporaire)', value: 'timeout', description: 'Met en timeout pour une durée définie', default: act === 'timeout'
  }, {
    label: 'Mute (silence permanent)', value: 'mute', description: 'Mute sans durée', default: act === 'mute'
  }, {
    label: 'Kick (expulsion)', value: 'kick', description: 'Expulse le membre', default: act === 'kick'
  }, {
    label: 'Ban (bannissement)', value: 'ban', description: 'Bannit le membre', default: act === 'ban'
  });
  const channelSelect = new ChannelSelectMenuBuilder().setCustomId('protect_sanctions_channel_select').setPlaceholder('Salon où journaliser les sanctions').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  return cfgPanel({
    title: '⚠️ Sanctions',
    intro: 'Définis l\'action par défaut pour les sanctions et le salon où elles sont journalisées.',
    notice, card,
    rows: [
      rowOf(actionSelect),
      rowOf(channelSelect),
      rowOf(new ButtonBuilder().setCustomId('protect_sanctions_disable').setLabel('🔴 Retirer le salon').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openSanctionsConfig(interaction) {
  return sendPanel(interaction, buildSanctionsPanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function saveSanctionsAction(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const action = interaction.values[0];
  // Si action = timeout, demander une durée via modal
  if (action === 'timeout') {
    const modal = new ModalBuilder().setCustomId('protect_sanctions_timeout_modal').setTitle('Timeout — durée et raison');
    const durée = new TextInputBuilder().setCustomId('duree_minutes').setLabel('Durée en minutes').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(cfg.infraction_default_duration_minutes || 10));
    const raison = new TextInputBuilder().setCustomId('raison').setLabel('Raison par défaut (optionnel)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setValue(cfg.infraction_default_reason || '');
    modal.addComponents(new ActionRowBuilder().addComponents(durée), new ActionRowBuilder().addComponents(raison));
    return interaction.showModal(modal);
  }
  cfg.infraction_default_action = action;
  // nettoie durée si non timeout
  cfg.infraction_default_duration_minutes = null;
  cfg.infraction_default_reason = null;
  persist('configuration');
  await refreshHoneypotMessage(interaction.guild, cfg);
  return interaction.update(buildSanctionsPanel(interaction.guild, cfg, `✅ Action par défaut enregistrée : **${ACTION_LABELS[action] || action}**.`));
}
async function submitSanctionsTimeoutModal(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const minutes = parseInt(interaction.fields.getTextInputValue('duree_minutes'), 10);
  const raison = interaction.fields.getTextInputValue('raison').trim() || null;
  if (!Number.isFinite(minutes) || minutes <= 0) return interaction.reply({
    content: '❌ Durée invalide (minutes).',
    flags: MessageFlags.Ephemeral
  });
  cfg.infraction_default_action = 'timeout';
  cfg.infraction_default_duration_minutes = minutes;
  cfg.infraction_default_reason = raison;
  persist('configuration');
  await refreshHoneypotMessage(interaction.guild, cfg);
  return sendPanel(interaction, buildSanctionsPanel(interaction.guild, cfg, `✅ Timeout par défaut défini : ${minutes} minute(s).`));
}
async function saveSanctionsChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.infraction_channel_id = interaction.values[0];
  persist('configuration');
  return interaction.update(buildSanctionsPanel(interaction.guild, cfg, `✅ Sanctions journalisées dans <#${cfg.infraction_channel_id}>.`));
}

// ── Transparence : salon public des actions de protection ──
function buildTransparencePanel(guild, cfg, notice = null) {
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Transparence', subtitle: `Alertes visibles par les membres — ${guild.name}`, icon: 'eye', enabled: !!cfg.transparence_enabled,
    tiles: [
      { label: 'Salon public', value: nameOf(guild, 'channel', cfg.transparence_channel_id), set: !!cfg.transparence_channel_id },
      { label: 'Contenu republié', value: 'Alertes de protection', set: true }
    ]
  });
  return cfgPanel({
    title: '📖 Transparence',
    intro: 'Choisis un salon visible par les membres où seront republiées toutes les alertes de protection (RaidMode, HoneyPot, sanctions automatiques...), en plus du salon de logs staff.',
    notice, card,
    rows: [
      rowOf(new ChannelSelectMenuBuilder().setCustomId('protect_transparence_channel_select').setPlaceholder('Choisis le salon public de transparence').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      rowOf(new ButtonBuilder().setCustomId('protect_transparence_disable').setLabel('🔴 Désactiver').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openTransparenceConfig(interaction) {
  return sendPanel(interaction, buildTransparencePanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
async function saveTransparenceChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.transparence_channel_id = interaction.values[0];
  cfg.transparence_enabled = true;
  persist('configuration');
  return interaction.update(buildTransparencePanel(interaction.guild, cfg, `✅ Transparence activée : les alertes seront aussi publiées dans <#${cfg.transparence_channel_id}>.`));
}

// ── Authentification Manager : rôle d'attente + salon de revue ──
function buildAuthPanel(guild, cfg, notice = null) {
  const card = buildConfigImage({
    guildId: guild?.id,
    title: 'Authentification', subtitle: `Validation manuelle par le staff — ${guild.name}`, icon: 'lock', enabled: !!cfg.auth_enabled,
    tiles: [
      { label: 'Rôle d\'attente', value: nameOf(guild, 'role', cfg.auth_pending_role_id), set: !!cfg.auth_pending_role_id },
      { label: 'Salon de revue', value: nameOf(guild, 'channel', cfg.auth_review_channel_id), set: !!cfg.auth_review_channel_id },
      { label: 'Validation', value: 'Manuelle (staff)', set: true }
    ]
  });
  return cfgPanel({
    title: '🪪 Authentification Manager',
    intro: 'Chaque nouveau membre reçoit un rôle "en attente" (qui doit restreindre l\'accès via les permissions) jusqu\'à validation manuelle par le staff dans le salon de revue.',
    notice, card,
    rows: [
      rowOf(new RoleSelectMenuBuilder().setCustomId('protect_auth_role_select').setPlaceholder('Rôle attribué en attendant la validation').setMinValues(1).setMaxValues(1)),
      rowOf(new ChannelSelectMenuBuilder().setCustomId('protect_auth_channel_select').setPlaceholder('Salon de revue pour le staff').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      rowOf(new ButtonBuilder().setCustomId('protect_auth_disable').setLabel('🔴 Désactiver').setStyle(ButtonStyle.Danger))
    ]
  });
}
async function openAuthConfig(interaction) {
  return sendPanel(interaction, buildAuthPanel(interaction.guild, getGuildConfig(interaction.guild.id)));
}
function maybeEnableAuth(cfg) {
  if (cfg.auth_pending_role_id && cfg.auth_review_channel_id) cfg.auth_enabled = true;
}
async function saveAuthRole(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.auth_pending_role_id = interaction.values[0];
  maybeEnableAuth(cfg);
  persist('configuration');
  return interaction.update(buildAuthPanel(interaction.guild, cfg, cfg.auth_enabled ? null : `✅ Rôle d'attente enregistré (<@&${cfg.auth_pending_role_id}>). Choisis aussi un salon de revue pour activer la fonctionnalité.`));
}
async function saveAuthChannel(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  cfg.auth_review_channel_id = interaction.values[0];
  maybeEnableAuth(cfg);
  persist('configuration');
  return interaction.update(buildAuthPanel(interaction.guild, cfg, cfg.auth_enabled ? null : `✅ Salon de revue enregistré (<#${cfg.auth_review_channel_id}>). Choisis aussi un rôle d'attente pour activer la fonctionnalité.`));
}

// ────────────────────────────────────────────────
// Routeur des interactions "protect_*"
// ────────────────────────────────────────────────
async function routeProtectionInteraction(interaction) {
  try {
    const id = interaction.customId || '';
    console.log(`[DEBUG] routeProtectionInteraction called — id=${id} user=${interaction.user?.id} guild=${interaction.guild?.id} type=${interaction.type}`);
    if (interaction.isButton()) {
      if (id === 'protect_refresh_btn') return refreshDashboard(interaction);
      if (id === 'protect_simple_btn') return handleSimpleProtectToggle(interaction);
      if (id === 'protect_back') return interaction.update(buildProtectPayload(interaction.guild));
      if (id === 'protect_raidmode_btn') return openRaidmodePanel(interaction);
      if (id === 'protect_raidmode_edit') return openRaidmodeModal(interaction);
      if (id === 'protect_raidmode_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.raidmode_enabled = false;
        persist('configuration');
        return interaction.update(buildRaidmodePanel(interaction.guild, cfg, '🔴 Auto RaidMode désactivé.'));
      }
      if (id === 'protect_ddos_edit') return openDdosModal(interaction);
      if (id === 'protect_ddosv_edit') return openDdosVoiceModal(interaction);
      if (id === 'protect_ddosv_toggle') {
        const cfg = getGuildConfig(interaction.guild.id);
        if (cfg.anti_ddos_voice_enabled) return endDdosVoiceFromPanel(interaction, '🔴 Anti-DDoS vocal désactivé.', { disable: true });
        cfg.anti_ddos_voice_enabled = true;
        persist('configuration');
        return interaction.update(buildDdosVoicePanel(interaction.guild, cfg, '🟢 Anti-DDoS vocal activé.'));
      }
      if (id === 'protect_ddosv_clear') return endDdosVoiceFromPanel(interaction, '🧯 Alerte Anti-DDoS vocal levée : salons vocaux déverrouillés.');
      if (id === 'protect_ddos_toggle') {
        const cfg = getGuildConfig(interaction.guild.id);
        if (cfg.anti_ddos_enabled) return endDdosFromPanel(interaction, '🔴 Anti-DDoS désactivé.', { disable: true });
        cfg.anti_ddos_enabled = true;
        persist('configuration');
        return interaction.update(buildDdosPanel(interaction.guild, cfg, '🟢 Anti-DDoS activé.'));
      }
      if (id === 'protect_ddos_clear') return endDdosFromPanel(interaction, '🧯 Alerte Anti-DDoS levée : salons et serveur remis à la normale.');
      if (id === 'protect_captcha_btn') return openCaptchaConfig(interaction);
      if (id === 'protect_captcha_create_channel') return createCaptchaChannel(interaction);
      if (id === 'protect_minage_btn') return openMinAgePanel(interaction);
      if (id === 'protect_minage_edit') return openMinAgeModal(interaction);
      if (id === 'protect_minage_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.min_account_age_days = 0;
        persist('configuration');
        return interaction.update(buildMinAgePanel(interaction.guild, cfg, '🔴 Âge minimum désactivé.'));
      }
      if (id === 'protect_antispam_btn') return toggleAndRefresh(interaction, 'antispam');
      if (id === 'protect_antieveryone_btn') return toggleAndRefresh(interaction, 'antieveryone');
      if (id === 'protect_logs_btn') return openLogsConfig(interaction);
      if (id === 'protect_signalement_btn') return openSignalementConfig(interaction);
      if (id === 'protect_tagrole_btn') return openTagRoleConfig(interaction);
      if (id === 'protect_dmlock_btn') return toggleAndRefresh(interaction, 'dm_lock_enabled');
      if (id === 'protect_lockdown_btn') return toggleLockdown(interaction);
      if (id === 'protect_honeypot_btn') return openHoneypotConfig(interaction);
      if (id === 'protect_honeypot_reset_btn') return resetHoneypotSanctions(interaction);
      if (id === 'protect_honeypot_regen_btn') return regenerateHoneypotChannel(interaction);
      if (id === 'protect_honeypot_duration_custom_btn') return openHoneypotDurationCustomModal(interaction);
      if (id === 'protect_sanctions_btn') return openSanctionsConfig(interaction);
      if (id === 'protect_transparence_btn') return openTransparenceConfig(interaction);
      if (id === 'protect_auth_btn') return openAuthConfig(interaction);
      if (id.startsWith('protect_auth_accept_')) return resolveAuthReview(interaction, true);
      if (id.startsWith('protect_auth_refuse_')) return resolveAuthReview(interaction, false);
      if (id.startsWith('protect_auth_double_')) return resolveAuthDouble(interaction);
      if (id === 'protect_mark_double_btn') return toggleMarkDoubleDetection(interaction);
      if (id === 'protect_antiphishing_btn') return toggleAndRefresh(interaction, 'anti_phishing');
      if (id === 'protect_antiscamimage_btn') return toggleAndRefresh(interaction, 'anti_scam_image');
      if (id === 'protect_antibot_btn') return toggleAndRefresh(interaction, 'anti_bot_enabled');
      if (id === 'protect_antialt_btn') return toggleAndRefresh(interaction, 'anti_alt_enabled');
      if (id === 'protect_antilink_btn') return toggleAndRefresh(interaction, 'anti_link_enabled');
      if (id === 'protect_antinuke_btn') return toggleAndRefresh(interaction, 'anti_nuke_enabled');
      if (id === 'protect_antighostping_btn') return toggleAndRefresh(interaction, 'anti_ghostping_enabled');
      if (id === 'protect_honeypot_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.honeypot_enabled = false;
        persist('configuration');
        return interaction.update(toCV2Payload({
          content: '🔴 HoneyPot désactivé.',
          components: [],
          files: [],
          attachments: []
        }));
      }
      if (id === 'protect_honeypot_translate') return toggleHoneypotTranslate(interaction);
      if (id.startsWith('protect_honeypot_ban_')) return resolveHoneypotReview(interaction, true);
      if (id.startsWith('protect_honeypot_keep_')) return resolveHoneypotReview(interaction, false);
      if (id === 'protect_transparence_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.transparence_enabled = false;
        persist('configuration');
        return interaction.update(buildTransparencePanel(interaction.guild, cfg, '🔴 Transparence désactivée.'));
      }
      if (id === 'protect_sanctions_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.infraction_channel_id = null;
        persist('configuration');
        return interaction.update(buildSanctionsPanel(interaction.guild, cfg, '🔴 Salon des sanctions retiré.'));
      }
      if (id === 'protect_auth_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.auth_enabled = false;
        persist('configuration');
        return interaction.update(buildAuthPanel(interaction.guild, cfg, '🔴 Authentification Manager désactivé.'));
      }
      if (id === 'protect_captcha_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.captcha_enabled = false;
        persist('configuration');
        return interaction.update(buildCaptchaConfigView(cfg, interaction.guild, '🔴 Captcha désactivé.'));
      }
      if (id === 'protect_tagrole_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.tag_role_enabled = false;
        persist('configuration');
        return interaction.update(buildTagRolePanel(interaction.guild, cfg, '🔴 Rôle de Tag désactivé.'));
      }
      if (id === 'protect_logs_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.protection_log_channel_id = null;
        persist('configuration');
        return interaction.update(buildLogsPanel(interaction.guild, cfg, '🔴 Salon de logs de protection retiré.'));
      }
      if (id === 'protect_signalement_disable') {
        const cfg = getGuildConfig(interaction.guild.id);
        cfg.signalement_enabled = false;
        persist('configuration');
        return interaction.update(buildSignalementPanel(interaction.guild, cfg, '🔴 Signalements désactivés.'));
      }
    }
    if (interaction.isRoleSelectMenu()) {
      if (id === 'protect_captcha_role_select') return saveCaptchaRole(interaction);
      if (id === 'protect_captcha_verified_role_select') return saveCaptchaVerifiedRole(interaction);
      if (id === 'protect_tagrole_role_select') return saveTagRole(interaction);
      if (id === 'protect_auth_role_select') return saveAuthRole(interaction);
      if (id === 'protect_honeypot_ignored_role_select') return saveHoneypotIgnoredRole(interaction);
    }
    if (interaction.isChannelSelectMenu()) {
      if (id === 'protect_captcha_channel_select') return saveCaptchaChannel(interaction);
      if (id === 'protect_logs_channel_select') return saveLogsChannel(interaction);
      if (id === 'protect_signalement_channel_select') return saveSignalementChannel(interaction);
      if (id === 'protect_honeypot_channel_select') return saveHoneypotChannel(interaction);
      if (id === 'protect_honeypot_review_channel_select') return saveHoneypotReviewChannel(interaction);
      if (id === 'protect_sanctions_channel_select') return saveSanctionsChannel(interaction);
      if (id === 'protect_transparence_channel_select') return saveTransparenceChannel(interaction);
      if (id === 'protect_auth_channel_select') return saveAuthChannel(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (id === 'protect_toggle_select') {
        const key = interaction.values[0];
        if (key === 'auth_double_detection_enabled') return toggleMarkDoubleDetection(interaction);
        if (!TOGGLE_KEYS.includes(key)) return interaction.deferUpdate();
        return toggleAndRefresh(interaction, key);
      }
      if (id === 'protect_config_select') {
        const openers = {
          raidmode: openRaidmodePanel,
          antiddos: openDdosPanel,
          antiddosvoice: openDdosVoicePanel,
          captcha: openCaptchaConfig,
          minage: openMinAgePanel,
          logs: openLogsConfig,
          signalement: openSignalementConfig,
          sanctions: openSanctionsConfig,
          transparence: openTransparenceConfig,
          tagrole: openTagRoleConfig,
          auth: openAuthConfig,
          honeypot: openHoneypotConfig
        };
        const open = openers[interaction.values[0]];
        return open ? open(interaction) : interaction.deferUpdate();
      }
      if (id === 'protect_sanctions_action_select') return saveSanctionsAction(interaction);
      if (id === 'protect_honeypot_action_select') return saveHoneypotAction(interaction);
      if (id === 'protect_honeypot_duration_select') return saveHoneypotDuration(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (id === 'protect_raidmode_modal') return submitRaidmodeModal(interaction);
      if (id === 'protect_ddos_modal') return submitDdosModal(interaction);
      if (id === 'protect_ddosv_modal') return submitDdosVoiceModal(interaction);
      if (id === 'protect_minage_modal') return submitMinAgeModal(interaction);
      if (id === 'protect_sanctions_timeout_modal') return submitSanctionsTimeoutModal(interaction);
      if (id === 'protect_mark_double_modal') return submitMarkDoubleModal(interaction);
      if (id === 'protect_honeypot_duration_modal') return submitHoneypotDurationModal(interaction);
    }
  } catch (e) {
    console.error('Erreur routeProtectionInteraction :', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Une erreur est survenue.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
  }
}
// Panneaux de réglage détaillés, réutilisés par l'assistant d'installation (protectionSetup.js)
const PANEL_OPENERS = {
  raidmode: openRaidmodePanel,
  antiddos: openDdosPanel,
  antiddosvoice: openDdosVoicePanel,
  captcha: openCaptchaConfig,
  minage: openMinAgePanel,
  logs: openLogsConfig,
  signalement: openSignalementConfig,
  sanctions: openSanctionsConfig,
  transparence: openTransparenceConfig,
  tagrole: openTagRoleConfig,
  auth: openAuthConfig,
  honeypot: openHoneypotConfig
};
module.exports = {
  registerProtectionHandlers,
  routeProtectionInteraction,
  buildProtectDashboard,
  buildProtectRows,
  PANEL_OPENERS
};
