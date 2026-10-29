// Messages du bot à ne JAMAIS journaliser (envoi / suppression / modification).
// Utilisé pour le message d'explication du StarBoard, supprimé et renvoyé après chaque photo.
const ids = new Set();

function mute(id) {
  if (!id) return;
  ids.add(String(id));
  // Nettoyage différé : l'événement de suppression arrive en quelques secondes au plus
  setTimeout(() => ids.delete(String(id)), 10 * 60 * 1000).unref?.();
}
function isMuted(id) {
  return !!id && ids.has(String(id));
}
module.exports = { mute, isMuted };
