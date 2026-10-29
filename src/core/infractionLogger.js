// core/infractionLogger.js
const {
  AttachmentBuilder
} = require('discord.js');
const {
  generateLogCardAsync
} = require('../handlers/logCardImage');
const {
  obtenirConfigGuilde
} = require('./config');
const {
  pushEvent
} = require('./dashboardEvents');
const LIBELLES = {
  ban: '🔨 Bannissement',
  kick: '👢 Expulsion',
  mute: '🔇 Mute',
  unmute: '🔊 Démute',
  timeout: '⏳ Timeout',
  untimeout: '✅ Timeout retiré',
  warn: '⚠️ Avertissement'
};

// Icone dashboard par type d'infraction (retombe sur 🛡️ si type inconnu)
const ICONES_DASHBOARD = {
  ban: '🔨',
  kick: '👢',
  mute: '🔇',
  unmute: '🔊',
  timeout: '⏳',
  untimeout: '✅',
  warn: '⚠️'
};

const THEMES_CARTE = {
  ban: 'red',
  kick: 'orange',
  mute: 'amber',
  timeout: 'amber',
  warn: 'amber',
  unmute: 'green',
  untimeout: 'green'
};

/**
 * Envoie la carte image d'infraction dans le salon configuré (aucun embed).
 * @param {import('discord.js').Guild} guilde
 * @param {{type: string, target: import('discord.js').User, moderator: import('discord.js').User, reason?: string, duration?: string}} donnees
 */
async function journaliserInfraction(guilde, donnees) {
  // Dashboard : un evenement par infraction, independamment du salon configure.
  pushEvent({
    icon: ICONES_DASHBOARD[donnees.type] ?? '🛡️',
    tag: 'tag-mod',
    text: `${donnees.target.tag} — ${LIBELLES[donnees.type] ?? donnees.type} par ${donnees.moderator.tag}${donnees.reason ? ` — ${donnees.reason}` : ''}`,
    server: guilde.name
  });
  const config = obtenirConfigGuilde(guilde.id);
  // Destinations : salon des sanctions (s'il est configuré) + salon de logs de protection
  // (« 🛡️・logs-protection » par défaut), sans doublon si c'est le même salon.
  const { getProtectionLogChannelId } = require('./protectionLog');
  const ids = [...new Set([config.infraction_channel_id, getProtectionLogChannelId(config)].filter(Boolean).map(String))];
  const salons = ids.map(id => guilde.channels.cache.get(id)).filter(c => c?.isTextBased?.());
  if (!salons.length) return; // rien de configuré, on ne fait rien

  const titre = LIBELLES[donnees.type] ?? donnees.type;
  const raison = donnees.reason || 'Aucune raison fournie';
  try {
    const buf = await generateLogCardAsync({
      guildId: guilde.id,
      theme: THEMES_CARTE[donnees.type] ?? 'amber',
      title: titre,
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      blocks: [
        { label: 'Membre', value: donnees.target.username ?? donnees.target.tag },
        { label: 'Modérateur', value: donnees.moderator.username ?? donnees.moderator.tag },
        ...(donnees.duration ? [{ label: 'Durée', value: donnees.duration }] : [])
      ],
      quotes: [{ label: 'Raison', text: raison, maxLines: 4 }],
      footerLeft: `ID ${donnees.target.id}`,
      footerRight: guilde.name
    });
    for (const salon of salons) {
      await salon.send({
        files: [new AttachmentBuilder(buf, { name: 'infraction.png' })],
        allowedMentions: { parse: [] }
      }).catch(e => console.error('Erreur envoi infraction :', e.message));
    }
  } catch (e) {
    console.error('Erreur carte infraction :', e.message);
    // Secours texte (pas d'embed)
    const lignes = [
      `**${titre}**`,
      `Membre : ${donnees.target.tag} (${donnees.target.id})`,
      `Modérateur : ${donnees.moderator.tag}`,
      ...(donnees.duration ? [`Durée : ${donnees.duration}`] : []),
      `Raison : ${raison}`
    ];
    for (const salon of salons) {
      await salon.send({
        content: lignes.join('\n').slice(0, 1900),
        allowedMentions: { parse: [] }
      }).catch(() => { });
    }
  }
}
module.exports = {
  // export français d'origine
  journaliserInfraction,
  // alias anglais — pour compatibilité avec extended.js
  logInfraction: journaliserInfraction
};
