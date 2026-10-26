"use strict";
/**
 * Petit "event bus" en memoire : chaque handler existant du bot
 * (infractionLogger, XP, tickets, welcome/goodbye, notifs RSS...)
 * appelle pushEvent(...) a l'endroit ou l'action se produit deja.
 * Aucune dependance externe, aucun changement de logique metier.
 */

const buffer = [];
const MAX_EVENTS = 60;

/**
 * @param {object} entry
 * @param {string} entry.icon   emoji d'illustration, ex "🛡️"
 * @param {string} entry.tag    "tag-mod" | "tag-notif" | "tag-sys" | "tag-xp"
 * @param {string} entry.text   texte lisible, ex "Nosix warn par un mod — spam"
 * @param {string} [entry.server] nom du serveur concerne
 */
function pushEvent(entry) {
  if (!entry || !entry.text) return;
  buffer.unshift({
    time: new Date().toISOString(),
    icon: entry.icon || "📋",
    tag: entry.tag || "tag-sys",
    text: entry.text,
    server: entry.server || "—",
  });
  if (buffer.length > MAX_EVENTS) buffer.length = MAX_EVENTS;
}

function getEvents(limit = 20) {
  return buffer.slice(0, limit);
}

module.exports = { pushEvent, getEvents };