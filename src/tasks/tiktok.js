const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require('discord.js');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Récupération des vidéos TikTok via l'API RapidAPI "TikTok Scraper7"
// (fournisseur tikwm) : https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7
// Nécessite la variable d'environnement RAPIDAPI_KEY.
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const RAPIDAPI_HOST = 'tiktok-scraper7.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
};

// ────────────────────────────────────────────────
// Résolution du pseudo TikTok (sans @) depuis une URL ou un pseudo brut
// ────────────────────────────────────────────────
async function resolveTiktokUsername(rawUrl) {
  let url = rawUrl.trim();

  // Pseudo brut fourni directement ("@pseudo" ou "pseudo")
  if (/^@?[a-zA-Z0-9._]{2,24}$/.test(url) && !url.includes('/') && !url.includes('.com')) {
    return url.replace(/^@/, '');
  }

  // Lien court (vm.tiktok.com / vt.tiktok.com) : il faut suivre la redirection
  if (/(?:vm|vt)\.tiktok\.com\//i.test(url)) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      url = res.url || url;
    } catch (e) {
      console.error('[TikTok] Erreur résolution lien court:', e.message);
      return null;
    }
  }
  const match = url.match(/tiktok\.com\/@([a-zA-Z0-9._]+)/i);
  if (match) return match[1];
  return null;
}

// Normalise un objet "vidéo" renvoyé par l'API RapidAPI (tolère les
// variantes de nommage de champs selon les versions de l'API).
function normaliserItem(item, usernameFallback) {
  if (!item) return null;
  const id = item.video_id || item.id || item.aweme_id;
  if (!id) return null;
  const auteur = item.author?.unique_id || item.author?.uniqueId || item.author?.nickname || usernameFallback;
  const createTime = item.create_time ?? item.createTime;
  return {
    id: String(id),
    desc: item.title || item.desc || 'Nouvelle vidéo TikTok',
    url: `https://www.tiktok.com/@${auteur}/video/${id}`,
    author: auteur,
    thumbnail: item.cover || item.origin_cover || item.ai_dynamic_cover || null,
    publishedAt: createTime ? Number(createTime) * 1000 : null
  };
}

// ────────────────────────────────────────────────
// Récupération de la dernière vidéo publiée par un compte, via l'API
// RapidAPI "TikTok Scraper7" (endpoint /user/posts).
// ────────────────────────────────────────────────
async function fetchLatestVideo(username) {
  if (!RAPIDAPI_KEY) {
    console.error('[TikTok] RAPIDAPI_KEY manquante dans les variables d\'environnement.');
    return null;
  }
  try {
    const params = new URLSearchParams({
      unique_id: `@${username}`,
      count: '10',
      cursor: '0'
    });
    const res = await fetch(`https://${RAPIDAPI_HOST}/user/posts?${params.toString()}`, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      },
      signal: AbortSignal.timeout(18000)
    });
    if (!res.ok) {
      console.error(`[TikTok] Réponse HTTP non OK (${res.status}) pour @${username}`);
      return null;
    }
    const json = await res.json();
    const videos = json?.data?.videos;
    if (!Array.isArray(videos) || !videos.length) return null;

    // Trie explicitement par date de publication par sécurité (normalement déjà trié).
    const trie = [...videos].sort((a, b) => Number(b.create_time || 0) - Number(a.create_time || 0));
    return normaliserItem(trie[0], username);
  } catch (e) {
    console.error(`[TikTok] Erreur appel API (@${username}):`, e.message);
    return null;
  }
}
function buildVideoEmbed(video) {
  const embed = new EmbedBuilder().setTitle(video.desc ? video.desc.slice(0, 256) : 'Nouvelle vidéo TikTok').setColor(0xFE2C55).setDescription(`**@${video.author}** vient de publier une nouvelle vidéo TikTok !`).setFooter({
    text: 'TikTok • Nouvelle vidéo'
  }).setTimestamp();
  if (video.thumbnail) embed.setImage(video.thumbnail);
  return embed;
}

// Verrou anti-chevauchement
let isChecking = false;
let intervalStarted = false;
async function checkTiktokNotifications(client) {
  if (isChecking) return;
  isChecking = true;
  try {
    await runCheck(client);
  } finally {
    isChecking = false;
  }
}
async function runCheck(client) {
  for (const [guildId, bucket] of Object.entries(store.tiktokNotifs || {})) {
    if (!Array.isArray(bucket) || !bucket.length) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    let changed = false;
    for (const entry of bucket) {
      try {
        if (!entry.channelId) continue; // ancienne entrée sans salon, ignorée

        if (!entry.username) {
          entry.username = await resolveTiktokUsername(entry.url);
          changed = true;
          if (!entry.username) continue;
        }
        const latest = await fetchLatestVideo(entry.username);
        if (!latest || !latest.id) continue;
        if (!entry.lastVideoId) {
          entry.lastVideoId = latest.id;
          changed = true;
          continue; // pas de spam de l'historique existant au premier check
        }
        if (entry.lastVideoId === latest.id) continue;
        const discordChannel = guild.channels.cache.get(entry.channelId);
        if (!discordChannel?.isTextBased?.()) continue;
        entry.lastVideoId = latest.id;
        changed = true;
        persist('tiktokNotifs');
        
        // Bouton pour regarder la vidéo
        const button = new ButtonBuilder()
          .setLabel('🎵 Regarder la vidéo')
          .setURL(latest.url)
          .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(button);
        
        await discordChannel.send(toCV2Payload({
          content: `🎵 **Nouvelle vidéo TikTok de @${latest.author} !**`,
          embeds: [buildVideoEmbed(latest)],
          components: [row]
        }));
      } catch (e) {
        console.error(`[TikTok] Erreur check pour ${entry.url}:`, e.message);
      }
    }
    if (changed) {
      store.tiktokNotifs[guildId] = bucket;
      persist('tiktokNotifs');
    }
  }
}
function startTiktokChecker(client, intervalMs = 120000) {
  if (intervalStarted) {
    console.warn('[TikTok] startTiktokChecker() déjà appelé, appel ignoré.');
    return;
  }
  intervalStarted = true;
  setInterval(() => {
    if (!client.isReady()) return;
    checkTiktokNotifications(client).catch(e => console.error('[TikTok] Erreur boucle:', e.message));
  }, intervalMs);
  setTimeout(() => {
    checkTiktokNotifications(client).catch(e => console.error('[TikTok] Erreur check initial:', e.message));
  }, 25000);
}
module.exports = {
  startTiktokChecker,
  checkTiktokNotifications,
  resolveTiktokUsername,
  fetchLatestVideo
};