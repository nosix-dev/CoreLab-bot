'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Suivi de l'activité des serveurs pour /server-stats et /user-stats :
//  • messages par jour / heure / salon / membre
//  • minutes passées en vocal
//  • arrivées / départs de membres
//
// Stockage : tables SQLite activity_* (voir activityStore.js). Les compteurs sont cumulés en mémoire,
// écrits par lots toutes les ~10 s et à l'arrêt du bot ; les /server-stats et /user-stats sont des requêtes SQL.
// Les stats commencent à être comptées à partir du déploiement de ce module.
// ─────────────────────────────────────────────────────────────────────────

const store = require('./activityStore');

const TZ = process.env.STATS_TZ || 'Europe/Paris'; // fuseau pour découper les jours / heures
const RETENTION_DAYS = 45;                         // on garde 45 jours d'historique
const VOICE_TICK_MS = 5 * 60 * 1000;
const VOICE_MAX_SESSION_MS = 12 * 60 * 60 * 1000;

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

// ── Enregistrement des évènements (cumulés en mémoire, écrits en base par lots) ──
function recordMessage(guildId, userId, channelId) {
  const { day, hour } = localParts();
  store.ajouterMessage(guildId, day, hour, channelId, userId);
}

function recordJoin(guildId) {
  store.ajouterArrivee(guildId, localParts().day);
}

function recordLeave(guildId) {
  store.ajouterDepart(guildId, localParts().day);
}

function recordVoiceMinutes(guildId, userId, minutes) {
  if (!(minutes > 0)) return;
  store.ajouterVocal(guildId, localParts().day, userId, minutes);
}

// ── Lecture / agrégation (requêtes SQL, voir activityStore.js) ───────────
/**
 * Agrège les `days` derniers jours.
 * @param {string} guildId
 * @param {number} days
 * @param {string|null} userId  si fourni : stats de ce membre uniquement (messages / salons / heures / vocal)
 */
function summarize(guildId, days, userId = null) {
  const keys = dayKeysBack(days);
  const r = store.resume(guildId, keys, userId);
  const { perDay, hours, topUsers } = r;

  const total = perDay.reduce((a, b) => a + b, 0);
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
    topChannels: r.topChannels,
    hours,
    peakHour: peak,
    bestDayIndex: best,
    activeDays,
    joins: r.joins,
    leaves: r.leaves,
    voiceMinutes: r.voice,
    rank: userId ? (topUsers.findIndex(([id]) => id === userId) + 1 || null) : null,
    rankedCount: topUsers.length
  };
}

/**
 * Séries jour par jour (pour les graphiques du dashboard web) sur les `days` derniers jours.
 * @returns {{keys:string[], messages:number[], voice:number[], joins:number[], leaves:number[]}}
 */
function dailySeries(guildId, days) {
  const keys = dayKeysBack(days);
  return { keys, ...store.serie(guildId, keys) };
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

  const arret = () => { for (const key of [...voiceSessions.keys()]) { const [g, u] = key.split(':'); endVoice(g, u); } store.flush(); };
  process.once('SIGTERM', arret);
  process.once('SIGINT', arret);
  process.once('beforeExit', () => store.flush());

  // Au démarrage : crée les tables, migre l'ancien JSON, purge ce qui dépasse la rétention (puis 1 fois par jour)
  try {
    store.init();
    store.purger(dayKeysBack(RETENTION_DAYS)[0]);
    setInterval(() => store.purger(dayKeysBack(RETENTION_DAYS)[0]), 24 * 3600 * 1000).unref();
  } catch (e) {
    console.error('[ActivityStats] initialisation de la base :', e.message);
  }

  console.log('✅ Suivi des statistiques d\'activité initialisé (messages, vocal, arrivées/départs).');
}

module.exports = {
  registerActivityStatsHandler,
  summarize,
  dailySeries,
  localParts,
  TZ
};