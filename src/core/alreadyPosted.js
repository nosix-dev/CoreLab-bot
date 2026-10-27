'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Anti-doublon « Discord = mémoire ».
//
// Sur Render (et tout hébergeur à disque éphémère), les fichiers JSON du bot
// reviennent à la version du dépôt à chaque déploiement : le bot « oublie » le
// dernier élément notifié (vidéo, live, clip, TikTok…) et le renvoie.
// Avant d'envoyer, on regarde donc si le bot a DÉJÀ posté cet élément dans le
// salon (les derniers messages du bot) : si oui, on ne le renvoie pas.
//
// Nécessite la permission « Voir les anciens messages » dans le salon ; sans
// elle (ou en cas d'erreur) on retombe sur l'ancien comportement.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cherche, parmi les derniers messages du bot dans `channel`, un message qui contient
 * l'un des `needles` (texte, embed, boutons-liens, composants V2).
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {string|string[]} needles   id / url à retrouver
 * @param {{limit?:number, maxAgeMs?:number}} [opts]
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function findPostedMessage(channel, needles, { limit = 50, maxAgeMs = 0 } = {}) {
  try {
    const list = [].concat(needles).filter(Boolean).map(String);
    if (!list.length || typeof channel?.messages?.fetch !== 'function') return null;
    const me = channel.client?.user?.id;
    const msgs = await channel.messages.fetch({ limit });
    const now = Date.now();
    for (const m of msgs.values()) {
      if (me && m.author?.id !== me) continue;
      if (maxAgeMs && now - m.createdTimestamp > maxAgeMs) continue;
      let blob = String(m.content || '');
      try { blob += JSON.stringify((m.embeds || []).map(e => (e.toJSON ? e.toJSON() : e))); } catch { /* ignoré */ }
      try { blob += JSON.stringify((m.components || []).map(c => (c.toJSON ? c.toJSON() : c))); } catch { /* ignoré */ }
      if (list.some(n => blob.includes(n))) return m;
    }
  } catch { /* pas d'accès à l'historique : ancien comportement */ }
  return null;
}

/** Version booléenne de findPostedMessage. */
async function alreadyPosted(channel, needles, opts) {
  return !!(await findPostedMessage(channel, needles, opts));
}

module.exports = { findPostedMessage, alreadyPosted };
