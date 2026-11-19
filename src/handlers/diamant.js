'use strict';

const { getGuildConfig } = require('../core/config');
const { getDiamant, addMessageGems, addVoiceGems } = require('../core/diamant');
const { DIAMANT_CONSTANTES: C } = require('../core/diamantConstants');

const voiceSessions = new Map();

function gainsEnabled(guildId) {
    const cfg = getGuildConfig(guildId);
    return cfg.diamant_gains_enabled !== false;
}

function channelExcluded(guildId, channelId) {
    const cfg = getGuildConfig(guildId);
    return (cfg.diamant_excluded_channels || []).map(String).includes(String(channelId));
}

function registerDiamantHandler(client) {
    client.on('messageCreate', async message => {
        try {
            if (!message.guild || message.author.bot || message.webhookId) return;
            if (!gainsEnabled(message.guild.id)) return;
            if (channelExcluded(message.guild.id, message.channel.id)) return;
            if (!getDiamant(message.author.id)) return;
            addMessageGems(message.author.id, message.guild.id, message.channel.id);
        } catch (error) {
            console.error('[Diamant] gain message :', error.message);
        }
    });

    client.on('voiceStateUpdate', (before, after) => {
        try {
            if (!after.guild || after.member?.user?.bot) return;
            const key = `${after.guild.id}:${after.member.id}`;
            const joined = !!after.channelId;
            const muted = after.selfMute || after.selfDeaf || after.serverMute || after.serverDeaf;
            if (!joined || muted || !gainsEnabled(after.guild.id)) {
                voiceSessions.delete(key);
                return;
            }
            if (voiceSessions.has(key)) return;
            voiceSessions.set(key, Date.now());
        } catch (error) {
            console.error('[Diamant] état vocal :', error.message);
        }
    });

    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, startedAt] of voiceSessions.entries()) {
            if (now - startedAt < C.GAINS.VOCAL_INTERVALLE_MS) continue;
            const [guildId, userId] = key.split(':');
            const guild = client.guilds.cache.get(guildId);
            const member = guild?.members.cache.get(userId);
            if (!member || !member.voice.channelId || member.voice.selfMute || member.voice.selfDeaf || member.voice.serverMute || member.voice.serverDeaf) {
                voiceSessions.delete(key);
                continue;
            }
            if (channelExcluded(guildId, member.voice.channelId) || !gainsEnabled(guildId)) continue;
            if (!getDiamant(userId)) continue;
            addVoiceGems(userId);
            voiceSessions.set(key, now);
        }
    }, C.GAINS.VOCAL_INTERVALLE_MS);
    timer.unref?.();

    console.log('✅ Module Diamant initialisé.');
}

module.exports = { registerDiamantHandler };
