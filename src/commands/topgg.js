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

const data = new SlashCommandBuilder().setName('top-gg').setDescription('🗳️ Vote pour CoreLab sur top.gg');

function ts(ms) {
  return Math.floor(ms / 1000);
}

// Construit le panneau de vote (Components V2, barre blanche).
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

  const lignes = [
    `🔥 Série : **${serie}** jour(s) (record **${u.bestStreak}**) · 🗳️ **${u.totalVotes}** vote(s)`,
    `🎁 Vote, puis reviens : **+${votes.XP_PAR_VOTE} XP** sur ce serveur`,
    `✨ Chaque vote débloque aussi **${nom} Premium** pendant **${votes.PREMIUM_MS / 3600000} h**`,
    u.badge
      ? '💎 Badge **Supporter** débloqué !'
      : `💎 **${Math.min(u.totalVotes, votes.VOTES_BADGE)}/${votes.VOTES_BADGE}** votes pour le badge **Supporter**`
  ];
  if (votes.estWeekend(now)) lignes.push('🎉 Bonus weekend : les votes comptent **2×** en ce moment !');

  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🗳️ Vote pour ${nom}`));
  if (notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(notice).slice(0, 500)));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statut + (u.pending > 0 ? `\n🎁 **${u.pending}** récompense(s) à récupérer : **+${xpAttente} XP**` : '')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join('\n')));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Voter').setEmoji('🗳️').setStyle(ButtonStyle.Link).setURL(`https://top.gg/bot/${client.user.id}/vote`),
    new ButtonBuilder().setCustomId('topgg_claim').setLabel('Récupérer').setEmoji('🎁').setStyle(ButtonStyle.Success).setDisabled(u.pending <= 0),
    new ButtonBuilder().setCustomId('topgg_remind').setLabel(`Rappel : ${u.reminder ? 'oui' : 'non'}`).setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Page du bot').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(`https://top.gg/bot/${client.user.id}`)
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
    const u = votes.utilisateur(userId);
    if (u.pending <= 0) return interaction.update(buildPanel(client, userId, 'Aucune récompense à récupérer pour le moment : vote d\'abord !'));
    if (!interaction.guild || !interaction.member) {
      return interaction.update(buildPanel(client, userId, '⚠️ Récupère ta récompense XP depuis un serveur.'));
    }
    const cfg = getGuildConfig(interaction.guild.id);
    if (!cfg.xp_enabled) {
      return interaction.update(buildPanel(client, userId, '⚠️ Les niveaux sont désactivés sur ce serveur : récupère ta récompense sur un serveur où ils sont actifs.'));
    }
    const xp = votes.xpAPayer(u);
    try {
      const { grantXp } = require('../handlers/xpHandler');
      await grantXp(interaction.member, cfg, xp, 'vote');
    } catch (e) {
      console.error('[TopGG] Erreur crédit XP :', e.message);
      return interaction.update(buildPanel(client, userId, '❌ Impossible de créditer l\'XP pour le moment, réessaie dans un instant.'));
    }
    votes.marquerRecupere(userId);
    return interaction.update(buildPanel(client, userId, `🎁 Récompense récupérée : **+${xp} XP** sur ce serveur !`));
  }
}

module.exports = {
  data,
  execute,
  routeTopggInteraction,
  buildPanel
};