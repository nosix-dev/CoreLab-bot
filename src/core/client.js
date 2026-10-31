const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
} = require('discord.js');
const { PREFIXE } = require('./constants');

function createClient() {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildEmojisAndStickers,
            GatewayIntentBits.GuildIntegrations,
            GatewayIntentBits.GuildWebhooks,
            GatewayIntentBits.GuildInvites,
            GatewayIntentBits.GuildVoiceStates,
            // Nécessaire uniquement pour le compteur « membres en ligne » (serverStatsCounters).
            // Très coûteux en CPU/RAM sur un petit hébergeur : si tu n'utilises pas ce compteur,
            // supprime cette ligne.
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            // GuildMessageTyping retiré : aucun handler `typingStart` dans le bot, ça ne faisait
            // que recevoir un événement à chaque fois que quelqu'un tape un message.
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageReactions,
            GatewayIntentBits.MessageContent,
        ],
        partials: [
            Partials.Message,
            Partials.Channel,
            Partials.Reaction,
            Partials.GuildMember,
            Partials.User,
        ],
        rest: {
            timeout: 30000, // 30s au lieu des 15s par défaut, pour absorber les pics réseau côté hébergeur
            retries: 3,
        },
    });
    client.commands = new Collection();
    client.prefix = PREFIXE;
    client.startTime = new Date();
    client.on('error', (err) => {
        console.error('Erreur client Discord :', err.message);
        console.error(err.stack);
    });

    // ── Diagnostic des lenteurs : quand discord.js attend à cause d'un rate limit (429),
    // les commandes semblent « figées » sans aucune erreur. Ces logs montrent la cause. ──
    client.rest.on('rateLimited', (info) => {
        const attente = Math.round((info.timeToReset || 0) / 1000);
        console.warn(`[RATELIMIT] ${info.method} ${info.route} → attente ${attente} s (limite ${info.limit}, global: ${info.global ? 'oui' : 'non'})`);
    });
    client.rest.on('invalidRequestWarning', (info) => {
        console.warn(`[RATELIMIT] ${info.count} requêtes invalides (401/403/429) sur ${Math.round(info.remainingTime / 1000)} s : risque de blocage Cloudflare de l'IP`);
    });

    process.on('unhandledRejection', (err) => {
        console.error('Promesse rejetée non gérée :', err);
    });

    return client;
}
module.exports = { createClient };