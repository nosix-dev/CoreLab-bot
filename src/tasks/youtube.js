const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Verrou mono-instance
// Empêche deux process Node (ex: ancien + nouveau après
// un restart mal terminé côté hébergeur) de faire tourner
// le checker YouTube en parallèle, ce qui provoque des
// notifications en double.
// ────────────────────────────────────────────────
const LOCK_PATH = path.join(__dirname, '..', 'data', 'youtube_checker.lock');
const LOCK_STALE_MS = 5 * 60 * 1000; // un verrou plus vieux que 5 min est considéré abandonné
let heartbeatInterval = null;
function pidEstVivant(pid) {
  try {
    process.kill(pid, 0); // n'envoie rien, teste juste l'existence du process
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // existe mais pas les droits → considéré vivant
  }
}
function ecrireVerrou() {
  fs.writeFileSync(LOCK_PATH, JSON.stringify({
    pid: process.pid,
    updatedAt: Date.now()
  }), 'utf8');
}
function acquireYoutubeLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK_PATH), {
      recursive: true
    });
  } catch (e) {
    console.error('[YouTube] Impossible de créer le dossier du verrou :', e.message);
  }

  // Écriture exclusive et atomique (flag 'wx' = échoue si le fichier existe déjà).
  // Contrairement à un existsSync() + writeFileSync() séparés, il n'y a ici
  // aucune fenêtre de race entre deux process qui démarreraient à quelques
  // millisecondes d'écart (ex : redémarrage en boucle côté hébergeur) —
  // c'était la cause des notifications YouTube postées en double/rafale.
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({
      pid: process.pid,
      updatedAt: Date.now()
    }), {
      flag: 'wx'
    });
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.error('[YouTube] Impossible d\'écrire le verrou :', e.message);
      return false; // par sécurité, on ne démarre pas si on ne peut pas garantir l'exclusivité
    }

    // Le verrou existe déjà : on vérifie s'il est encore valide.
    try {
      const raw = fs.readFileSync(LOCK_PATH, 'utf8');
      const data = JSON.parse(raw || '{}');
      const age = Date.now() - (data.updatedAt || 0);
      const autreVivant = data.pid && data.pid !== process.pid && pidEstVivant(data.pid);
      if (autreVivant && age < LOCK_STALE_MS) {
        console.warn(`[YouTube] Un autre process (PID ${data.pid}) gère déjà le checker YouTube. Démarrage annulé pour éviter les doublons.`);
        return false;
      }
      console.warn(`[YouTube] Verrou périmé ou process mort (PID ${data.pid}) — reprise du verrou.`);
      ecrireVerrou();
    } catch (e2) {
      console.error('[YouTube] Erreur lecture du verrou existant, démarrage annulé par sécurité :', e2.message);
      return false;
    }
  }

  // Heartbeat : rafraîchit le verrou pour qu'il ne soit jamais vu comme périmé
  // tant que ce process est vivant.
  heartbeatInterval = setInterval(() => {
    try {
      ecrireVerrou();
    } catch (e) {
      console.error('[YouTube] Erreur heartbeat verrou :', e.message);
    }
  }, 60000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();
  const liberer = () => {
    try {
      const raw = fs.readFileSync(LOCK_PATH, 'utf8');
      const data = JSON.parse(raw || '{}');
      if (data.pid === process.pid) fs.unlinkSync(LOCK_PATH);
    } catch { }
  };
  process.on('exit', liberer);
  process.on('SIGINT', () => {
    liberer();
    process.exit();
  });
  process.on('SIGTERM', () => {
    liberer();
    process.exit();
  });
  return true;
}

