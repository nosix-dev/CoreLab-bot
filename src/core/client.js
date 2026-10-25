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
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.GuildMessageTyping,
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
    process.on('unhandledRejection', (err) => {
        console.error('Promesse rejetée non gérée :', err);
    });

    return client;
}
module.exports = { createClient };