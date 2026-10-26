const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const {
  getGuildConfig
} = require('../core/config');
const {
  getGuildBucket,
  setGuildBucket
} = require('../core/data');

// Détecte discord.gg/xxx, discord.com/invite/xxx et discordapp.com/invite/xxx
const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;

// Renvoie le timestamp du lundi 00:00 de la semaine de la date donnée
function debutSemaine(date) {
  const d = new Date(date);
  const jour = (d.getDay() + 6) % 7; // 0 = lundi ... 6 = dimanche
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - jour);
  return d.getTime();
}
function registerPartnershipAutoHandler(client) {
  client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const cfg = getGuildConfig(message.guild.id);
    const conf = cfg.partenariatAuto;
    if (!conf?.salonId) return;
    if (message.channel.id !== conf.salonId) return;
    const match = message.content && message.content.match(INVITE_REGEX);
    if (!match) return;
    try {
      // 1) Attribution du rôle partenaire (si configuré)
      if (conf.roleId && message.member && !message.member.roles.cache.has(conf.roleId)) {
        try {
          await message.member.roles.add(conf.roleId);
        } catch (e) {
          console.error('[PartenariatAuto] Erreur attribution rôle :', e.message);
        }
      }

      // 2) Enregistrement de l'entrée + calcul des statistiques
      const bucket = getGuildBucket(message.guild.id, 'partenariatsAuto', []);
      const maintenant = Date.now();
      bucket.push({
        userId: message.author.id,
        lien: match[0],
        messageId: message.id,
        createdAt: maintenant
      });
      setGuildBucket(message.guild.id, 'partenariatsAuto', bucket);
      const total = bucket.length;
      const debut = debutSemaine(maintenant);
      const cetteSemaine = bucket.filter(e => e.createdAt >= debut).length;
      const classement = total;

      // 3) Annonce
      const embed = new EmbedBuilder().setColor(0x57F287).setTitle(conf.titre || '✅ Nouveaux Partenariat').setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL?.() || null,
        url: match[0]
      }).setThumbnail(message.author.displayAvatarURL?.() || null).setDescription(`${conf.description ? `${conf.description}\n\n` : ''}` + `Merci pour votre partenariat !` + (match[0] ? `\n\n🔗 ${match[0]}` : '')).addFields({
        name: '📋 Total',
        value: `${total} partenariat${total > 1 ? 's' : ''}`,
        inline: true
      }, {
        name: '🏆 Cette semaine',
        value: `${cetteSemaine} partenariat${cetteSemaine > 1 ? 's' : ''}`,
        inline: true
      }, {
        name: '🥇 Classement',
        value: `n°${classement} sur ce serveur`,
        inline: true
      }).setFooter({
        text: `CoreLab • Aujourd'hui à ${new Date(maintenant).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit'
        })}`,
        iconURL: client.user.displayAvatarURL?.()
      }).setTimestamp();
      const files = [];
      if (conf.imagePath && fs.existsSync(conf.imagePath)) {
        const nomFichier = path.basename(conf.imagePath);
        files.push(new AttachmentBuilder(conf.imagePath, {
          name: nomFichier
        }));
        embed.setImage(`attachment://${nomFichier}`);
      }
      await message.channel.send({
        content: `🔵 Merci à ${message.author} !`,
        embeds: [embed],
        files
      });
    } catch (e) {
      console.error('[PartenariatAuto] Erreur traitement :', e.message);
    }
  });
}
module.exports = {
  registerPartnershipAutoHandler
};