// src/core/reportNotify.js : prévient en MP le signaleur quand le staff a traité son signalement.
// Le message est envoyé uniquement en MP, jamais dans un salon : si les MP sont fermés, rien n'est envoyé.
const { EmbedBuilder } = require('discord.js');
const { toCV2Payload } = require('./componentsV2');

/**
 * @param {import('discord.js').Guild} guild
 * @param {'resolve'|'dismiss'} action
 * @param {Array<{reporterId: string, targetId: string, targetName?: string, reason?: string}>} decides signalements qui viennent d'être traités
 * @param {{label: string, duree?: string}|null} sanction sanction donnée au membre signalé (facultatif), affichée dans le MP
 */
async function notifierSignaleurs(guild, action, decides, sanction = null) {
  if (!guild || !Array.isArray(decides) || !decides.length) return;
  const resolu = action === 'resolve';
  const vus = new Set();
  for (const d of decides) {
    const cle = `${d.reporterId}:${d.targetId}`;
    if (vus.has(cle)) continue; // un seul message par signaleur et par membre signalé
    vus.add(cle);
    try {
      const lignes = [
        `Un membre du staff de **${guild.name}** a traité votre signalement.`,
        '',
        `👤 **Membre signalé** · <@${d.targetId}>${d.targetName ? ` (${d.targetName})` : ''}`,
        `📝 **Raison** · ${String(d.reason || 'Aucune').slice(0, 300)}`,
        `${resolu ? '✅' : '📁'} **Décision** · ${resolu ? 'Signalement résolu' : 'Classé sans suite'}`,
        ...(sanction && resolu ? [`🔨 **Sanction** · ${sanction.label}${sanction.duree ? ` (${sanction.duree})` : ''}`] : []),
        `🏠 **Serveur** · ${guild.name}`
      ];
      const embed = new EmbedBuilder()
        .setTitle(resolu ? '✅ Signalement traité' : '📁 Signalement traité')
        .setDescription(lignes.join('\n'))
        .setColor(resolu ? 0x43b581 : 0xe8510d)
        .setFooter({ text: 'Modération · CoreLab' })
        .setTimestamp();
      const user = await guild.client.users.fetch(d.reporterId);
      await user.send(toCV2Payload({ embeds: [embed] }));
    } catch { /* MP fermés ou utilisateur introuvable : on ignore */ }
  }
}

module.exports = { notifierSignaleurs };