// ────────────────────────────────────────────────
// Résolution de l'ID de chaîne YouTube depuis une URL
// (channel/UC..., @handle, /c/, /user/, watch?v=, /shorts/, youtu.be)
// ────────────────────────────────────────────────
async function resolveYtChannelId(rawUrl) {
  let url = rawUrl.trim();
  const shortMatch = url.match(/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (shortMatch) url = `https://www.youtube.com/watch?v=${shortMatch[1]}`;
  const watchMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i);
  if (watchMatch) url = `https://www.youtube.com/watch?v=${watchMatch[1]}`;
  const shortsMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch) url = `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
  const channelMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
  if (channelMatch) return channelMatch[1];
  const handleMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/@([a-zA-Z0-9_.-]+)/i);
  const userMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:c|user)\/([a-zA-Z0-9_.-]+)/i);
  const handle = handleMatch ? handleMatch[1] : userMatch ? userMatch[1] : null;
  if (handle) url = `https://www.youtube.com/@${handle}`;
  if (!url.startsWith('http')) url = `https://${url}`;
  const attempts = [url, `${url}?pbj=1`];
  for (const attemptUrl of attempts) {
    try {
      const res = await fetch(attemptUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'x-youtube-client-name': '1',
          'x-youtube-client-version': '2.20201021.03.00'
        }
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (attemptUrl.endsWith('?pbj=1')) {
        const m1 = text.match(/"browse_id":"(UC[a-zA-Z0-9_-]{22})"/) || text.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/);
        if (m1) return m1[1];
      }
      const m2 = text.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/) || text.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (m2) return m2[1];
    } catch (e) {
      console.error('Erreur scrape YT:', e.message);
    }
  }
  return null;
}

// ────────────────────────────────────────────────
// Helpers de parsing
// ────────────────────────────────────────────────

