const {
  getGuildConfig,
} = require('../core/config');
const {
  necessiteFetchMembres,
  calculerValeur,
  construireNomSalon,
} = require('../core/serverStatsCounters');

// Discord limite le renommage d'un salon à 2 fois toutes les 10 minutes.
// On met donc à jour toutes les 10 minutes pour rester large.
const SERVERSTATS_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

const categoriesPlacees = new Set(); // la catégorie n'est remontée qu'une fois par démarrage (chaque setPosition = une requête qui touche tous les salons)

async function updateServerStatsChannels(client) {
  for (const guild of client.guilds.cache.values()) {
    let cfg;
    try {
      cfg = getGuildConfig(guild.id);
    } catch (e) {
      continue;
    }
    if (!cfg?.serverstats_enabled || !Array.isArray(cfg.serverstats_counters) || !cfg.serverstats_counters.length) continue;

    const types = cfg.serverstats_counters.map(c => c.type);
    if (necessiteFetchMembres(types)) {
      // le cache est déjà rempli grâce à l'intent GuildMembers : on ne re-télécharge la liste que s'il manque du monde
      if (guild.members.cache.size < (guild.memberCount || 0) * 0.95) await guild.members.fetch().catch(() => {});
    }

    if (cfg.serverstats_category_id) {
      const categorie = guild.channels.cache.get(cfg.serverstats_category_id);
      if (categorie && categorie.rawPosition !== 0 && !categoriesPlacees.has(guild.id)) {
        categoriesPlacees.add(guild.id);
        await categorie.setPosition(0).catch(() => {});
      }
    }

    for (const compteur of cfg.serverstats_counters) {
      try {
        const salon = guild.channels.cache.get(compteur.channelId);
        if (!salon) continue;
        const valeur = calculerValeur(guild, compteur.type);
        const nom = construireNomSalon(compteur.type, valeur);
        if (nom && salon.name !== nom) {
          await salon.setName(nom);
        }
      } catch (e) {
        console.error(`[ServerStats] Erreur mise à jour salon ${compteur.channelId} (guilde ${guild.id}):`, e.message);
      }
    }
  }
}

function startServerStatsUpdater(client) {
  setInterval(() => {
    if (!client.isReady()) return;
    updateServerStatsChannels(client).catch(e => console.error('[ServerStats] Erreur boucle:', e.message));
  }, SERVERSTATS_UPDATE_INTERVAL_MS);
  // Premier passage peu après le démarrage, pour rafraîchir les valeurs
  // sans attendre le premier intervalle complet.
  setTimeout(() => {
    if (!client.isReady()) return;
    updateServerStatsChannels(client).catch(e => console.error('[ServerStats] Erreur check initial:', e.message));
  }, 20000);
}

module.exports = { startServerStatsUpdater, updateServerStatsChannels };