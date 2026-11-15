'use strict';
/**
 * API « Notifications » du dashboard web : lister, ajouter, mettre en pause, personnaliser, retirer
 * les notifications suivies (YouTube Live/Vidéos, Twitch, TikTok, Instagram, Medal).
 * Mêmes données que la commande /notification (store.*Notifs) : les deux restent synchronisés.
 */
const crypto = require('crypto');
const { store, persist } = require('./data');
const { nettoyerCustom } = require('./notifCustom');

const PLATEFORMES = {
  'youtube-live':  { key: 'ytNotifs',        label: 'YouTube · Live',     type: 'live' },
  'youtube-video': { key: 'ytNotifs',        label: 'YouTube · Vidéos',   type: 'video' },
  twitch:          { key: 'twitchNotifs',    label: 'Twitch' },
  tiktok:          { key: 'tiktokNotifs',    label: 'TikTok' },
  instagram:       { key: 'instagramNotifs', label: 'Instagram' },
  medal:           { key: 'medalNotifs',     label: 'Medal' }
  // Blog volontairement absent : aucune tâche du bot ne publie encore ces notifications.
};
const CLES = [...new Set(Object.values(PLATEFORMES).map(p => p.key))];

function bucket(guildId, key) {
  if (!store[key]) store[key] = {};
  if (!Array.isArray(store[key][guildId])) store[key][guildId] = [];
  return store[key][guildId];
}

function plateformeDe(key, entry) {
  if (key === 'ytNotifs') return entry.type === 'live' ? 'youtube-live' : 'youtube-video';
  return Object.keys(PLATEFORMES).find(k => PLATEFORMES[k].key === key);
}

function nomDe(key, e) {
  switch (key) {
    case 'ytNotifs': return e.channelName || e.url || e.ytChannelId || '?';
    case 'twitchNotifs': return e.displayName || e.twitchName || '?';
    case 'tiktokNotifs': case 'instagramNotifs': return e.username ? '@' + e.username : (e.url || '?');
    case 'medalNotifs': return e.url || e.medalUserId || '?';
    default: return e.url || '?';
  }
}

/** Liste à plat de toutes les notifications du serveur (assigne un id stable aux anciennes entrées). */
function lister(guildId) {
  const items = [];
  const dirty = new Set();
  for (const key of CLES) {
    for (const e of bucket(guildId, key)) {
      if (!e.id) { e.id = crypto.randomBytes(5).toString('hex'); dirty.add(key); }
      const platform = plateformeDe(key, e);
      items.push({
        id: e.id, platform, label: PLATEFORMES[platform].label, name: nomDe(key, e), url: e.url || '',
        channelId: e.channelId || '', enabled: e.enabled !== false, custom: e.custom || {}
      });
    }
  }
  for (const k of dirty) persist(k);
  return items;
}

function trouver(guildId, id) {
  for (const key of CLES) {
    const arr = bucket(guildId, key);
    const idx = arr.findIndex(e => e && e.id === id);
    if (idx >= 0) return { key, arr, idx, entry: arr[idx] };
  }
  return null;
}

const salonValide = (guild, id) => {
  const c = guild.channels.cache.get(String(id));
  return !!c && [0, 5].includes(c.type);
};
const roleValide = (guild, id) => {
  const r = guild.roles.cache.get(String(id));
  return !!r && r.id !== guild.id;
};

async function ajouter(guild, body) {
  const pf = PLATEFORMES[body.platform];
  if (!pf) return { code: 400, body: { error: 'invalid', reason: 'Plateforme inconnue.' } };
  const url = String(body.url || '').trim().slice(0, 300);
  if (!url) return { code: 400, body: { error: 'invalid', reason: 'Indiquez l’URL ou le pseudo.' } };
  if (!salonValide(guild, body.channelId)) return { code: 400, body: { error: 'invalid', reason: 'Choisissez un salon textuel du serveur.' } };
  const channelId = String(body.channelId);
  const arr = bucket(guild.id, pf.key);
  const base = { id: crypto.randomBytes(5).toString('hex'), channelId };
  const dejaMsg = { code: 409, body: { error: 'invalid', reason: 'Déjà suivie dans ce salon.' } };
  const introuvable = reason => ({ code: 400, body: { error: 'invalid', reason } });

  if (body.platform === 'youtube-live' || body.platform === 'youtube-video') {
    if (!/youtube\.com|youtu\.be/i.test(url)) return introuvable('URL YouTube invalide.');
    const { resolveYtChannelId, fetchLatestVideo } = require('../tasks/youtube');
    const ytChannelId = await resolveYtChannelId(url);
    if (!ytChannelId) return introuvable('Chaîne YouTube introuvable. Collez l’URL de la chaîne (youtube.com/@nom).');
    if (arr.some(n => n.ytChannelId === ytChannelId && n.channelId === channelId && n.type === pf.type)) return dejaMsg;
    const latest = await fetchLatestVideo(ytChannelId).catch(() => null);
    arr.push({ ...base, url, ytChannelId, channelName: latest ? latest.author : url, type: pf.type, lastVideoId: latest ? latest.id : '', lastLiveId: '' });
  } else if (body.platform === 'twitch') {
    const { resolveTwitchUser } = require('../tasks/twitch');
    const m = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
    const nom = (m ? m[1] : url.replace(/^@/, '')).trim();
    if (!/^[a-zA-Z0-9_]{2,40}$/.test(nom)) return introuvable('Pseudo Twitch invalide.');
    const user = await resolveTwitchUser(nom);
    if (!user) return introuvable('Chaîne Twitch introuvable.');
    if (arr.some(n => (n.twitchName || '').toLowerCase() === user.login.toLowerCase() && n.channelId === channelId)) return dejaMsg;
    arr.push({ ...base, twitchName: user.login, displayName: user.display_name, wasLive: false });
  } else if (body.platform === 'tiktok') {
    const { resolveTiktokUsername, fetchLatestVideo } = require('../tasks/tiktok');
    const username = await resolveTiktokUsername(url);
    if (!username) return introuvable('Compte TikTok introuvable (https://www.tiktok.com/@pseudo ou @pseudo).');
    if (arr.some(n => n.username === username && n.channelId === channelId)) return dejaMsg;
    const latest = await fetchLatestVideo(username).catch(() => null);
    arr.push({ ...base, url, username, lastVideoId: latest ? latest.id : '' });
  } else if (body.platform === 'instagram') {
    const { resolveInstagramUsername, fetchLatestPost } = require('../tasks/instagram');
    const username = resolveInstagramUsername(url);
    if (!username) return introuvable('Compte Instagram introuvable (instagram.com/pseudo ou @pseudo).');
    if (arr.some(n => n.username === username && n.channelId === channelId)) return dejaMsg;
    const latest = await fetchLatestPost(username).catch(() => null);
    arr.push({ ...base, url, username, userId: latest ? latest.userId : '', lastPostId: latest ? latest.id : '' });
  } else if (body.platform === 'medal') {
    const { resolveMedalUserId, fetchLatestClip } = require('../tasks/medal');
    const medalUserId = resolveMedalUserId(url);
    if (!medalUserId) return introuvable('URL Medal invalide (format https://medal.tv/users/ID).');
    if (arr.some(n => n.medalUserId === medalUserId && n.channelId === channelId)) return dejaMsg;
    const latest = await fetchLatestClip(medalUserId).catch(() => null);
    arr.push({ ...base, url, medalUserId, lastClipId: latest ? latest.id : '' });
  }
  persist(pf.key);
  return { code: 200, body: { ok: true, items: lister(guild.id) } };
}

