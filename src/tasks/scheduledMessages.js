const fs = require('fs');
const { getGuildBucket, setGuildBucket } = require('../core/config');

const SCHEDULED_CHECK_INTERVAL_MS = 30 * 1000;

// Prochain envoi après `from`.
//   repeat 'once'  → null (l'annonce est supprimée après l'envoi)
//   repeat 'month' → même jour / même heure le mois suivant (calendrier, pas 30 jours fixes)
//   sinon          → + intervalMs (jour, semaine, ou ancienne entrée /planifier)
function nextRunAfter(entry, from) {
  if (entry.repeat === 'once') return null;
  if (entry.repeat === 'month') {
    const d = new Date(from);
    const day = entry.dayOfMonth || d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay)); // 31 → dernier jour des mois courts
    return d.getTime();
  }
  const step = Number(entry.intervalMs) || 0;
  return step > 0 ? from + step : null;
}

async function checkScheduledMessages(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const scheduled = getGuildBucket(guild.id, 'scheduled', []);
    if (!scheduled.length) continue;

    let changed = false;
    const keep = [];

    for (const entry of scheduled) {
      if (entry.paused || now < entry.nextRun) { keep.push(entry); continue; }

      try {
        const channel = guild.channels.cache.get(entry.channelId);
        if (channel?.isTextBased?.() && entry.message) {
          const files = entry.imagePath && fs.existsSync(entry.imagePath) ? [entry.imagePath] : [];
          await channel.send({ content: entry.message, files, allowedMentions: { parse: ['users', 'roles', 'everyone'] } });
        }
      } catch (e) {
        console.error(`[Planifier] Erreur envoi pour ${entry.id}:`, e.message);
      }
      entry.lastRun = now;
      changed = true;

      // Reprogramme dans le futur (si le bot était éteint, on ne rattrape pas les envois manqués)
      let next = nextRunAfter(entry, entry.nextRun);
      while (next !== null && next <= now) next = nextRunAfter(entry, next);
      if (next === null) {
        if (entry.imagePath && fs.existsSync(entry.imagePath)) {
          try { fs.unlinkSync(entry.imagePath); } catch { }
        }
        continue; // annonce unique : supprimée
      }
      entry.nextRun = next;
      keep.push(entry);
    }

    if (changed) {
      setGuildBucket(guild.id, 'scheduled', keep);
    }
  }
}

function startScheduledMessagesTask(client) {
  console.log('Tâches de fond : démarrage (Messages planifiés)');
  setInterval(() => {
    if (!client.isReady()) return;
    checkScheduledMessages(client).catch(e => console.error('[Planifier] Erreur boucle:', e.message));
  }, SCHEDULED_CHECK_INTERVAL_MS);
}

module.exports = { startScheduledMessagesTask, nextRunAfter };
