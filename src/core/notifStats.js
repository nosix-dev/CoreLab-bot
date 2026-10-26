"use strict";
/**
 * Nombre de sources suivies par type de notification.
 * Appelle addNotifSource("youtube") / removeNotifSource("youtube")
 * (ou "medal" / "blog") aux endroits ou tu ajoutes/retires un suivi
 * dans tes commandes de config de notifications.
 *
 * Si tu stockes deja ces suivis dans une config par guilde
 * (getGuildConfig), remplace directement getNotifCounts() par un
 * vrai comptage sur l'ensemble des guildes plutot que ces compteurs
 * en memoire — c'est juste un point de depart simple.
 */

const counts = { youtube: 0, medal: 0, blog: 0 };

function addNotifSource(type) {
  if (type in counts) counts[type]++;
}
function removeNotifSource(type) {
  if (type in counts) counts[type] = Math.max(0, counts[type] - 1);
}
function getNotifCounts() {
  return { ...counts, total: counts.youtube + counts.medal + counts.blog };
}

module.exports = { addNotifSource, removeNotifSource, getNotifCounts };