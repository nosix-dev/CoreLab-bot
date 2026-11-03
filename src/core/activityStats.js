'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Suivi de l'activité des serveurs pour /server-stats et /user-stats :
//  • messages par jour / heure / salon / membre
//  • minutes passées en vocal
//  • arrivées / départs de membres
//
// Stockage : activity_stats.json (dans DATA_DIR si défini → survit aux redéploiements).
// Écriture asynchrone avec délai (pas de writeFileSync bloquant pendant l'exécution)
// + sauvegarde synchrone à l'arrêt du bot.
// Les stats commencent à être comptées à partir du déploiement de ce module.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const { fichierPersistant } = require('./persistentPath');

const FILE = fichierPersistant('activity_stats.json');
const TZ = process.env.STATS_TZ || 'Europe/Paris'; // fuseau pour découper les jours / heures
const RETENTION_DAYS = 45;                         // on garde 45 jours d'historique
const SAVE_DELAY_MS = 20 * 1000;
const VOICE_TICK_MS = 5 * 60 * 1000;
const VOICE_MAX_SESSION_MS = 12 * 60 * 60 * 1000;

let store = { guilds: {} };
try {
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error('[ActivityStats] lecture impossible, nouveau fichier :', e.message);
}
if (!store || typeof store !== 'object' || !store.guilds) store = { guilds: {} };

// ── Dates (jour / heure locaux dans le fuseau TZ) ───────────────────────
let formatter;
try {
  formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  });
} catch {
  formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  });
}

