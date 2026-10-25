// ────────────────────────────────────────────────
// automodOnJoin.js — Proposition d'activation de l'AutoMod à l'invitation
// À l'ajout du bot, un MP est envoyé à l'inviteur (ou, à défaut, au
// propriétaire) avec un bouton « Activer l'AutoMod ». Rien n'est créé sur le
// serveur sans ce clic, et seul un membre ayant « Gérer le serveur » peut
// valider. Réutilise les règles de commands/automod.js (idempotent).
// ────────────────────────────────────────────────
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  AuditLogEvent
} = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { persist } = require('../core/data');
const { setupGuild } = require('../commands/automod');

const COLLECTOR_TIME = 2 * 60 * 60 * 1000; // 2 h (lecture en MP rarement immédiate)

async function findInviter(guild, client) {
  const chercher = async () => {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }).catch(() => null);
    return logs?.entries.find(e => e.target?.id === client.user.id)?.executor ?? null;
  };
  let inviter = await chercher();
  if (!inviter) {
    // Les logs d'audit apparaissent parfois avec quelques secondes de retard
    await new Promise(r => setTimeout(r, 2500));
    inviter = await chercher();
  }
  return inviter;
}

function buildPromptRow(guildId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`automod_join_enable_${guildId}`)
      .setLabel("Activer l'AutoMod")
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`automod_join_skip_${guildId}`)
      .setLabel('Non merci')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function buildPromptEmbed(guild, client, botPeutAgir) {
  const embed = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle("🛡️ Activer l'AutoMod sur votre serveur ?")
    .setDescription(
      `Merci d'avoir ajouté **CoreLab** sur **${guild.name}** !\n\n` +
      "Je peux créer des règles **AutoMod natives de Discord** (préfixées `[CoreLab]`) :\n" +
      '• filtre de contenu sensible (mots interdits Discord)\n' +
      '• anti mention-spam (8 mentions max par message)\n' +
      '• anti-scam : liens de phishing / IP loggers connus\n' +
      '• anti-typosquat (faux liens Discord / Steam)\n\n' +
      "Les règles ne touchent pas à celles déjà créées par votre staff et vous pouvez les modifier ou les supprimer à tout moment dans *Paramètres du serveur → AutoMod*. " +
      "Rien n'est créé sans votre confirmation."
    )
    .setFooter({ text: guild.name, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
  if (!botPeutAgir) {
    embed.addFields({
      name: '⚠️ Permission manquante',
      value: "Je n'ai pas la permission **Gérer le serveur** sur ce serveur : accordez-la à mon rôle avant de cliquer sur « Activer »."
    });
  }
  return embed;
}

function registerAutomodOnJoinHandler(client) {
  client.on('guildCreate', async guild => {
    try {
      const cfg = getGuildConfig(guild.id);
      // Réinvitation après un kick : on ne redemande pas si déjà activé
      if (cfg.automodOnJoin === 'enabled') return;

      const inviter = await findInviter(guild, client);
      const owner = await guild.fetchOwner().then(m => m.user).catch(() => null);
      const candidats = [inviter, owner].filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);
      if (!candidats.length) return;

      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      const botPeutAgir = !!me?.permissions.has(PermissionFlagsBits.ManageGuild);

      let msg = null;
      for (const user of candidats) {
        try {
          msg = await user.send({
            embeds: [buildPromptEmbed(guild, client, botPeutAgir)],
            components: [buildPromptRow(guild.id)]
          });
          break;
        } catch (e) {
          // MP fermés (50007) : on tente le destinataire suivant
          if (e?.code !== 50007) console.error('MP AutoMod (ajout du bot) non envoyé :', e.message);
        }
      }
      if (!msg) return;

      const collector = msg.createMessageComponentCollector({ time: COLLECTOR_TIME });

      collector.on('collect', async i => {
        try {
          if (i.customId === `automod_join_skip_${guild.id}`) {
            cfg.automodOnJoin = 'declined';
            persist('config');
            await i.update({
              content: "👌 Pas de souci. Vous pourrez l'activer plus tard avec la commande d'AutoMod du bot.",
              embeds: [],
              components: []
            });
            return collector.stop('skip');
          }
          if (i.customId !== `automod_join_enable_${guild.id}`) return;

          // Seul un membre autorisé du serveur peut valider
          const membre = await guild.members.fetch(i.user.id).catch(() => null);
          if (!membre?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return i.reply({
              content: '❌ Il faut la permission **Gérer le serveur** sur ce serveur pour activer l\'AutoMod.',
              ephemeral: true
            });
          }

          await i.update({ components: [buildPromptRow(guild.id, true)] });
          const res = await setupGuild(guild);

          let texte;
          if (res.status === 'skip') {
            texte = "❌ Il me manque la permission **Gérer le serveur**. Accordez-la à mon rôle puis réinvitez-moi ou relancez l'activation.";
          } else if (res.status === 'error') {
            texte = `❌ Impossible de lire/créer les règles AutoMod : ${res.reason}`;
          } else {
            cfg.automodOnJoin = 'enabled';
            persist('config');
            texte = res.status === 'partial'
              ? `⚠️ ${res.created} règle(s) créée(s), mais certaines ont échoué :\n${res.errors.slice(0, 5).join('\n')}`
              : res.created > 0
                ? `✅ AutoMod activé sur **${guild.name}** : ${res.created} règle(s) créée(s).`
                : `✅ L'AutoMod CoreLab est déjà en place sur **${guild.name}**.`;
          }
          await i.editReply({ content: texte, embeds: [], components: [] });
          collector.stop('done');
        } catch (e) {
          console.error("Erreur d'interaction AutoMod (ajout du bot) :", e.message);
        }
      });

      collector.on('end', (_c, reason) => {
        if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
      });
    } catch (e) {
      console.error('Erreur guildCreate (proposition AutoMod) :', e);
    }
  });
  console.log("✅ Proposition d'activation AutoMod à l'invitation (guildCreate, en MP) initialisée.");
}

module.exports = { registerAutomodOnJoinHandler };
