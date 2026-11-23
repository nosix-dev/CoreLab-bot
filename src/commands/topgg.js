const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const votes = require('../core/topggVotes');
const supporter = require('../core/supporter');

const reclamationsEnCours = new Set();
const BOTILLON_URL = 'https://botillon.fr/bots/1403513450273177772';

const data = new SlashCommandBuilder().setName('vote-bot').setDescription('🗳️ Vote pour CoreLab sur top.gg et Botillon');

function ts(ms) {
  return Math.floor(ms / 1000);
}

// Construit le panneau de vote (Components V2, barre orange).
// `notice` : petite ligne optionnelle affichée sous le titre (résultat d'un clic sur un bouton).
function buildPanel(client, userId, notice = null) {
  const u = votes.utilisateur(userId);
  const now = Date.now();
  const nom = client.user.username;
  const prochain = votes.peutRevoterA(u);
  const aVoteRecemment = prochain > now;
  const serie = votes.serieActive(u, now) ? u.streak : 0;
  const xpAttente = votes.xpAPayer(u);

  let statut;
  if (aVoteRecemment) statut = `✅ Merci pour ton vote ! Prochain vote possible <t:${ts(prochain)}:R>.`;
  else if (u.totalVotes > 0) statut = '🗳️ Tu peux voter de nouveau ! Vote pour nous soutenir !';
  else statut = '❌ Tu n\'as pas encore voté. Vote pour nous soutenir !';

  const sup = supporter.info(userId);
  const xpParVote = votes.XP_PAR_VOTE + (u.badge ? supporter.XP_BONUS_PAR_VOTE : 0);
  // Prochain palier (Supporter 5 → Fidèle 25 → Légende 100)
  const suivant = [...supporter.PALIERS].reverse().find(p => u.totalVotes < p.min);
  const lignes = [
    `🔥 Série : **${serie}** jour(s) (record **${u.bestStreak}**) · 🗳️ **${u.totalVotes}** vote(s)`,
    `🎁 Vote, puis reviens : **+${xpParVote} XP** sur ce serveur`,
    sup
      ? `${sup.label} — badge débloqué !${suivant ? ` Prochain palier : **${suivant.emoji} ${suivant.nom}** (${u.totalVotes}/${suivant.min})` : ' Palier maximum atteint 🎉'}`
      : `💎 **${Math.min(u.totalVotes, votes.VOTES_BADGE)}/${votes.VOTES_BADGE}** votes pour le badge **Supporter**`
  ];
  if (votes.estWeekend(now)) lignes.push('🎉 Bonus weekend : les votes comptent **2×** en ce moment !');

  const avantages = [
    `+${Math.round((supporter.XP_MULTIPLICATEUR - 1) * 100)} % d'XP sur les messages et cooldown d'XP réduit`,
    `+${supporter.XP_BONUS_PAR_VOTE} XP par vote récupéré`,
    `+${Math.round(supporter.SALAIRE_BONUS * 100)} % sur /eco travailler`,
    '1 tour de roue offert par jour',
    'Badge affiché sur tes cartes (niveau, classement, porte-monnaie) + carte de niveau dorée',
    'Rôle Supporter sur le serveur de support'
  ];
  const top = votes.topVoteurs(5);
  const topTexte = top.length
    ? top.map((t, i) => `${['🥇', '🥈', '🥉'][i] || `**${i + 1}.**`} <@${t.id}> — **${t.votes}** votes`).join('\n')
    : null;

  const container = new ContainerBuilder().setAccentColor(0xE8510D);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🗳️ Vote pour ${nom}`));
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 500)));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statut + (u.pending > 0 ? `\n🎁 **${u.pending}** récompense(s) à récupérer : **+${xpAttente} XP**` : '')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join('\n')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**${sup ? '✨ Tes avantages Supporter' : '💎 Avantages Supporter (dès 5 votes)'}**\n` + avantages.map(a => `• ${a}`).join('\n')
  ));
  if (topTexte) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🏆 Top voteurs**\n${topTexte}`));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Voter (top.gg)').setEmoji('🗳️').setStyle(ButtonStyle.Link).setURL(`https://top.gg/bot/${client.user.id}/vote`),
    new ButtonBuilder().setCustomId('topgg_claim').setLabel('Récupérer').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('topgg_remind').setLabel(`Rappel : ${u.reminder ? 'oui' : 'non'}`).setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Page du bot').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(`https://top.gg/bot/${client.user.id}`),
    new ButtonBuilder().setLabel('Botillon').setEmoji('🤖').setStyle(ButtonStyle.Link).setURL(BOTILLON_URL)
  );
  container.addActionRowComponents(row);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '-# Un vote toutes les 12 h sur top.gg. Revote en moins de 36 h pour garder ta série (plus d\'XP chaque jour). ' +
    'L\'XP va au serveur où tu la récupères, si les niveaux sont actifs.'
  ));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function execute(interaction) {
  const panel = buildPanel(interaction.client, interaction.user.id);
  await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

// Boutons du panneau (appelé depuis index.js pour les customId « topgg_* »).
async function routeTopggInteraction(interaction) {
  const client = interaction.client;
  const userId = interaction.user.id;

  if (interaction.customId === 'topgg_remind') {
    const actif = votes.basculerRappel(userId);
    return interaction.update(buildPanel(client, userId, actif
      ? '🔔 Rappel activé : je t\'envoie un MP quand tu pourras revoter (pense à garder tes MP ouverts).'
      : '🔕 Rappel désactivé.'));
  }

  if (interaction.customId === 'topgg_claim') {
    // Accuse réception tout de suite : crédit XP + carte de niveau peuvent dépasser 3 s (sinon « échec de l'interaction »).
    try { await interaction.deferUpdate(); } catch { return; }
    const maj = notice => interaction.editReply(buildPanel(client, userId, notice)).catch(e => console.error('[TopGG] editReply :', e.message));

    // Anti double-clic : une seule récupération à la fois par membre.
    if (reclamationsEnCours.has(userId)) return;
    reclamationsEnCours.add(userId);
    try {
      const u = votes.utilisateur(userId);
      if (u.pending <= 0) return await maj('Aucune récompense à récupérer pour le moment : vote d\'abord sur top.gg, puis reviens ici.');
      if (!interaction.guild || !interaction.member) return await maj('⚠️ Récupère ta récompense XP depuis un serveur.');
      const cfg = getGuildConfig(interaction.guild.id);
      if (!cfg.xp_enabled) return await maj('⚠️ Les niveaux sont désactivés sur ce serveur : récupère ta récompense sur un serveur où ils sont actifs.');

      // On retire la récompense AVANT de créditer l'XP (évite de la payer deux fois), et on la remet si le crédit échoue.
      const xp = votes.xpAPayer(u);
      const payes = votes.marquerRecupere(userId);
      try {
        const { grantXp } = require('../handlers/xpHandler');
        await grantXp(interaction.member, cfg, xp, 'vote');
      } catch (e) {
        console.error('[TopGG] Erreur crédit XP :', e.message);
        votes.utilisateur(userId).pending += payes;
        return await maj('❌ Impossible de créditer l\'XP pour le moment, réessaie dans un instant.');
      }
      supporter.syncRole(client, userId).catch(() => {});
      return await maj(`🎁 Récompense récupérée : **+${xp} XP** sur ce serveur !`);
    } finally {
      reclamationsEnCours.delete(userId);
    }
  }
}

module.exports = {
  data,
  execute,
  routeTopggInteraction,
  buildPanel
};