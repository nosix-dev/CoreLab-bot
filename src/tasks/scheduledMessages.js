const { getGuildBucket, setGuildBucket } = require('../core/config'); // ⚠️ ajuste ce chemin si besoin

const SCHEDULED_CHECK_INTERVAL_MS = 30 * 1000;

async function checkScheduledMessages(client) {
    for (const guild of client.guilds.cache.values()) {
        const scheduled = getGuildBucket(guild.id, 'scheduled', []);
        if (!scheduled.length) continue;

        let changed = false;

        for (const entry of scheduled) {
            if (Date.now() < entry.nextRun) continue;

            try {
                const channel = guild.channels.cache.get(entry.channelId);
                if (channel?.isTextBased?.() && entry.message) {
                    await channel.send({ content: entry.message });
                }
            } catch (e) {
                console.error(`[Planifier] Erreur envoi pour ${entry.id}:`, e.message);
            }

            entry.nextRun += entry.intervalMs; // reprogrammé, ex: +7 jours à la même heure
            changed = true;
        }

        if (changed) {
            setGuildBucket(guild.id, 'scheduled', scheduled);
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

module.exports = { startScheduledMessagesTask };