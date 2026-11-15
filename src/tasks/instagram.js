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
} = require('../core/componentsV2');
const { alreadyPosted } = require('../core/alreadyPosted');

// ────────────────────────────────────────────────
// Récupération des publications Instagram via l'API RapidAPI "Instagram Looter"
// https://rapidapi.com/iq.faceok/api/instagram-looter2 (hôte instagram-looter2.p.rapidapi.com)
//   1) GET /id?username=...        -> identifiant numérique du compte (mis en cache et gardé dans le suivi)
//   2) GET /user-feeds?id=...      -> dernières publications
// Utilise la même variable d'environnement RAPIDAPI_KEY que TikTok / Twitch
// (il faut juste être abonné à cette API sur RapidAPI, le plan gratuit suffit pour démarrer).
// L'hôte peut être changé avec INSTAGRAM_RAPIDAPI_HOST.
// ────────────────────────────────────────────────
const RAPIDAPI_HOST = process.env.INSTAGRAM_RAPIDAPI_HOST || 'instagram-looter2.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

// Pages d'Instagram qui ne sont pas des profils
const RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about']);

// ────────────────────────────────────────────────
// Résolution du pseudo Instagram (sans @) depuis une URL ou un pseudo brut
// ────────────────────────────────────────────────
function resolveInstagramUsername(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  // Pseudo brut ("@pseudo" ou "pseudo")
  if (/^@?[a-zA-Z0-9._]{1,30}$/.test(url) && !url.includes('/') && !/instagram|instagr\.am/i.test(url)) {
    return url.replace(/^@/, '').toLowerCase();
  }
  const match = url.match(/(?:instagram\.com|instagr\.am)\/@?([a-zA-Z0-9._]{1,30})/i);
  if (match && !RESERVED.has(match[1].toLowerCase())) return match[1].toLowerCase();
  return null;
}

// Normalise une publication renvoyée par l'API (tolère les variantes de champs).
function normaliserItem(item, usernameFallback) {
  if (!item) return null;
  const code = item.code || item.shortcode;
  const id = String(item.pk || item.id || code || '');
  if (!id || !code) return null;
  let ts = item.taken_at_timestamp ?? item.taken_at ?? item.taken_at_ts ?? null;
  ts = ts ? Number(ts) : null;
  if (ts && ts < 1e12) ts *= 1000; // secondes -> millisecondes
  const caption = item.caption?.text ?? item.captions?.items?.[0]?.text ?? item.edge_media_to_caption?.edges?.[0]?.node?.text ?? (typeof item.caption === 'string' ? item.caption : '');
  const isReel = item.product_type === 'clips' || item.media_type === 2 || item.is_video === true;
  return {
    id,
    code,
    caption: String(caption || '').trim(),
    author: item.user?.username || item.owner?.username || usernameFallback,
    url: `https://www.instagram.com/p/${code}/`,
    isReel,
    thumbnail: item.thumbnail_url || item.display_url || item.image_versions?.items?.[0]?.url || item.image_versions2?.candidates?.[0]?.url || null,
    publishedAt: ts
  };
}