/** Quand une notification reprend, on se cale sur le dernier contenu pour ne pas poster ce qui est sorti pendant la pause. */
async function resynchroniser(key, e) {
  try {
    if (key === 'ytNotifs' && e.type !== 'live' && e.ytChannelId) {
      const l = await require('../tasks/youtube').fetchLatestVideo(e.ytChannelId); if (l && l.id) e.lastVideoId = l.id;
    } else if (key === 'tiktokNotifs' && e.username) {
      const l = await require('../tasks/tiktok').fetchLatestVideo(e.username); if (l && l.id) e.lastVideoId = l.id;
    } else if (key === 'instagramNotifs' && e.username) {
      const l = await require('../tasks/instagram').fetchLatestPost(e.username, e.userId); if (l && l.id) e.lastPostId = l.id;
    } else if (key === 'medalNotifs' && e.medalUserId) {
      const l = await require('../tasks/medal').fetchLatestClip(e.medalUserId); if (l && l.id) e.lastClipId = l.id;
    } else if (key === 'twitchNotifs') {
      e.wasLive = false;
    }
  } catch { /* on garde l'état précédent */ }
}

async function modifier(guild, body) {
  const f = trouver(guild.id, String(body.id || ''));
  if (!f) return { code: 404, body: { error: 'not_found' } };
  const e = f.entry;
  if (body.channelId !== undefined) {
    if (!salonValide(guild, body.channelId)) return { code: 400, body: { error: 'invalid', reason: 'Salon introuvable.' } };
    e.channelId = String(body.channelId);
  }
  if (body.custom !== undefined) {
    const c = nettoyerCustom(body.custom);
    if (c.mention && /^\d+$/.test(c.mention) && !roleValide(guild, c.mention)) return { code: 400, body: { error: 'invalid', reason: 'Rôle à mentionner introuvable.' } };
    if (Object.keys(c).length) e.custom = c; else delete e.custom;
  }
  if (body.enabled !== undefined) {
    const on = !!body.enabled;
    if (on && e.enabled === false) await resynchroniser(f.key, e);
    if (on) delete e.enabled; else e.enabled = false;
  }
  persist(f.key);
  return { code: 200, body: { ok: true, items: lister(guild.id) } };
}

function retirer(guild, body) {
  const f = trouver(guild.id, String(body.id || ''));
  if (!f) return { code: 404, body: { error: 'not_found' } };
  f.arr.splice(f.idx, 1);
  persist(f.key);
  return { code: 200, body: { ok: true, items: lister(guild.id) } };
}

async function handle({ guild, method, body, premium }) {
  if (method === 'GET') {
    let max = null;
    try {
      const c = require('./constants');
      const m = premium ? c.MAX_NOTIFICATIONS_PREMIUM : c.MAX_NOTIFICATIONS_GRATUIT;
      if (Number.isFinite(m)) max = m;
    } catch { /* pas de quota défini */ }
    return { code: 200, body: { items: lister(guild.id), max, premium: !!premium } };
  }
  if (method !== 'POST') return { code: 405, body: { error: 'method' } };
  if (body.action === 'add') {
    let max = null;
    try {
      const c = require('./constants');
      const m = premium ? c.MAX_NOTIFICATIONS_PREMIUM : c.MAX_NOTIFICATIONS_GRATUIT;
      if (Number.isFinite(m)) max = m;
    } catch { /* pas de quota défini */ }
    if (max !== null && lister(guild.id).length >= max) {
      return { code: 403, body: { error: 'invalid', reason: `Limite de ${max} notification(s) atteinte${premium ? '' : ' (le Premium en offre davantage)'}.` } };
    }
    return ajouter(guild, body);
  }
  if (body.action === 'update') return modifier(guild, body);
  if (body.action === 'remove') return retirer(guild, body);
  return { code: 400, body: { error: 'invalid', reason: 'Action inconnue.' } };
}

module.exports = { handle, lister, PLATEFORMES };
