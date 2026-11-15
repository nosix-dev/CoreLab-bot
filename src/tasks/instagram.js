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
const {
  toCV2Payload
} = require("../core/componentsV2");
const {
  alreadyPosted
} = require('../core/alreadyPosted');

// ────────────────────────────────────────────────
// Récupération des publications Instagram via l'API RapidAPI "Instagram Looter"
// https://rapidapi.com/irrors-apis/api/instagram-looter2
//   GET /id?username=...                         → ID numérique du compte
//   GET /user-feeds?id=...&count=12&...          → publications du compte
// Nécessite la variable d'environnement RAPIDAPI_KEY (la même que TikTok / Twitch)
// ET un abonnement (gratuit possible) à l'API Instagram Looter sur RapidAPI.
// ────────────────────────────────────────────────
const RAPIDAPI_HOST = 'instagram-looter2.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
};

// Fenêtre de rattrapage d'une publication manquée pendant une coupure du bot
const CATCHUP_MS = 12 * 60 * 60 * 1000;

// ────────────────────────────────────────────────
// Appel générique de l'API (renvoie le JSON ou null en cas d'erreur)
// ────────────────────────────────────────────────
async function appelApi(chemin, params, etiquette) {
  if (!RAPIDAPI_KEY) {
    console.error('[Instagram] RAPIDAPI_KEY manquante dans les variables d\'environnement.');
    return null;
  }
  try {
    const res = await fetch(`https://${RAPIDAPI_HOST}${chemin}?${new URLSearchParams(params).toString()}`, {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const corps = await res.text().catch(() => '');
      const hint = res.status === 429 ? ' (quota/limite RapidAPI atteint ?)' : res.status === 401 || res.status === 403 ? ' (clé RAPIDAPI_KEY invalide ou pas abonné à Instagram Looter ?)' : '';
      console.error(`[Instagram] HTTP ${res.status}${hint} (${etiquette}) :`, corps.slice(0, 200));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[Instagram] Erreur appel API (${etiquette}):`, e.message);
    return null;
  }
}

// ────────────────────────────────────────────────
// Résolution du pseudo Instagram (sans @) depuis une URL ou un pseudo brut
// ────────────────────────────────────────────────
function resolveInstagramUsername(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  // Pseudo brut ("@pseudo" ou "pseudo")
  if (/^@?[a-zA-Z0-9._]{1,30}$/.test(url) && !url.includes('/')) {
    return url.replace(/^@/, '').toLowerCase();
  }
  const match = url.match(/instagram\.com\/(?!p\/|reel\/|reels\/|tv\/|explore\/|stories\/)([a-zA-Z0-9._]{1,30})/i);
  if (match) return match[1].toLowerCase();
  return null;
}

// ────────────────────────────────────────────────
// Pseudo → ID numérique (endpoint /id)
// ────────────────────────────────────────────────
async function fetchInstagramUserId(username) {
  const json = await appelApi('/id', {
    username
  }, `id @${username}`);
  if (!json) return null;
  const candidats = [json.id, json.user_id, json.pk, json.userId, json.data?.id, json.data?.user_id, json.data?.pk, json.result?.id, json.user?.id, json.user?.pk];
  const trouve = candidats.find(v => v !== undefined && v !== null && v !== '' && /^\d+$/.test(String(v)));
  if (!trouve) {
    console.warn(`[Instagram] ID introuvable dans la réponse pour @${username}. Clés reçues :`, Object.keys(json).join(', '));
    return null;
  }
  return String(trouve);
}

// ────────────────────────────────────────────────
// Extraction tolérante de la liste des publications (formats possibles :
// { items: [...] }, { data: { items: [...] } }, GraphQL edges, etc.)
// ────────────────────────────────────────────────
function extraireListe(json) {
  if (!json) return [];
  const sources = [json.items, json.data?.items, json.data?.user?.edge_owner_to_timeline_media?.edges, json.data?.edges, json.edges, json.user?.edge_owner_to_timeline_media?.edges, json.feed?.items, json.result?.items, json.data, json.posts, json.medias, json.media, Array.isArray(json) ? json : null];
  for (const s of sources) {
    if (Array.isArray(s) && s.length) return s;
  }
  return [];
}
function normaliserItem(brut, usernameFallback) {
  if (!brut) return null;
  const item = brut.node || brut; // GraphQL : { node: {...} }
  const code = item.code || item.shortcode;
  const id = item.pk || item.id || code;
  if (!id) return null;
  const type = Number(item.media_type); // 1 photo, 2 vidéo/reel, 8 carrousel
  const estReel = item.product_type === 'clips' || type === 2 || item.is_video === true;
  const legende = item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || (typeof item.caption === 'string' ? item.caption : '') || '';
  const image = item.image_versions2?.candidates?.[0]?.url || item.display_url || item.thumbnail_url || item.thumbnail_src || item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url || null;
  const ts = item.taken_at ?? item.taken_at_timestamp ?? item.device_timestamp;
  let publishedAt = null;
  if (ts) {
    const n = Number(ts);
    // secondes (10 chiffres), millisecondes (13) ou microsecondes (16)
    publishedAt = n > 1e14 ? Math.floor(n / 1000) : n > 1e11 ? n : n * 1000;
  }
  const auteur = item.user?.username || item.owner?.username || usernameFallback;
  const nombre = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (v !== undefined && v !== null && Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const likes = nombre(item.like_count, item.edge_media_preview_like?.count, item.edge_liked_by?.count);
  const commentaires = nombre(item.comment_count, item.edge_media_to_comment?.count);
  const vues = nombre(item.play_count, item.ig_play_count, item.view_count, item.video_view_count);
  const duree = nombre(item.video_duration);
  const avatar = item.user?.profile_pic_url || item.owner?.profile_pic_url || null;
  const url = code ? `https://www.instagram.com/${estReel ? 'reel' : 'p'}/${code}/` : `https://www.instagram.com/${auteur}/`;
  return {
    id: String(code || id),
    desc: String(legende).trim(),
    url,
    author: auteur,
    thumbnail: image,
    isReel: estReel,
    publishedAt,
    likes,
    commentaires,
    vues,
    duree,
    avatar
  };
}

// ────────────────────────────────────────────────
// Dernière publication d'un compte (par son ID numérique)
// ────────────────────────────────────────────────
async function fetchLatestPost(userId, username) {
  const json = await appelApi('/user-feeds', {
    id: userId,
    count: '12',
    allow_restricted_media: 'false'
  }, `feed @${username}`);
  if (!json) return null;
  const liste = extraireListe(json);
  if (!liste.length) {
    console.warn(`[Instagram] Aucune publication lisible pour @${username}. Clés reçues :`, Object.keys(json).join(', '));
    return null;
  }
  const posts = liste.map(i => normaliserItem(i, username)).filter(Boolean);
  if (!posts.length) return null;

  // Tri par date décroissante (ignore une publication épinglée plus ancienne en tête de grille)
  posts.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return posts[0];
}
// Sépare la légende du texte et des hashtags, et coupe proprement la légende longue
function formaterLegende(desc) {
  const brut = String(desc || '');
  const hashtags = [...new Set(brut.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 8);
  let texte = brut.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (texte.length > 350) texte = texte.slice(0, 350).replace(/\s+\S*$/, '') + '…';
  return {
    texte,
    hashtags
  };
}
// 1234 → "1,2 k" ; 1500000 → "1,5 M"
function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.', ',').replace(',0', '')} k`;
  return String(n);
}
function formatDuree(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function buildPostEmbed(post) {
  const {
    texte,
    hashtags
  } = formaterLegende(post.desc);
  const blocs = [];
  if (texte) blocs.push(texte.split('\n').map(l => `> ${l}`).join('\n'));

  // Ligne de stats (uniquement celles que l'API fournit)
  const stats = [];
  if (post.likes) stats.push(`❤️ **${compact(post.likes)}**`);
  if (post.commentaires) stats.push(`💬 **${compact(post.commentaires)}**`);
  if (post.vues) stats.push(`▶️ **${compact(post.vues)}**`);
  if (post.duree) stats.push(`⏱️ **${formatDuree(post.duree)}**`);
  if (stats.length) blocs.push(stats.join('   '));
  if (hashtags.length) blocs.push(`-# ${hashtags.join('  ')}`);

  // NB : pas d'emoji dans le titre / l'auteur (ils sont dans un lien markdown :
  // le remplacement par un emoji personnalisé casserait le lien).
  const embed = new EmbedBuilder().setColor(0xE1306C).setAuthor({
    name: `@${post.author} • Instagram`,
    url: `https://www.instagram.com/${post.author}/`
  }).setTitle(post.isReel ? 'Nouveau reel' : 'Nouvelle publication').setURL(post.url).setFooter({
    text: post.isReel ? 'Instagram • Reel' : 'Instagram • Publication'
  }).setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date());
  if (blocs.length) embed.setDescription(blocs.join('\n\n'));
  if (post.avatar) embed.setThumbnail(post.avatar);
  // Pas de grande image verticale : carte compacte (texte à gauche, photo de profil à droite)
  return embed;
}

// Verrou anti-chevauchement
let isChecking = false;
let intervalStarted = false;
async function checkInstagramNotifications(client) {
  if (isChecking) return;
  isChecking = true;
  try {
    await runCheck(client);
  } finally {
    isChecking = false;
  }
}
async function runCheck(client) {
  for (const [guildId, bucket] of Object.entries(store.instagramNotifs || {})) {
    if (!Array.isArray(bucket) || !bucket.length) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    let changed = false;
    for (const entry of bucket) {
      try {
        if (!entry.channelId) continue;
        if (!entry.username) {
          entry.username = resolveInstagramUsername(entry.url);
          changed = true;
          if (!entry.username) continue;
        }
        // ID numérique pas encore connu (suivi enregistré alors que l'API était indisponible)
        if (!entry.userId) {
          entry.userId = await fetchInstagramUserId(entry.username);
          if (!entry.userId) continue;
          changed = true;
        }
        const latest = await fetchLatestPost(entry.userId, entry.username);
        if (!latest || !latest.id) continue;
        if (entry.lastPostId === latest.id) continue;
        const discordChannel = guild.channels.cache.get(entry.channelId);
        if (!discordChannel?.isTextBased?.()) continue;
        if (!entry.lastPostId) {
          // Premier check réussi : on ne spamme pas l'historique, mais on rattrape
          // une publication récente qui n'a pas encore été postée.
          const recente = latest.publishedAt && Date.now() - latest.publishedAt < CATCHUP_MS;
          if (!recente || (await alreadyPosted(discordChannel, [latest.id, latest.url]))) {
            entry.lastPostId = latest.id;
            changed = true;
            continue;
          }
        }
        // Déjà postée dans le salon (état JSON perdu au redéploiement)
        if (await alreadyPosted(discordChannel, [latest.id, latest.url])) {
          entry.lastPostId = latest.id;
          changed = true;
          continue;
        }
        entry.lastPostId = latest.id;
        changed = true;
        persist('instagramNotifs');
        const button = new ButtonBuilder().setLabel(latest.isReel ? '🎬 Voir le reel' : '📸 Voir la publication').setURL(latest.url).setStyle(ButtonStyle.Link);
        const profil = new ButtonBuilder().setLabel('👤 Profil').setURL(`https://www.instagram.com/${latest.author}/`).setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(button, profil);
        await discordChannel.send(toCV2Payload({
          content: `📸 **${latest.isReel ? 'Nouveau reel' : 'Nouvelle publication'} Instagram de @${latest.author} !**`,
          embeds: [buildPostEmbed(latest)],
          components: [row]
        }));
      } catch (e) {
        console.error(`[Instagram] Erreur check pour ${entry.url}:`, e.message);
      }
    }
    if (changed) {
      store.instagramNotifs[guildId] = bucket;
      persist('instagramNotifs');
    }
  }
}

// Intervalle par défaut : 10 min (les plans gratuits RapidAPI ont un quota limité).
function startInstagramChecker(client, intervalMs = Number(process.env.INSTAGRAM_INTERVAL_MS) || 600000) {
  if (intervalStarted) {
    console.warn('[Instagram] startInstagramChecker() déjà appelé, appel ignoré.');
    return;
  }
  intervalStarted = true;
  setInterval(() => {
    if (!client.isReady()) return;
    checkInstagramNotifications(client).catch(e => console.error('[Instagram] Erreur boucle:', e.message));
  }, intervalMs);
  setTimeout(() => {
    checkInstagramNotifications(client).catch(e => console.error('[Instagram] Erreur check initial:', e.message));
  }, 35000);
}
module.exports = {
  startInstagramChecker,
  checkInstagramNotifications,
  resolveInstagramUsername,
  fetchInstagramUserId,
  fetchLatestPost
};