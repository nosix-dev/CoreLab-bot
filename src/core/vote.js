const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const {
  stockage,
  persister
} = require('./data');
const {
  toCV2Payload
} = require("./componentsV2");
const { glassPayload } = require('./glassEmbed');
const COULEUR_DEFAUT = 0xFFFFFF;
const EMOJIS_OPTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const MAX_OPTIONS = 8;
const MAX_IMAGES = 4;

// Normalise les images d'un sondage vers un tableau, en conservant la
// compatibilité avec les anciens sondages stockés avec un simple `imageUrl`.
function obtenirImagesSondage(sondage) {
  if (Array.isArray(sondage.imageUrls) && sondage.imageUrls.length) return sondage.imageUrls;
  if (sondage.imageUrl) return [sondage.imageUrl];
  return [];
}
function hexToInt(hex) {
  if (!hex) return null;
  const clean = String(hex).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
}
function genererIdSondage() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function obtenirCompartimentSondages(guildId) {
  if (!stockage.sondages) stockage.sondages = {};
  const id = String(guildId);
  if (!stockage.sondages[id]) stockage.sondages[id] = {};
  return stockage.sondages[id];
}
function obtenirSondage(guildId, pollId) {
  return obtenirCompartimentSondages(guildId)[pollId] || null;
}
function sauvegarderSondage(guildId, pollId, sondage) {
  obtenirCompartimentSondages(guildId)[pollId] = sondage;
  persister('sondages');
}
function construireBarre(votes, total, taille = 12) {
  if (total === 0) return '░'.repeat(taille);
  const rempli = Math.round(votes / total * taille);
  return '█'.repeat(rempli) + '░'.repeat(taille - rempli);
}
function construireEmbedsSondage(sondage) {
  const totalVotes = sondage.options.reduce((s, o) => s + o.voters.length, 0);
  const description = sondage.options.map((o, i) => {
    const pct = totalVotes ? Math.round(o.voters.length / totalVotes * 100) : 0;
    return `${EMOJIS_OPTIONS[i]} **${o.label}**\n${construireBarre(o.voters.length, totalVotes)} ${pct}% (${o.voters.length})`;
  }).join('\n\n');
  const couleur = sondage.couleur ?? COULEUR_DEFAUT;
  const embed = new EmbedBuilder().setTitle(sondage.titre || `📊 ${sondage.question}`).setColor(couleur).setFooter({
    text: sondage.ferme ? `Sondage clos • ${totalVotes} vote(s)` : `${totalVotes} vote(s) • Clique sur une option pour voter`
  });
  if (sondage.titre) embed.setDescription(`**${sondage.question}**\n\n${description}`);else embed.setDescription(description);
  const images = obtenirImagesSondage(sondage);
  if (sondage.finTimestamp) embed.addFields({
    name: 'Fin',
    value: `<t:${Math.floor(sondage.finTimestamp / 1000)}:R>`,
    inline: true
  });
  const embeds = [embed];
  if (images.length) {
    // Astuce Discord : quand plusieurs embeds partagent la même URL,
    // leurs images sont regroupées côte à côte (galerie en grille)
    // au lieu d'être empilées verticalement les unes sous les autres.
    const urlGalerie = `https://corelab.local/sondage/${sondage.pollId || genererIdSondage()}`;
    embed.setURL(urlGalerie);
    embed.setImage(images[0]);
    for (let i = 1; i < images.length; i++) {
      embeds.push(new EmbedBuilder().setColor(couleur).setURL(urlGalerie).setImage(images[i]));
    }
  }
  return embeds;
}
// Version « carte verre fumé » : une pastille + barre de progression par option (image = 1re image du sondage)
function construireEmbedGlassSondage(sondage) {
  const totalVotes = sondage.options.reduce((s, o) => s + o.voters.length, 0);
  const couleur = sondage.couleur ?? COULEUR_DEFAUT;
  const embed = new EmbedBuilder().setTitle(sondage.titre || `📊 ${sondage.question}`).setColor(couleur);
  if (sondage.titre) embed.setDescription(sondage.question);
  embed.addFields(...sondage.options.map((o, i) => {
    const n = o.voters.length;
    const pct = totalVotes ? Math.round(n / totalVotes * 100) : 0;
    return { name: `${EMOJIS_OPTIONS[i]} ${o.label}`, value: `${construireBarre(n, totalVotes)} ${pct}% · ${n} vote${n > 1 ? 's' : ''}`, inline: false };
  }));
  const fin = sondage.finTimestamp && !sondage.ferme ? ` • fin <t:${Math.floor(sondage.finTimestamp / 1000)}:R>` : '';
  embed.setFooter({ text: (sondage.ferme ? `Sondage clos • ${totalVotes} vote(s)` : `${totalVotes} vote(s) • Clique sur une option pour voter`) + fin });
  const images = obtenirImagesSondage(sondage);
  if (images.length) embed.setImage(images[0]);
  return embed;
}
function construireLignesBoutons(sondage, pollId) {
  const rows = [];
  let row = new ActionRowBuilder();
  sondage.options.forEach((o, i) => {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(new ButtonBuilder().setCustomId(`vote_${pollId}_${i}`).setEmoji(EMOJIS_OPTIONS[i]).setLabel(o.label.slice(0, 60)).setStyle(ButtonStyle.Secondary).setDisabled(!!sondage.ferme));
  });
  rows.push(row);
  if (rows[rows.length - 1].components.length >= 5) rows.push(new ActionRowBuilder());
  rows[rows.length - 1].addComponents(new ButtonBuilder().setCustomId(`vote_fermer_${pollId}`).setLabel('🔒 Clôturer').setStyle(ButtonStyle.Danger).setDisabled(!!sondage.ferme));
  return rows;
}
async function fermerSondage(guildId, pollId, message) {
  const sondage = obtenirSondage(guildId, pollId);
  if (!sondage || sondage.ferme) return;
  sondage.ferme = true;
  sauvegarderSondage(guildId, pollId, sondage);
  try {
    await message.edit(await glassPayload({
      embeds: [construireEmbedGlassSondage(sondage)],
      components: construireLignesBoutons(sondage, pollId)
    }, { guildId, client: message.client, badge: sondage.ferme ? 'SONDAGE · CLOS' : 'SONDAGE', update: true }));
  } catch (erreur) {
    console.error('[Vote] Erreur clôture sondage :', erreur.message);
  }
}
async function gererBoutonVote(interaction) {
  const id = interaction.customId;
  const guildId = interaction.guild.id;
  if (id.startsWith('vote_fermer_')) {
    const pollId = id.replace('vote_fermer_', '');
    const sondage = obtenirSondage(guildId, pollId);
    if (!sondage) return interaction.reply({
      content: '❌ Sondage introuvable.',
      flags: MessageFlags.Ephemeral
    });
    const estAuteur = sondage.auteurId === interaction.user.id;
    const estAdmin = interaction.member?.permissions.has('ManageGuild');
    if (!estAuteur && !estAdmin) {
      return interaction.reply({
        content: '❌ Seul l\'auteur du sondage ou un administrateur peut le clôturer.',
        flags: MessageFlags.Ephemeral
      });
    }
    await fermerSondage(guildId, pollId, interaction.message);
    return interaction.reply({
      content: '🔒 Sondage clôturé.',
      flags: MessageFlags.Ephemeral
    });
  }
  const [, pollId, indexStr] = id.split('_');
  const optionIndex = parseInt(indexStr, 10);
  const sondage = obtenirSondage(guildId, pollId);
  if (!sondage) return interaction.reply({
    content: '❌ Ce sondage n\'existe plus.',
    flags: MessageFlags.Ephemeral
  });
  if (!sondage.ferme && sondage.finTimestamp && Date.now() >= sondage.finTimestamp) {
    await fermerSondage(guildId, pollId, interaction.message);
    return interaction.reply({
      content: '⏱️ Ce sondage vient de se terminer.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (sondage.ferme) {
    return interaction.reply({
      content: '🔒 Ce sondage est clos.',
      flags: MessageFlags.Ephemeral
    });
  }
  const userId = interaction.user.id;
  const dejaVoteIndex = sondage.options.findIndex(o => o.voters.includes(userId));
  let messageRetour;
  if (dejaVoteIndex === optionIndex) {
    sondage.options[optionIndex].voters = sondage.options[optionIndex].voters.filter(v => v !== userId);
    messageRetour = '↩️ Ton vote a été retiré.';
  } else {
    if (dejaVoteIndex !== -1) sondage.options[dejaVoteIndex].voters = sondage.options[dejaVoteIndex].voters.filter(v => v !== userId);
    sondage.options[optionIndex].voters.push(userId);
    messageRetour = `✅ Tu as voté pour **${sondage.options[optionIndex].label}**.`;
  }
  sauvegarderSondage(guildId, pollId, sondage);
  try {
    // Le rendu de la carte peut dépasser 3 s la 1re fois (images) : on accuse réception d'abord.
    await interaction.deferUpdate();
    await interaction.editReply(await glassPayload({
      embeds: [construireEmbedGlassSondage(sondage)],
      components: construireLignesBoutons(sondage, pollId)
    }, { guildId, client: interaction.client, badge: 'SONDAGE', update: true }));
    await interaction.followUp({
      content: messageRetour,
      flags: MessageFlags.Ephemeral
    });
  } catch (erreur) {
    console.error('[Vote] Erreur mise à jour sondage :', erreur.message);
  }
}
async function routeVoteInteraction(interaction) {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('vote_')) {
      return gererBoutonVote(interaction);
    }
  } catch (e) {
    console.error('Erreur d\'interaction vote :', e);
    const payload = {
      content: '❌ Une erreur est survenue.',
      flags: MessageFlags.Ephemeral
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);else await interaction.reply(payload);
    } catch {}
  }
}
module.exports = {
  hexToInt,
  genererIdSondage,
  obtenirSondage,
  sauvegarderSondage,
  construireEmbedsSondage,
  construireEmbedGlassSondage,
  construireLignesBoutons,
  fermerSondage,
  routeVoteInteraction,
  MAX_OPTIONS,
  MAX_IMAGES
};