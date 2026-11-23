// src/core/reportNotify.js : prévient en MP la personne qui a fait un signalement quand le staff l'a traité.
const { EmbedBuilder } = require('discord.js');
const { toCV2Payload } = require('./componentsV2');

/**
 * @param {import('discord.js').Guild} guild
 * @param {'resolve'|'dismiss'} action
 * @param {Array<{reporterId: string, targetId: string, targetName?: string, reason?: string}>} decides signalements qui viennent d'être traités
 */
async function notifierSignaleurs(guild, action, decides) {
  if (!guild || !Array.isArray(decides) || !decides.length) return;
  const resolu = action === 'resolve';
  const vus = new Set();
  for (const d of decides) {
    const cle = `${d.reporterId}:${d.targetId}`;
    if (vus.has(cle)) continue; // un seul message par signaleur et par membre signalé
    vus.add(cle);
    try {
      const user = await guild.client.users.fetch(d.reporterId);
      const lignes = [
        `Un membre du staff de **${guild.name}** a traité ton signalement.`,
        '',
        `👤 **Membre signalé** · <@${d.targetId}>${d.targetName ? ` (${d.targetName})` : ''}`,
        `📝 **Ta raison** · ${String(d.reason || 'Aucune').slice(0, 300)}`,
        `${resolu ? '✅' : '📁'} **Décision** · ${resolu ? 'Signalement résolu' : 'Classé sans suite'}`,
        `🏠 **Serveur** · ${guild.name}`
      ];
      const embed = new EmbedBuilder()
        .setTitle(resolu ? '✅ Signalement traité' : '📁 Signalement traité')
        .setDescription(lignes.join('\n'))
        .setColor(resolu ? 0x43b581 : 0xe8510d)
        .setFooter({ text: 'Modération · CoreLab' })
        .setTimestamp();
      await user.send(toCV2Payload({ embeds: [embed] }));
    } catch { /* MP fermés ou utilisateur introuvable : on ignore */ }
  }
}

module.exports = { notifierSignaleurs };
