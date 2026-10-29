'use strict';

// ─────────────────────────────────────────────────────────────────────────
// protectionLog.js — destination unique des logs de PROTECTION
// Priorité : salon défini dans /protect-settings → salon « 🛡️・logs-protection »
// créé à l'installation → salon de logs général (dernier recours).
// ─────────────────────────────────────────────────────────────────────────

const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('./config');

function getProtectionLogChannelId(cfg) {
  return cfg.protection_log_channel_id || cfg.protection_setup_channel_id || cfg.log_channel_id || null;
}

function getProtectionLogChannel(guild) {
  const cfg = getGuildConfig(guild.id);
  const id = getProtectionLogChannelId(cfg);
  const channel = id ? guild.channels.cache.get(String(id)) : null;
  return channel?.isTextBased?.() ? channel : null;
}

// Envoie un embed (carte « verre fumé ») dans le salon de logs de protection
async function sendProtectionEmbed(guild, embed, badge = 'PROTECTION') {
  const channel = getProtectionLogChannel(guild);
  if (!channel) return false;
  try {
    const emb = embed instanceof EmbedBuilder ? embed : new EmbedBuilder(embed);
    const { glassPayload } = require('./glassEmbed');
    await channel.send(await glassPayload({ embeds: [emb] }, { guild, badge }));
    return true;
  } catch (e) {
    console.error('Erreur log protection :', e.message);
    return false;
  }
}

module.exports = { getProtectionLogChannelId, getProtectionLogChannel, sendProtectionEmbed };
