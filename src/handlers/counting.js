const {
  EmbedBuilder
} = require('discord.js');
const {
  getGuildConfig,
  getGuildBucket,
  setGuildBucket
} = require('../core/config');

// ────────────────────────────────────────────────
// Jeu de Comptage (Counting Game)
// La commu compte à la suite dans un salon dédié :
// 1, 2, 3, ... Si quelqu'un se trompe (mauvais chiffre,
// ou compte deux fois d'affilée si c'est désactivé), le
// compteur est cassé et repart de 0 (configurable).
// État vivant stocké dans le compartiment "comptage".
// ────────────────────────────────────────────────

const CLE_COMPARTIMENT = 'comptage';
const PALIERS_CELEBRATION = [50, 100, 250, 500, 1000];

function getCountingState(guildId) {
  return getGuildBucket(guildId, CLE_COMPARTIMENT, {
    current: 0,
    lastUserId: null,
    highScore: 0
  });
}

function setCountingState(guildId, state) {
  setGuildBucket(guildId, CLE_COMPARTIMENT, state);
}

function buildStatsEmbed(guild) {
  const cfg = getGuildConfig(guild.id);
  const state = getCountingState(guild.id);
  return new EmbedBuilder()
    .setTitle('🔢 Jeu de Comptage')
    .setColor(0xFFFFFF)
    .addFields(
      { name: 'Statut', value: cfg.counting_enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Salon', value: cfg.counting_channel_id ? `<#${cfg.counting_channel_id}>` : '❌ Non configuré', inline: true },
      { name: 'Compte actuel', value: `**${state.current}**`, inline: true },
      { name: 'Record du serveur', value: `**${state.highScore}**`, inline: true },
      { name: 'Deux fois d\'affilée', value: cfg.counting_allow_consecutive ? '✅ Autorisé' : '❌ Interdit', inline: true },
      { name: 'Reset en cas d\'erreur', value: cfg.counting_reset_on_error ? '✅ Oui' : '❌ Non (juste supprimé)', inline: true }
    )
    .setTimestamp();
}

function registerCountingHandler(client) {
  client.on('messageCreate', async message => {
    try {
      if (!message.guild || message.author.bot) return;
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg.counting_enabled || !cfg.counting_channel_id) return;
      if (message.channel.id !== cfg.counting_channel_id) return;

      const contenu = message.content.trim();
      const state = getCountingState(message.guild.id);
      const attendu = state.current + 1;

      const memeMembre = !cfg.counting_allow_consecutive && state.lastUserId === message.author.id;
      const estUnNombreValide = /^\d+$/.test(contenu);
      const bonNombre = estUnNombreValide && parseInt(contenu, 10) === attendu;

      if (bonNombre && !memeMembre) {
        state.current = attendu;
        state.lastUserId = message.author.id;
        if (attendu > state.highScore) state.highScore = attendu;
        setCountingState(message.guild.id, state);

        await message.react('✅').catch(() => {});

        if (PALIERS_CELEBRATION.includes(attendu)) {
          const embed = new EmbedBuilder()
            .setTitle('🎉 Palier atteint !')
            .setDescription(`La communauté vient d'atteindre **${attendu}** !`)
            .setColor(0xFFFFFF)
            .setTimestamp();
          await message.channel.send({ embeds: [embed] }).catch(() => {});
        }
        return;
      }

      // ── Mauvais chiffre ou mauvaise personne ──
      const raison = memeMembre
        ? 'a compté deux fois d\'affilée'
        : `a écrit **${contenu || '(vide)'}** au lieu de **${attendu}**`;

      if (cfg.counting_delete_wrong) {
        await message.delete().catch(() => {});
      } else {
        await message.react('❌').catch(() => {});
      }

      if (cfg.counting_reset_on_error) {
        const ancienCompte = state.current;
        state.current = 0;
        state.lastUserId = null;
        setCountingState(message.guild.id, state);

        const embed = new EmbedBuilder()
          .setTitle('💥 Compte cassé !')
          .setDescription(`${message.author} ${raison}.\nLe compte était à **${ancienCompte}**, il repart de **1**.`)
          .setColor(0xFFFFFF)
          .setTimestamp();
        await message.channel.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (e) {
      console.error('Erreur handler Comptage :', e.message);
    }
  });
}

module.exports = {
  registerCountingHandler,
  getCountingState,
  setCountingState,
  buildStatsEmbed
};
