const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle
} = require('discord.js');
const { findPostedMessage } = require('../core/alreadyPosted');
const {
  store,
  persist
} = require('../core/data');

// ────────────────────────────────────────────────
// Statut live Twitch via l'API RapidAPI "Twitch Scraper"
// (fournisseur oanor) : https://rapidapi.com/premium-apis-oanor/api/twitch-scraper2
// Nécessite la variable d'environnement RAPIDAPI_KEY (déjà utilisée pour TikTok).
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
const RAPIDAPI_HOST = 'twitch-scraper2.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

// Récupère les infos d'une chaîne Twitch (login, nom d'affichage, avatar,
// stream en cours le cas échéant) via l'endpoint "Channel Info".
async function fetchChannelInfo(username) {
  if (!RAPIDAPI_KEY) {
    console.error('[Twitch] RAPIDAPI_KEY manquante dans les variables d\'environnement.');
    return null;
  }
  try {
    const params = new URLSearchParams({
      channel: username
    });
    const res = await fetch(`https://${RAPIDAPI_HOST}/api/channels/stream/info?${params.toString()}`, {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      },
      signal: AbortSignal.timeout(18000)
    });
    if (!res.ok) {
      console.error(`[Twitch] Réponse HTTP non OK (${res.status}) pour ${username}`);
      return null;
    }
    const json = await res.json();
    const user = json?.data?.user;
    if (!user || !user.id) return null;
    return user;
  } catch (e) {
    console.error(`[Twitch] Erreur appel API (${username}):`, e.message);
    return null;
  }
}

// Vérifie qu'une chaîne existe et renvoie { login, display_name } (mêmes
// noms de champs que l'ancienne API Helix, pour rester compatible avec
// l'appelant dans src/commands/complete.js).
async function resolveTwitchUser(username) {
  const user = await fetchChannelInfo(username);
  if (!user) return null;
  return {
    login: user.login || username.toLowerCase(),
    display_name: user.displayName || user.login || username
  };
}

// Retourne un Map<username_lowercase, streamData|null>
async function getLiveStatuses(usernames) {
  const result = new Map();
  if (!usernames.length) return result;

  // L'API ne supporte pas la vérification groupée : on interroge chaque
  // chaîne séparément, avec une légère limite de parallélisme.
  const CONCURRENCY = 8;
  let index = 0;
  async function worker() {
    while (index < usernames.length) {
      const current = usernames[index++];
      const user = await fetchChannelInfo(current);
      result.set(current.toLowerCase(), user && user.stream ? user : null);
    }
  }
  await Promise.all(Array.from({
    length: Math.min(CONCURRENCY, usernames.length)
  }, worker));
  return result;
}
// Déjà notifié ? (état JSON perdu au redéploiement alors que le stream tourne toujours)
// Le live compte comme « nouveau » seulement s'il a démarré APRÈS la dernière notif du bot dans le salon.
async function dejaNotifie(channel, entry, user) {
  const prev = await findPostedMessage(channel, [`twitch.tv/${entry.twitchName}`], { maxAgeMs: 12 * 60 * 60 * 1000 });
  if (!prev) return false;
  const started = Date.parse(user?.stream?.createdAt || user?.stream?.startedAt || '') || 0;
  if (started && started > prev.createdTimestamp + 60000) return false;
  // sans heure de démarrage connue : on ne re-notifie pas un live annoncé il y a moins de 4 h
  return started ? true : Date.now() - prev.createdTimestamp < 4 * 60 * 60 * 1000;
}
async function checkTwitchNotifications(client) {
  const guildBuckets = store.twitchNotifs || {};
  const guildIds = Object.keys(guildBuckets);
  if (!guildIds.length) return;

  // Récupère tous les pseudos uniques suivis, tous serveurs confondus
  const allUsernames = new Set();
  for (const guildId of guildIds) {
    for (const entry of guildBuckets[guildId] || []) {
      if (entry.twitchName) allUsernames.add(entry.twitchName.toLowerCase());
    }
  }
  if (!allUsernames.size) return;
  const statuses = await getLiveStatuses([...allUsernames]);
  let changed = false;
  for (const guildId of guildIds) {
    const entries = guildBuckets[guildId] || [];
    for (const entry of entries) {
      if (!entry.twitchName) continue;
      const user = statuses.get(entry.twitchName.toLowerCase());
      const isLive = !!user?.stream;

      // Passage OFFLINE -> LIVE : on notifie
      if (isLive && !entry.wasLive) {
        entry.wasLive = true;
        changed = true;
        try {
          const channel = await client.channels.fetch(entry.channelId);
          if (channel?.send && !(await dejaNotifie(channel, entry, user))) {
            const displayName = user.displayName || entry.twitchName;
            const viewers = user.stream.viewersCount ?? 0;
            const followers = user.followers?.totalCount;
            const badge = user.roles?.isPartner ? ' ✅' : '';
            const embed = new EmbedBuilder().setAuthor({
              name: `${displayName}${badge} est en direct`,
              iconURL: user.profileImageURL || undefined,
              url: `https://twitch.tv/${entry.twitchName}`
            }).setTitle('▶️ Regarder le live sur Twitch').setDescription(`**${displayName}** vient de démarrer un live !`).addFields({
              name: '👁️ Viewers',
              value: String(viewers),
              inline: true
            }, ...(followers != null ? [{
              name: '❤️ Abonnés',
              value: followers.toLocaleString('fr-FR'),
              inline: true
            }] : [])).setColor(0x9146FF).setFooter({
              text: 'Twitch • En direct',
              iconURL: 'https://static-cdn.jtvnw.net/twitch-app-icon.png'
            }).setTimestamp();
            if (user.profileImageURL) embed.setThumbnail(user.profileImageURL);
            if (user.bannerImageURL) embed.setImage(user.bannerImageURL);
            
            // Bouton pour regarder le live
            const button = new ButtonBuilder()
              .setLabel('🔴 Regarder le live')
              .setURL(`https://twitch.tv/${entry.twitchName}`)
              .setStyle(ButtonStyle.Link);
            const row = new ActionRowBuilder().addComponents(button);
            
            await channel.send(toCV2Payload({
              content: `🔴 **${displayName}** est en live sur Twitch !`,
              embeds: [embed],
              components: [row]
            }));
          }
        } catch (e) {
          console.error(`[Twitch] Impossible d'envoyer la notif pour ${entry.twitchName} :`, e.message);
        }
      }
      // Passage LIVE -> OFFLINE : on remet le flag à false pour la prochaine détection
      else if (!isLive && entry.wasLive) {
        entry.wasLive = false;
        changed = true;
      }
    }
  }
  if (changed) persist('twitchNotifs');
}
function startTwitchPolling(client, intervalMs = 10000) {
  checkTwitchNotifications(client).catch(e => console.error('[Twitch] Erreur de polling :', e.message));
  setInterval(() => {
    checkTwitchNotifications(client).catch(e => console.error('[Twitch] Erreur de polling :', e.message));
  }, intervalMs);
  console.log(`[Twitch] Polling démarré (toutes les ${intervalMs / 1000}s).`);
}
module.exports = {
  startTwitchPolling,
  checkTwitchNotifications,
  getLiveStatuses,
  resolveTwitchUser,
  fetchChannelInfo
};
