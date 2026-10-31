'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Note de 1 à 5 étoiles après la fermeture d'un ticket.
//  • buildClosedTicketMessage(...) : le MP envoyé à la personne qui a ouvert le ticket
//  • handleRatingButton(interaction) : clic sur une étoile → remercie le membre
//    et envoie l'avis (quelle que soit la note) dans le salon de logs du serveur.
// customId : ticketrate:<guildId>:<openerId>:<numéro>:<étoiles>
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const PREFIX = 'ticketrate';
const SEPARATEUR_NOTE = '\n\n'; // sépare le récap du ticket de la phrase « Comment ça s'est passé ? »

// 1★ 2★ gris, 3★ bleu, 4★ 5★ vert (comme sur la capture)
const STYLES = [ButtonStyle.Secondary, ButtonStyle.Secondary, ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Success];

function etoiles(n) { return '⭐'.repeat(n); }

function buildRatingRow(guildId, openerId, numero, choisi = null) {
  const row = new ActionRowBuilder();
  for (let i = 1; i <= 5; i++) {
    const btn = new ButtonBuilder()
      .setCustomId(`${PREFIX}:${guildId}:${openerId}:${numero}:${i}`)
      .setLabel(`${i}★`)
      .setStyle(choisi === null ? STYLES[i - 1] : (i === choisi ? ButtonStyle.Success : ButtonStyle.Secondary));
    if (choisi !== null) btn.setDisabled(true);
    row.addComponents(btn);
  }
  return row;
}

// Message envoyé en MP à la personne qui a ouvert le ticket
function buildClosedTicketMessage({ guild, closer, numero, raison, ouvertLe, openerId }) {
  const embed = new EmbedBuilder()
    .setColor(0xE91E63)
    .setTitle(`🔒 Ton ticket sur ${guild.name} est fermé`)
    .setDescription([
      `🎫 **Ticket :** #${numero} · ${String(raison || '—').slice(0, 100)}`,
      `🕐 **Ouvert le :** <t:${ouvertLe}:f>`,
      `🔒 **Fermé par :** <@${closer.id}>`,
      `✏️ **Motif :** —`,
    ].join('\n') + `${SEPARATEUR_NOTE}Comment ça s'est passé ? Note l'aide reçue.`);
  return {
    embeds: [embed],
    components: [buildRatingRow(guild.id, openerId, numero)],
    allowedMentions: { parse: [] },
  };
}

async function handleRatingButton(interaction) {
  const [, guildId, openerId, numero, notes] = interaction.customId.split(':');
  const note = Math.min(5, Math.max(1, parseInt(notes, 10) || 0));

  if (interaction.user.id !== openerId) {
    return interaction.reply({ content: '❌ Seule la personne qui a ouvert le ticket peut le noter.', flags: MessageFlags.Ephemeral });
  }

  // 1) On remercie le membre : le message est mis à jour, les boutons sont désactivés
  const original = interaction.message.embeds[0];
  const recap = (original?.description ?? original?.data?.description ?? '').split(SEPARATEUR_NOTE)[0];
  const merci = EmbedBuilder.from(original)
    .setDescription(`${recap}${SEPARATEUR_NOTE}✅ Merci pour ton avis ! ${etoiles(note)} (${note}/5)`);
  await interaction.update({ embeds: [merci], components: [buildRatingRow(guildId, openerId, numero, note)] });

  // 2) L'avis arrive dans le salon de logs du serveur, quelle que soit la note
  try {
    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild) return;
    const couleur = note <= 2 ? 0xE74C3C : note === 3 ? 0xF39C12 : 0x2ECC71;
    const log = new EmbedBuilder()
      .setColor(couleur)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setTitle(`⭐ Avis sur le ticket #${numero}`)
      .addFields(
        { name: '👤 Membre', value: `<@${openerId}> (${interaction.user.tag})`, inline: true },
        { name: '⭐ Note', value: `${etoiles(note)} **${note}/5**`, inline: true },
      )
      .setTimestamp();
    if (recap) log.setDescription(recap);
    await require('../handlers/logs').sendLog(guild, log);
  } catch (e) {
    console.error('[Ticket] Avis non envoyé dans les logs :', e.message);
  }
}

module.exports = { PREFIX, buildClosedTicketMessage, handleRatingButton };
