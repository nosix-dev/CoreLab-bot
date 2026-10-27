const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require('discord.js');
const { alreadyPosted } = require('../core/alreadyPosted');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Nécessite une clé API Medal.tv gratuite (clé "publique") :
// https://developers.medal.tv → générer une clé via /v1/generate_public_key
// puis ajouter MEDAL_API_KEY dans le .env / les variables d'environnement Wispbyte.
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const MEDAL_API_BASE = 'https://developers.medal.tv/v1';

// ────────────────────────────────────────────────
// Résolution de l'ID numérique Medal depuis une URL de profil.
// L'API officielle n'accepte QUE l'ID numérique (ex: medal.tv/users/215577).
// Les URLs "vanity" (medal.tv/u/pseudo, medal.tv/@pseudo) ne peuvent pas
// être résolues automatiquement sans clé privée / endpoint non documenté.
// ────────────────────────────────────────────────
function resolveMedalUserId(rawUrl) {
  const url = rawUrl.trim();

  // ID numérique déjà fourni tel quel
  if (/^\d+$/.test(url)) return url;

  // https://medal.tv/users/215577(/...)
  const match = url.match(/medal\.tv\/users\/(\d+)/i);
  if (match) return match[1];
  return null;
}

// ────────────────────────────────────────────────
// Récupération du dernier clip d'un utilisateur via l'API officielle
// ────────────────────────────────────────────────
async function fetchLatestClip(medalUserId) {
  const apiKey = process.env.MEDAL_API_KEY;
  if (!apiKey) {
    console.error('[Medal] MEDAL_API_KEY manquant dans les variables d\'environnement.');
    return null;
  }
  try {
    const res = await fetch(`${MEDAL_API_BASE}/latest?userId=${encodeURIComponent(medalUserId)}&limit=1`, {
      headers: {
        Authorization: apiKey
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.error(`[Medal] Réponse API non OK (${res.status}) pour l'utilisateur ${medalUserId}`);
      return null;
    }
    const data = await res.json();
    const clip = data?.contentObjects?.[0];
    if (!clip) return null;
    const creditsMatch = /^Credits to (.+?) \(/.exec(clip.credits || '');
    return {
      id: clip.contentId,
      title: clip.contentTitle || 'Nouveau clip',
      url: clip.directClipUrl,
      thumbnail: clip.contentThumbnail || null,
      author: creditsMatch ? creditsMatch[1] : 'Ce profil Medal',
      views: clip.contentViews ?? 0
    };
  } catch (e) {
    console.error(`[Medal] Erreur fetch clip (${medalUserId}):`, e.message);
    return null;
  }
}
function buildClipEmbed(clip) {
  return new EmbedBuilder().setTitle(clip.title).setColor(0xFFC800).setDescription(`**${clip.author}** vient de publier un nouveau clip sur Medal !`).setImage(clip.thumbnail).setFooter({
    text: `Medal • ${clip.views} vues`
  }).setTimestamp();
}

// Verrou anti-chevauchement : évite que deux exécutions se marchent dessus
let isChecking = false;

// Verrou anti-démarrage multiple
let intervalStarted = false;
async function checkMedalNotifications(client) {
  if (isChecking) return;
  isChecking = true;
  try {
    await runCheck(client);
  } finally {
    isChecking = false;
  }
}
async function runCheck(client) {
  for (const [guildId, bucket] of Object.entries(store.medalNotifs || {})) {
    if (!Array.isArray(bucket) || !bucket.length) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    let changed = false;
    for (const entry of bucket) {
      try {
        if (!entry.channelId) continue; // ancienne entrée sans salon, ignorée

        // Résolution paresseuse pour les entrées enregistrées avant l'ajout du checker
        if (!entry.medalUserId) {
          entry.medalUserId = resolveMedalUserId(entry.url);
          changed = true;
          if (!entry.medalUserId) continue; // URL vanity non résoluble automatiquement
        }
        const latest = await fetchLatestClip(entry.medalUserId);
        if (!latest || !latest.id) continue;
        if (!entry.lastClipId) {
          entry.lastClipId = latest.id;
          changed = true;
          continue; // pas de spam de l'historique existant au premier check
        }
        if (entry.lastClipId === latest.id) continue;
        const discordChannel = guild.channels.cache.get(entry.channelId);
        if (!discordChannel?.isTextBased?.()) continue;

        // Déjà posté dans le salon (état JSON perdu au redéploiement) : on le marque comme envoyé sans le reposter
        if (await alreadyPosted(discordChannel, [latest.id, latest.url])) {
          entry.lastClipId = latest.id;
          changed = true;
          continue;
        }

        // Marqué comme envoyé et persisté AVANT le send, pour éviter un double envoi
        entry.lastClipId = latest.id;
        changed = true;
        persist('medalNotifs');
        
        // Bouton pour regarder le clip
        const button = new ButtonBuilder()
          .setLabel('🎮 Regarder le clip')
          .setURL(latest.url)
          .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(button);
        
        await discordChannel.send(toCV2Payload({
          content: `🎮 **Nouveau clip Medal de ${latest.author} !**`,
          embeds: [buildClipEmbed(latest)],
          components: [row]
        }));
      } catch (e) {
        console.error(`[Medal] Erreur check pour ${entry.url}:`, e.message);
      }
    }
    if (changed) {
      store.medalNotifs[guildId] = bucket;
      persist('medalNotifs');
    }
  }
}
function startMedalChecker(client, intervalMs = 90000) {
  if (intervalStarted) {
    console.warn('[Medal] startMedalChecker() déjà appelé, appel ignoré.');
    return;
  }
  intervalStarted = true;
  setInterval(() => {
    if (!client.isReady()) return;
    checkMedalNotifications(client).catch(e => console.error('[Medal] Erreur boucle:', e.message));
  }, intervalMs);
  setTimeout(() => {
    checkMedalNotifications(client).catch(e => console.error('[Medal] Erreur check initial:', e.message));
  }, 20000);
}
module.exports = {
  startMedalChecker,
  checkMedalNotifications,
  resolveMedalUserId,
  fetchLatestClip
};