// ────────────────────────────────────────────────
// Appel générique RapidAPI (renvoie le JSON, ou null en cas d'erreur)
// ────────────────────────────────────────────────
async function rapid(path, params, label) {
  if (!RAPIDAPI_KEY) {
    console.error('[Instagram] RAPIDAPI_KEY manquante dans les variables d\'environnement.');
    return null;
  }
  try {
    const res = await fetch(`https://${RAPIDAPI_HOST}${path}?${new URLSearchParams(params).toString()}`, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const corps = await res.text().catch(() => '');
      const hint = res.status === 429 ? ' (quota/limite RapidAPI atteint ?)'
        : res.status === 401 || res.status === 403 ? ' (clé RAPIDAPI_KEY invalide ou abonnement à l\'API Instagram Looter inactif ?)'
        : res.status === 404 ? ' (compte introuvable ?)' : '';
      console.error(`[Instagram] Réponse HTTP non OK (${res.status})${hint} pour ${label} :`, corps.slice(0, 200));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[Instagram] Erreur appel API (${label}):`, e.message);
    return null;
  }
}

// Cherche un identifiant numérique dans les formes de réponse les plus courantes
function pickId(j) {
  if (!j) return null;
  const candidats = [j.user_id, j.id, j.pk, j.data?.user_id, j.data?.id, j.data?.pk, j.user?.pk, j.user?.id, j.user?.user_id];
  const v = candidats.find(x => x != null && /^\d+$/.test(String(x)));
  return v ? String(v) : null;
}

const userIdCache = new Map();
async function resolveUserId(username) {
  if (userIdCache.has(username)) return userIdCache.get(username);
  let id = pickId(await rapid('/id', { username }, `@${username} (/id)`));
  if (!id) id = pickId(await rapid('/profile', { username }, `@${username} (/profile)`));
  if (id) userIdCache.set(username, id);
  else console.warn(`[Instagram] Identifiant introuvable pour @${username}`);
  return id;
}

// ────────────────────────────────────────────────
// Dernière publication d'un compte (endpoint /user-feeds).
// userId connu (stocké dans le suivi) : évite un appel /id à chaque passage.
// Le résultat contient aussi userId pour qu'on puisse le garder.
// ────────────────────────────────────────────────
async function fetchLatestPost(username, userId) {
  const id = userId || await resolveUserId(username);
  if (!id) return null;
  userIdCache.set(username, id);
  const json = await rapid('/user-feeds', { id, count: '12' }, `@${username} (/user-feeds)`);
  if (!json) return null;
  let items = json.items ?? json.data?.items;
  if (!Array.isArray(items)) {
    const edges = json.data?.user?.edge_owner_to_timeline_media?.edges;
    if (Array.isArray(edges)) items = edges.map(e => e.node);
  }
  if (!Array.isArray(items) || !items.length) {
    console.warn(`[Instagram] Aucune publication dans la réponse pour @${username} (compte privé ?)`);
    return null;
  }
  // Tri par date : une publication épinglée en tête ne doit pas passer pour la plus récente.
  const posts = items.map(i => normaliserItem(i, username)).filter(Boolean)
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  if (!posts[0]) return null;
  posts[0].userId = id;
  return posts[0];
}

function buildPostEmbed(post) {
  const quoi = post.isReel ? 'un nouveau reel' : 'une nouvelle publication';
  const embed = new EmbedBuilder()
    .setTitle(post.caption ? post.caption.slice(0, 256) : (post.isReel ? 'Nouveau reel Instagram' : 'Nouvelle publication Instagram'))
    .setColor(0xE1306C)
    .setDescription(`**@${post.author}** vient de publier ${quoi} sur Instagram !`)
    .setFooter({ text: post.isReel ? 'Instagram • Nouveau reel' : 'Instagram • Nouvelle publication' })
    .setTimestamp();
  if (post.thumbnail) embed.setImage(post.thumbnail);
  return embed;
}

// Fenêtre de rattrapage d'une publication manquée pendant une coupure du bot
const CATCHUP_MS = 12 * 60 * 60 * 1000;

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
        const latest = await fetchLatestPost(entry.username, entry.userId);
        if (!latest || !latest.id) continue;
        if (latest.userId && entry.userId !== latest.userId) {
          entry.userId = latest.userId;
          changed = true;
        }
        if (entry.lastPostId === latest.id) continue;
        const discordChannel = guild.channels.cache.get(entry.channelId);
        if (!discordChannel?.isTextBased?.()) continue;
        if (!entry.lastPostId) {
          // Premier check (ou état perdu au redéploiement) : pas de spam de l'historique,
          // mais on rattrape une publication de moins de CATCHUP_MS qui n'a pas été postée.
          const recente = latest.publishedAt && (Date.now() - latest.publishedAt) < CATCHUP_MS;
          if (!recente || await alreadyPosted(discordChannel, [latest.code, latest.url])) {
            entry.lastPostId = latest.id;
            changed = true;
            continue;
          }
        }
        // Déjà postée dans le salon (état JSON perdu au redéploiement) : marquée envoyée sans reposter
        if (await alreadyPosted(discordChannel, [latest.code, latest.url])) {
          entry.lastPostId = latest.id;
          changed = true;
          continue;
        }
        entry.lastPostId = latest.id;
        changed = true;
        persist('instagramNotifs');

        const button = new ButtonBuilder()
          .setLabel(latest.isReel ? '📸 Voir le reel' : '📸 Voir la publication')
          .setURL(latest.url)
          .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(button);

        await discordChannel.send(toCV2Payload({
          content: `📸 **Nouveau contenu Instagram de @${latest.author} !**`,
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
// Intervalle par défaut : 10 min (chaque compte suivi = 1 requête RapidAPI à chaque passage).
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
  }, 40000);
}
module.exports = {
  startInstagramChecker,
  checkInstagramNotifications,
  resolveInstagramUsername,
  fetchLatestPost
};