// Décode une chaîne JSON échappée (\\u0026, \\", etc.) trouvée dans le HTML YouTube
function decodeYtString(raw) {
  if (raw == null) return '';
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return String(raw).replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
}
function decodeXmlEntities(text) {
  return String(text).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Extrait l'objet JSON complet qui suit `marker` (ex: '"videoDetails":'),
// en comptant les accolades (en ignorant celles des chaînes). Un simple
// /\{[^}]*\}/ s'arrêtait à la première "}" (objet "thumbnail"), ce qui coupait
// le bloc avant le champ "author" → « Chaîne inconnue ».
function extractJsonObject(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = text.indexOf('{', idx + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const limit = Math.min(text.length, start + 200000);
  for (let i = start; i < limit; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true; else if (c === '{') depth++; else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Nom de la chaîne via le flux RSS (titre du flux = nom de la chaîne)
async function fetchChannelName(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const m = xml.match(/<title>([\s\S]*?)<\/title>/);
    return m ? decodeXmlEntities(m[1]).trim() || null : null;
  } catch {
    return null;
  }
}

// Une vidéo du flux RSS est-elle un live (en cours ou programmé) ?
// Sert à ne PAS l'annoncer comme « Nouvelle vidéo » (c'est le rôle de la notif Live).
// Retourne null si on ne peut pas le déterminer (→ on traite comme une vidéo normale).
async function fetchVideoLiveState(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const vd = extractJsonObject(html, '"videoDetails":');
    if (!vd) return null;
    return {
      isLive: vd.isLive === true,
      isUpcoming: vd.isUpcoming === true
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Récupération de la dernière vidéo via le flux RSS
// ────────────────────────────────────────────────
async function fetchLatestVideo(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(18000)
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) return null;
    const entry = entryMatch[1];
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1] || '';
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Sans titre';
    const link = (entry.match(/<link rel="alternate" href="(.*?)"/) || [])[1] || `https://www.youtube.com/watch?v=${videoId}`;
    const feedTitle = (xml.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const author = (entry.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || feedTitle || 'Chaîne inconnue';
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || null;
    return {
      id: videoId,
      title: title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
      url: link,
      author: decodeXmlEntities(author),
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      publishedAt: published ? Date.parse(published) : null
    };
  } catch (e) {
    console.error(`Erreur fetch RSS YouTube (${channelId}):`, e.message);
    return null;
  }
}

// ────────────────────────────────────────────────
// Détection d'un live en cours sur la chaîne
// Scrape https://www.youtube.com/channel/{id}/live
// Retourne { id, title, url, author, thumbnail } si la chaîne est en direct,
// null sinon (stream planifié non commencé inclus, ou faux positif détecté → on ignore).
//
// IMPORTANT : on ne se fie plus à un simple "isLive":true trouvé n'importe où
// dans le HTML, car la page /live contient aussi des vidéos/lives RECOMMANDÉS
// d'autres chaînes (sidebar, "vous pourriez aimer") qui matchent ce pattern.
// On extrait le bloc "videoDetails" (spécifique à la vidéo actuellement
// affichée sur la page) et on vérifie que son channelId correspond bien
// à la chaîne demandée avant de considérer que c'est un vrai live.
// ────────────────────────────────────────────────
async function fetchCurrentLive(channelId, fallbackName = null) {
  const liveUrl = `https://www.youtube.com/channel/${channelId}/live`;
  try {
    const res = await fetch(liveUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extrait le bloc videoDetails COMPLET (comptage d'accolades), propre à la
    // vidéo réellement affichée sur cette page.
    let d = extractJsonObject(html, '"videoDetails":');
    if (!d) {
      // Repli : ancienne extraction par regex (champs situés avant "thumbnail")
      const vdMatch = html.match(/"videoDetails":\{[^}]*\}/);
      if (!vdMatch) return null;
      const vd = vdMatch[0];
      d = {
        videoId: (vd.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) || [])[1],
        channelId: (vd.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/) || [])[1],
        isLive: (vd.match(/"isLive":(true|false)/) || [])[1] === 'true',
        title: decodeYtString((vd.match(/"title":"((?:[^"\\]|\\.)*)"/) || [])[1])
      };
    }

    // Vérifie que le channelId de la vidéo correspond bien à la chaîne demandée.
    // Sans cette vérification, on peut remonter un live recommandé d'une
    // chaîne totalement différente.
    if (!d.channelId || d.channelId !== channelId) return null;

    // Vérifie que cette vidéo est bien EN DIRECT actuellement.
    if (d.isLive !== true) return null;
    const videoId = d.videoId && /^[a-zA-Z0-9_-]{11}$/.test(d.videoId) ? d.videoId : null;
    if (!videoId) return null;
    const title = (d.title || 'Live en cours').trim();

    // Nom de la chaîne : videoDetails.author, sinon ownerChannelName, sinon
    // titre du flux RSS, sinon le nom déjà enregistré pour cette notif.
    let author = d.author ? String(d.author).trim() : '';
    if (!author) {
      const owner = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/);
      if (owner) author = decodeYtString(owner[1]).trim();
    }
    if (!author) author = (await fetchChannelName(channelId)) || '';
    if (!author) author = fallbackName || 'Chaîne inconnue';
    return {
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      isLive: true
    };
  } catch (e) {
    console.error(`Erreur fetch live YouTube (${channelId}):`, e.message);
    return null;
  }
}

// Cache mémoire anti-doublon (en plus de la sauvegarde JSON)
const sentIds = new Set();

// Verrou anti-chevauchement : évite que deux exécutions se marchent dessus
let isChecking = false;

// Verrou anti-démarrage multiple : évite que startYoutubeChecker() soit lancé
// plusieurs fois (ex: client.on('ready') qui se redéclenche après reconnexion)
let intervalStarted = false;

// Combien d'IDs vidéo récents on garde en historique par notif,
// pour ne pas dépendre d'un seul lastVideoId (plus robuste en cas
// d'écriture concurrente entre deux process).
const HISTORIQUE_MAX = 5;
function marquerVideoEnvoyee(notif, videoId) {
  if (!Array.isArray(notif.recentVideoIds)) {
    notif.recentVideoIds = notif.lastVideoId ? [notif.lastVideoId] : [];
  }
  if (!notif.recentVideoIds.includes(videoId)) {
    notif.recentVideoIds.push(videoId);
    if (notif.recentVideoIds.length > HISTORIQUE_MAX) {
      notif.recentVideoIds = notif.recentVideoIds.slice(-HISTORIQUE_MAX);
    }
  }
  notif.lastVideoId = videoId; // conservé pour compat/affichage
}
function videoDejaEnvoyee(notif, videoId) {
  if (Array.isArray(notif.recentVideoIds) && notif.recentVideoIds.includes(videoId)) return true;
  return notif.lastVideoId === videoId;
}

// ────────────────────────────────────────────────
// Nettoyage des doublons dans store.ytNotifs
// (plusieurs entrées avec le même channelId Discord + même ytChannelId)
// ────────────────────────────────────────────────
// Les anciennes entrées sans `type` faisaient live + vidéo ensemble (et n'apparaissaient
// dans aucune liste). On les sépare : une entrée « vidéo » + une entrée « live ».
function migrateLegacyYtNotifs() {
  let changed = false;
  for (const [guildId, notifs] of Object.entries(store.ytNotifs || {})) {
    if (!Array.isArray(notifs)) continue;
    if (!notifs.some(n => n && n.type === undefined)) continue;
    const migrated = [];
    for (const notif of notifs) {
      if (notif && notif.type === undefined) {
        migrated.push({
          ...notif,
          type: 'video'
        });
        migrated.push({
          ...notif,
          type: 'live',
          lastLiveId: notif.lastLiveId || ''
        });
      } else {
        migrated.push(notif);
      }
    }
    store.ytNotifs[guildId] = migrated;
    changed = true;
  }
  if (changed) {
    persist('ytNotifs');
    console.log('[YouTube] Anciennes notifications séparées en Live + Vidéo');
  }
}
function dedupeYtNotifs() {
  migrateLegacyYtNotifs();
  let changed = false;
  for (const [guildId, notifs] of Object.entries(store.ytNotifs || {})) {
    if (!Array.isArray(notifs)) continue;
    const seen = new Set();
    const cleaned = [];
    for (const notif of notifs) {
      const dupKey = `${notif.ytChannelId || notif.url}_${notif.channelId}_${notif.type || 'all'}`;
      if (seen.has(dupKey)) {
        changed = true;
        continue; // entrée en double, on la retire
      }
      seen.add(dupKey);
      cleaned.push(notif);
    }
    if (cleaned.length !== notifs.length) {
      store.ytNotifs[guildId] = cleaned;
    }
  }
  if (changed) {
    persist('ytNotifs');
    console.log('[YouTube] Doublons supprimés de store.ytNotifs');
  }
}

// ────────────────────────────────────────────────
// Vérification et envoi des notifications
// ────────────────────────────────────────────────
async function checkYoutubeNotifications(client) {
  if (isChecking) return; // un check est déjà en cours → on skip celui-ci
  isChecking = true;
  try {
    await runCheck(client);
  } finally {
    isChecking = false;
  }
}
async function runCheck(client) {
  dedupeYtNotifs();
  for (const [guildId, notifs] of Object.entries(store.ytNotifs)) {
    if (!Array.isArray(notifs)) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    let modified = false;
    const seen = new Set();
    for (const notif of notifs) {
      const dupKey = `${notif.ytChannelId}_${notif.channelId}_${notif.type || 'all'}`;
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      try {
        if (!notif.ytChannelId) continue; // ancienne entrée pas encore résolue

        const discordCh = guild.channels.cache.get(notif.channelId);
        if (!discordCh) continue;

        // ── 1. Vérification des LIVES en cours ──────────────────
        // N'envoyer la notif live que si notif.type est 'live' (ou non défini pour compatibilité)
        if (notif.type === undefined || notif.type === 'live') {
          const live = await fetchCurrentLive(notif.ytChannelId, notif.channelName);
          if (live && live.id) {
            const liveCacheKey = `live_${guildId}_${notif.ytChannelId}_${live.id}`;
            const alreadySentLive = sentIds.has(liveCacheKey) || notif.lastLiveId === live.id;
            if (!alreadySentLive) {
              sentIds.add(liveCacheKey);
              notif.lastLiveId = live.id;
              if (live.author && live.author !== 'Chaîne inconnue') notif.channelName = live.author;
              modified = true;
              persist('ytNotifs');
              const liveEmbed = new EmbedBuilder().setTitle(`🔴 ${live.title}`).setColor(0xFF5959).setDescription(`**${live.author}** est en direct maintenant !`).setImage(live.thumbnail).setFooter({
                text: 'YouTube • Live en cours'
              }).setTimestamp();

              // Bouton pour regarder le live
              const liveButton = new ButtonBuilder()
                .setLabel('🔴 Regarder le live')
                .setURL(live.url)
                .setStyle(ButtonStyle.Link);
              const liveRow = new ActionRowBuilder().addComponents(liveButton);

              await discordCh.send({
                content: `🔴 **${live.author} est en LIVE !**`,
                embeds: [liveEmbed],
                components: [liveRow]
              });
            }
          }
        }

        // ── 2. Vérification des VIDÉOS (RSS) ────────────────────
        // N'envoyer la notif vidéo que si notif.type est 'video' (ou non défini pour compatibilité)
        if (notif.type === undefined || notif.type === 'video') {
          // On relit toujours l'état le plus frais depuis le disque
          // juste avant de décider d'envoyer, pour limiter la fenêtre
          // de race condition si un autre process a écrit entre-temps.
          const notifFrais = (store.ytNotifs[guildId] || []).find(n => n.ytChannelId === notif.ytChannelId && n.channelId === notif.channelId) || notif;
          const latest = await fetchLatestVideo(notif.ytChannelId);
          if (!latest || !latest.id) {
            // continue implicite du bloc if
          } else if (videoDejaEnvoyee(notifFrais, latest.id) || sentIds.has(`${guildId}_${notif.ytChannelId}_${latest.id}`)) {
            // continue implicite du bloc if
          } else {
            const cacheKey = `${guildId}_${notif.ytChannelId}_${latest.id}`;
            // On marque comme envoyé et on persiste AVANT le send,
            // pour qu'un check concurrent (autre process) ne double-poste pas.
            sentIds.add(cacheKey);
            marquerVideoEnvoyee(notif, latest.id);
            modified = true;
            persist('ytNotifs');

            // Live (en cours ou programmé) : c'est le rôle de la notif Live,
            // on ne l'annonce pas comme « Nouvelle vidéo ».
            const liveState = await fetchVideoLiveState(latest.id);
            if (liveState && (liveState.isLive || liveState.isUpcoming)) continue;
            const embed = new EmbedBuilder().setTitle(latest.title).setColor(0xFF5959).setDescription(`**${latest.author}** vient de publier une nouvelle vidéo !`).setImage(latest.thumbnail).setFooter({
              text: 'YouTube • Nouvelle vidéo'
            }).setTimestamp();

            // Bouton pour regarder la vidéo
            const videoButton = new ButtonBuilder()
              .setLabel('▶️ Regarder la vidéo')
              .setURL(latest.url)
              .setStyle(ButtonStyle.Link);
            const videoRow = new ActionRowBuilder().addComponents(videoButton);

            await discordCh.send({
              content: `🔔 **Nouvelle vidéo de ${latest.author} !**`,
              embeds: [embed],
              components: [videoRow]
            });
          }
        }
      } catch (e) {
        console.error(`Erreur YT notif (${notif.ytChannelId}):`, e.message);
      }
    }
    if (modified) persist('ytNotifs');
  }
}

// ────────────────────────────────────────────────
// Démarrage protégé : à appeler UNE SEULE FOIS au boot du bot
// (ex: dans un client.once('ready', ...), pas client.on)
// ────────────────────────────────────────────────
function startYoutubeChecker(client, intervalMs = 60000) {
  if (intervalStarted) {
    console.warn('[YouTube] startYoutubeChecker() déjà appelé, appel ignoré.');
    return;
  }
  if (!acquireYoutubeLock()) {
    // Un autre process gère déjà le checker : on ne démarre pas de
    // deuxième boucle pour éviter les notifications en double.
    return;
  }
  intervalStarted = true;
  dedupeYtNotifs();
  setInterval(() => {
    if (!client.isReady()) return;
    checkYoutubeNotifications(client).catch(e => console.error('[YouTube] Erreur boucle:', e.message));
  }, intervalMs);
}
module.exports = {
  resolveYtChannelId,
  fetchLatestVideo,
  fetchCurrentLive,
  fetchChannelName,
  checkYoutubeNotifications,
  startYoutubeChecker,
  dedupeYtNotifs
};