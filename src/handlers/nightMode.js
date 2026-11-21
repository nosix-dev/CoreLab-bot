// src/handlers/nightMode.js
// Mode nuit : renforce la protection pendant les horaires choisis dans le dashboard
// (page « Mode nuit », clés night_* de bot_config.json).

const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, persist } = require('../core/config');

const TICK_MS = 30 * 1000;
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/* ---------- Heure locale ---------- */
function localParts(tz, now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const get = t => parts.find(p => p.type === t)?.value;
    return { day: WEEKDAYS[get('weekday')] ?? 0, min: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    return null;
  }
}
const toMin = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

// true si « maintenant » est dans la fenêtre [start, end[ ; une fenêtre qui passe minuit
// appartient au jour où elle commence.
function inWindow(start, end, days, local) {
  if (!local) return false;
  const s = toMin(start), e = toMin(end);
  if (s === e) return false;
  if (s < e) return local.min >= s && local.min < e && days.includes(local.day);
  if (local.min >= s) return days.includes(local.day);
  if (local.min < e) return days.includes((local.day + 6) % 7);
  return false;
}

function isNightNow(cfg, now = Date.now()) {
  if (!cfg.night_enabled) return false;
  return inWindow(cfg.night_start || '00:00', cfg.night_end || '08:00', Array.isArray(cfg.night_days) ? cfg.night_days : [0, 1, 2, 3, 4, 5, 6], localParts(cfg.night_tz || 'Europe/Paris', now));
}
// Utilisé par l'anti-raid (protection.js) : true tant que le mode nuit est appliqué sur le serveur
function isNightActive(guildId) {
  const cfg = getGuildConfig(guildId);
  return !!(cfg.night_enabled && cfg.night_state?.active);
}

/* ---------- Staff / exceptions ---------- */
const STAFF_PERMS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers];
function isExempt(member, cfg) {
  if (!member) return true;
  if (STAFF_PERMS.some(p => member.permissions.has(p))) return true;
  const ex = Array.isArray(cfg.night_exempt_roles) ? cfg.night_exempt_roles : [];
  return ex.some(id => member.roles.cache.has(id));
}

async function announce(guild, cfg, text) {
  const id = cfg.night_announce_channel;
  if (!id) return;
  const ch = guild.channels.cache.get(String(id));
  if (ch?.isTextBased?.()) await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => { });
}

/* ---------- Début / fin de nuit ---------- */
async function startNight(guild, cfg) {
  const state = { active: true, since: Date.now(), slow: {}, invites: false };
  if (cfg.night_slowmode) {
    const delay = Number(cfg.night_slowmode_delay) || 10;
    for (const id of Array.isArray(cfg.night_slowmode_channels) ? cfg.night_slowmode_channels : []) {
      const ch = guild.channels.cache.get(String(id));
      if (!ch || typeof ch.setRateLimitPerUser !== 'function') continue;
      const prev = ch.rateLimitPerUser || 0;
      if (prev >= delay) continue; // déjà au moins aussi lent : on ne touche à rien
      try { await ch.setRateLimitPerUser(delay, 'Mode nuit'); state.slow[ch.id] = { prev, set: delay }; } catch (e) { console.error('[NightMode] mode lent :', e.message); }
    }
  }
  if (cfg.night_pause_invites && !guild.invitesDisabled) {
    try { await guild.disableInvites(true); state.invites = true; } catch (e) { console.error('[NightMode] pause des invitations :', e.message); }
  }
  cfg.night_state = { ...(cfg.night_state || {}), ...state };
  persist('configuration');
  await announce(guild, cfg, '🌙 **Mode nuit activé.** Les protections de nuit sont en place jusqu’à ' + (cfg.night_end || '08:00') + '.');
}

