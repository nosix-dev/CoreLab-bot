// src/core/reportNotify.js : prévient le signaleur quand le staff a traité son signalement.
// Le message est envoyé dans le salon des signalements choisi dans le dashboard (Signalements > Réglages).
// Si ce salon n'est pas utilisable, repli en MP au signaleur.
const { EmbedBuilder } = require('discord.js');
const { toCV2Payload } = require('./componentsV2');
const { obtenirConfigGuilde } = require('./config');

/**
 * @param {import('discord.js').Guild} guild
 * @param {'resolve'|'dismiss'} action
 * @param {Array<{reporterId: string, targetId: string, targetName?: string, reason?: string}>} decides signalements qui viennent d'être traités
 */
async function notifierSignaleurs(guild, action, decides) {
  if (!guild || !Array.isArray(decides) || !decides.length) return;
  const resolu = action === 'resolve';
  const cfg = obtenirConfigGuilde(guild.id);
  const salon = cfg.signalement_channel_id ? guild.channels.cache.get(String(cfg.signalement_channel_id)) : null;
  const salonOk = !!salon?.isTextBased?.() && !!cfg.signalement_enabled;
  const vus = new Set();
  for (const d of decides) {
    const cle = `${d.reporterId}:${d.targetId}`;
    if (vus.has(cle)) continue; // un seul message par signaleur et par membre signalé
    vus.add(cle);
    try {
      const lignes = [
        `<@${d.reporterId}>, un membre du staff a traité votre signalement.`,
        '',
        `👤 **Membre signalé** · <@${d.targetId}>${d.targetName ? ` (${d.targetName})` : ''}`,
        `📝 **Raison** · ${String(d.reason || 'Aucune').slice(0, 300)}`,
        `${resolu ? '✅' : '📁'} **Décision** · ${resolu ? 'Signalement résolu' : 'Classé sans suite'}`
      ];
      const embed = new EmbedBuilder()
        .setTitle(resolu ? '✅ Signalement traité' : '📁 Signalement traité')
        .setDescription(lignes.join('\n'))
        .setColor(resolu ? 0x43b581 : 0xe8510d)
        .setFooter({ text: 'Modération · CoreLab' })
        .setTimestamp();
      const payload = toCV2Payload({ embeds: [embed] });
      if (salonOk) {
        // seul le signaleur est notifié (pas le membre signalé)
        await salon.send({ ...payload, allowedMentions: { users: [String(d.reporterId)] } });
      } else {
        const user = await guild.client.users.fetch(d.reporterId);
        await user.send(payload);
      }
    } catch { /* salon inaccessible ou MP fermés : on ignore */ }
  }
}

module.exports = { notifierSignaleurs };