// src/tasks/index.js
// Point d'entrée unique pour toutes les tâches planifiées de CoreLab.
// Appelé une seule fois dans index.js principal : startTasks(client)

const { startServerStatsUpdater }    = require('./serverStats');
const { startYoutubeChecker }        = require('./youtube');
const { startScheduledMessagesTask } = require('./scheduledMessages');
const { startMedalChecker }          = require('./medal');
const { startTwitchPolling }         = require('./twitch');
const { startTiktokChecker }         = require('./tiktok');
const { recordAllEconomySnapshots }  = require('../commands/economy');
const { startCryptoAlerts }         = require('../core/cryptoAlerts');

// Intervalle du snapshot économie : 1 snapshot par jour (~24h)
const ECONOMY_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function startTasks(client) {
  // ── Stats serveur (renommage salons) — toutes les 10 min ──
  startServerStatsUpdater(client);

  // ── Notifications YouTube — toutes les 60s ──
  startYoutubeChecker(client);

  // ── Messages programmés ──
  startScheduledMessagesTask(client);

  // ── Notifications Medal.tv — toutes les 90s ──
  startMedalChecker(client);

  // ── Notifications Twitch — toutes les 10s ──
  startTwitchPolling(client);

  // ── Notifications TikTok — toutes les 120s ──
  startTiktokChecker(client);

  // ── Alertes de cours crypto — vérification chaque minute (envoi selon la fréquence choisie) ──
  startCryptoAlerts(client);

  // ── Snapshots économie — 1 fois par jour ──
  // Un premier snapshot immédiat au démarrage, puis toutes les 24h.
  recordAllEconomySnapshots(client);
  setInterval(() => recordAllEconomySnapshots(client), ECONOMY_SNAPSHOT_INTERVAL_MS);

  console.log('[Tasks] Toutes les tâches planifiées sont démarrées.');
}

module.exports = { startTasks };