async function endNight(guild, cfg) {
  const st = cfg.night_state || {};
  for (const [id, v] of Object.entries(st.slow || {})) {
    const ch = guild.channels.cache.get(id);
    // Si un modérateur a changé le mode lent entre-temps, on ne l'écrase pas
    if (ch && typeof ch.setRateLimitPerUser === 'function' && (ch.rateLimitPerUser || 0) === v.set) {
      await ch.setRateLimitPerUser(v.prev, 'Fin du mode nuit').catch(() => { });
    }
  }
  if (st.invites) await guild.disableInvites(false).catch(() => { });
  cfg.night_state = { ...st, active: false, slow: {}, invites: false };
  persist('configuration');
  await announce(guild, cfg, '☀️ **Mode nuit terminé.** Les réglages habituels sont rétablis.');
}

/* ---------- Horaires des salons ---------- */
async function applySchedules(guild, cfg) {
  const list = Array.isArray(cfg.night_schedules) ? cfg.night_schedules : [];
  const local = localParts(cfg.night_schedule_tz || 'Europe/Paris');
  const states = cfg.night_sched_state || (cfg.night_sched_state = {});
  let changed = false;
  const known = new Set(list.map(s => String(s.channelId)));
  for (const id of Object.keys(states)) if (!known.has(id)) { delete states[id]; changed = true; } // horaire supprimé : on n'y touche plus
  for (const s of list) {
    const ch = guild.channels.cache.get(String(s.channelId));
    if (!ch?.permissionOverwrites) continue;
    const open = inWindow(s.open, s.close, s.days, local);
    const want = open ? 'open' : 'closed';
    if (states[ch.id] === want) continue;
    const voice = typeof ch.isVoiceBased === 'function' && ch.isVoiceBased();
    const perm = voice ? { Connect: open ? null : false } : { SendMessages: open ? null : false };
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone, perm, { reason: `Horaire de salon : ${open ? 'ouverture' : 'fermeture'}` });
      states[ch.id] = want; changed = true;
    } catch (e) { console.error('[NightMode] horaire de salon :', e.message); }
  }
  if (changed) persist('configuration');
}

/* ---------- Boucle principale ---------- */
async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      if (!cfg || typeof cfg !== 'object') continue;
      const want = isNightNow(cfg);
      const active = !!cfg.night_state?.active;
      if (want && !active) await startNight(guild, cfg);
      else if (!want && active) await endNight(guild, cfg);
      if ((Array.isArray(cfg.night_schedules) && cfg.night_schedules.length) || cfg.night_sched_state) await applySchedules(guild, cfg);
    } catch (e) {
      console.error(`[NightMode] ${guild.id} :`, e.message);
    }
  }
}

/* ---------- Filtres de messages ---------- */
const LINK_RE = /(https?:\/\/|www\.)\S+/i;
const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[\w-]+/i;

async function filterMessage(message) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
  const cfg = getGuildConfig(message.guild.id);
  if (!cfg.night_enabled || !cfg.night_state?.active) return;
  if (!cfg.night_block_links && !cfg.night_block_media && !cfg.night_block_invites) return;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (isExempt(member, cfg)) return;

  const days = Number(cfg.night_new_days) || 7;
  const isNew = member.joinedTimestamp && Date.now() - member.joinedTimestamp < days * 86400000;
  let why = null;
  if (cfg.night_block_invites && INVITE_RE.test(message.content || '')) why = 'les invitations vers d’autres serveurs sont bloquées';
  else if (isNew && cfg.night_block_links && LINK_RE.test(message.content || '')) why = 'les liens des nouveaux membres sont bloqués';
  else if (isNew && cfg.night_block_media && message.attachments.size > 0) why = 'les images et fichiers des nouveaux membres sont bloqués';
  if (!why) return;

  await message.delete().catch(() => { });
  const note = await message.channel.send({ content: `🌙 ${message.author}, mode nuit : ${why} jusqu’au matin.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => { }), 8000);
}

function registerNightModeHandler(client) {
  client.on('messageCreate', m => filterMessage(m).catch(e => console.error('[NightMode] filtre :', e.message)));
  let started = false;
  const start = () => { if (started) return; started = true; setInterval(() => tick(client), TICK_MS); setTimeout(() => tick(client), 5000); };
  if (client.isReady?.()) start();
  client.once('clientReady', start); // discord.js ≥ 14.22
  client.once('ready', start);       // versions plus anciennes
}

module.exports = { registerNightModeHandler, isNightActive, _test: { inWindow, localParts, isNightNow } };