function localParts(ts = Date.now()) {
  const p = {};
  for (const part of formatter.formatToParts(new Date(ts))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

// Clés de jour (AAAA-MM-JJ) des `n` derniers jours, du plus ancien au plus récent (aujourd'hui inclus)
function dayKeysBack(n) {
  const [y, m, d] = localParts().day.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  }
  return out;
}

// ── Écriture sur disque ────────────────────────────────────────────────
let dirty = false;
let saveTimer = null;
let saving = false;

function prune() {
  const cutoff = dayKeysBack(RETENTION_DAYS)[0];
  for (const g of Object.values(store.guilds)) {
    for (const key of Object.keys(g.days || {})) {
      if (key < cutoff) delete g.days[key];
    }
  }
}

async function saveAsync() {
  if (saving || !dirty) return;
  saving = true;
  dirty = false;
  try {
    prune();
    const tmp = `${FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(store), 'utf8');
    await fs.promises.rename(tmp, FILE);
  } catch (e) {
    dirty = true;
    console.error('[ActivityStats] sauvegarde impossible :', e.message);
  } finally {
    saving = false;
  }
}

function saveSync() {
  if (!dirty) return;
  try {
    prune();
    fs.writeFileSync(FILE, JSON.stringify(store), 'utf8');
    dirty = false;
  } catch (e) {
    console.error('[ActivityStats] sauvegarde finale impossible :', e.message);
  }
}

function markDirty() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveAsync();
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

// ── Accès aux données ───────────────────────────────────────────────────
function getDay(guildId, day) {
  const g = store.guilds[guildId] || (store.guilds[guildId] = { days: {} });
  if (!g.days) g.days = {};
  return g.days[day] || (g.days[day] = { t: 0, h: {}, c: {}, u: {}, j: 0, l: 0, v: 0 });
}

function getUserDay(d, userId) {
  return d.u[userId] || (d.u[userId] = { n: 0, c: {}, h: {}, v: 0 });
}

// ── Enregistrement des évènements ───────────────────────────────────────
function recordMessage(guildId, userId, channelId) {
  const { day, hour } = localParts();
  const d = getDay(guildId, day);
  d.t++;
  d.h[hour] = (d.h[hour] || 0) + 1;
  d.c[channelId] = (d.c[channelId] || 0) + 1;
  const u = getUserDay(d, userId);
  u.n++;
  u.c[channelId] = (u.c[channelId] || 0) + 1;
  u.h[hour] = (u.h[hour] || 0) + 1;
  markDirty();
}

function recordJoin(guildId) {
  getDay(guildId, localParts().day).j++;
  markDirty();
}

function recordLeave(guildId) {
  getDay(guildId, localParts().day).l++;
  markDirty();
}

function recordVoiceMinutes(guildId, userId, minutes) {
  if (!(minutes > 0)) return;
  const d = getDay(guildId, localParts().day);
  d.v += minutes;
  getUserDay(d, userId).v += minutes;
  markDirty();
}

// ── Lecture / agrégation ────────────────────────────────────────────────
const sortDesc = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);

/**
 * Agrège les `days` derniers jours.
 * @param {string} guildId
 * @param {number} days
 * @param {string|null} userId  si fourni : stats de ce membre uniquement (messages / salons / heures / vocal)
 */
function summarize(guildId, days, userId = null) {
  const g = store.guilds[guildId];
  const keys = dayKeysBack(days);
  const perDay = [];
  const hours = Array(24).fill(0);
  const channels = {};
  const users = {};
  let joins = 0, leaves = 0, voice = 0;

  for (const key of keys) {
    const d = g?.days?.[key];
    let n = 0;
    if (d) {
      joins += d.j || 0;
      leaves += d.l || 0;
      if (userId) {
        const u = d.u?.[userId];
        if (u) {
          n = u.n || 0;
          voice += u.v || 0;
          for (const [h, c] of Object.entries(u.h || {})) hours[Number(h)] += c;
          for (const [ch, c] of Object.entries(u.c || {})) channels[ch] = (channels[ch] || 0) + c;
        }
      } else {
        n = d.t || 0;
        voice += d.v || 0;
        for (const [h, c] of Object.entries(d.h || {})) hours[Number(h)] += c;
        for (const [ch, c] of Object.entries(d.c || {})) channels[ch] = (channels[ch] || 0) + c;
      }
      for (const [uid, u] of Object.entries(d.u || {})) {
        if (u.n) users[uid] = (users[uid] || 0) + u.n;
      }
    }
    perDay.push(n);
  }

  const total = perDay.reduce((a, b) => a + b, 0);
  const topUsers = sortDesc(users);
  const best = perDay.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
  const peak = hours.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
  const activeDays = perDay.filter(v => v > 0).length;

  return {
    keys,
    perDay,
    total,
    avg: total / days,
    activeUsers: topUsers.length,
    topUsers,
    topChannels: sortDesc(channels),
    hours,
    peakHour: peak,
    bestDayIndex: best,
    activeDays,
    joins,
    leaves,
    voiceMinutes: voice,
    rank: userId ? (topUsers.findIndex(([id]) => id === userId) + 1 || null) : null,
    rankedCount: topUsers.length
  };
}

// ── Branchement sur le client Discord ───────────────────────────────────
const voiceSessions = new Map(); // `${guildId}:${userId}` → timestamp de début

function startVoice(guildId, userId) {
  voiceSessions.set(`${guildId}:${userId}`, Date.now());
}

function endVoice(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const start = voiceSessions.get(key);
  voiceSessions.delete(key);
  if (!start) return;
  const ms = Math.min(Date.now() - start, VOICE_MAX_SESSION_MS);
  recordVoiceMinutes(guildId, userId, ms / 60000);
}

function eligibleVoice(state) {
  if (!state?.channelId || state.member?.user?.bot) return false;
  return state.guild?.afkChannelId !== state.channelId;
}

function registerActivityStatsHandler(client) {
  client.on('messageCreate', message => {
    try {
      if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
      const ch = message.channel;
      const channelId = ch?.isThread?.() ? (ch.parentId || ch.id) : ch.id;
      recordMessage(message.guild.id, message.author.id, channelId);
    } catch (e) {
      console.error('[ActivityStats] messageCreate :', e.message);
    }
  });

  client.on('guildMemberAdd', member => {
    try { if (!member.user?.bot) recordJoin(member.guild.id); } catch (e) { console.error('[ActivityStats] join :', e.message); }
  });
  client.on('guildMemberRemove', member => {
    try { if (!member.user?.bot) recordLeave(member.guild.id); } catch (e) { console.error('[ActivityStats] leave :', e.message); }
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    try {
      const guildId = newState.guild?.id || oldState.guild?.id;
      const userId = newState.id || oldState.id;
      if (!guildId || !userId) return;
      const was = eligibleVoice(oldState);
      const now = eligibleVoice(newState);
      if (was && !now) endVoice(guildId, userId);
      else if (!was && now) startVoice(guildId, userId);
    } catch (e) {
      console.error('[ActivityStats] voiceStateUpdate :', e.message);
    }
  });

  // Reprise des membres déjà en vocal au démarrage du bot
  const init = () => {
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        if (eligibleVoice(state)) startVoice(guild.id, state.id);
      }
    }
  };
  if (client.isReady()) init();
  else client.once('clientReady', init);

  // Toutes les 5 min : on crédite le temps vocal écoulé (évite de tout perdre en cas de redémarrage)
  setInterval(() => {
    const now = Date.now();
    for (const [key, start] of voiceSessions) {
      const [guildId, userId] = key.split(':');
      recordVoiceMinutes(guildId, userId, Math.min(now - start, VOICE_MAX_SESSION_MS) / 60000);
      voiceSessions.set(key, now);
    }
  }, VOICE_TICK_MS).unref();

  process.once('SIGTERM', () => { for (const key of [...voiceSessions.keys()]) { const [g, u] = key.split(':'); endVoice(g, u); } saveSync(); });
  process.once('SIGINT', () => { for (const key of [...voiceSessions.keys()]) { const [g, u] = key.split(':'); endVoice(g, u); } saveSync(); });
  process.once('beforeExit', saveSync);

  console.log('✅ Suivi des statistiques d\'activité initialisé (messages, vocal, arrivées/départs).');
}

module.exports = {
  registerActivityStatsHandler,
  summarize,
  localParts,
  TZ
};
