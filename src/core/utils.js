const {
  EmbedBuilder
} = require('discord.js');
const {
  obtenirConfigGuilde
} = require('./config');
async function envoyerLog(guilde, embed, categorie = null) {
  if (!guilde) return;
  const config = obtenirConfigGuilde(guilde.id);
  if (categorie && config[categorie] === false) return; // type de log désactivé
  const idSalonLog = config.log_channel_id;
  if (!idSalonLog) return;
  const salon = guilde.channels.cache.get(idSalonLog);
  if (salon?.isTextBased?.()) {
    try {
      // Carte « verre fumé » (retombe sur l'embed classique si le rendu image échoue)
      const emb = embed instanceof EmbedBuilder ? embed : new EmbedBuilder(embed);
      const { glassPayload } = require('./glassEmbed');
      await salon.send(await glassPayload({ embeds: [emb] }, { guild: guilde, badge: categorie === 'log_sanctions' ? 'SANCTION' : 'LOG' }));
    } catch (erreur) {
      console.error('Erreur log:', erreur.message);
    }
  }
}
function tronquer(texte, longueurMax = 1000) {
  if (texte == null) return '';
  if (texte.length > longueurMax) return texte.slice(0, longueurMax - 3) + '...';
  return texte;
}
module.exports = {
  // exports français d'origine
  envoyerLog,
  tronquer,
  // alias anglais — pour compatibilité avec antiScam.js et moderation.js
  sendLog: envoyerLog,
  truncate: tronquer
};