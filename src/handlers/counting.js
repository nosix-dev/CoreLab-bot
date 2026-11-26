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

// Évalue un calcul simple (+ - * / et parenthèses) sans eval().
// Retourne un entier, ou null si l'expression est invalide.
function evaluerCalcul(texte) {
  const t = String(texte).replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!t || t.length > 40 || !/^[\d+\-*/()]+$/.test(t)) return null;
  let i = 0;
  const lireNombre = () => {
    const m = /^\d+/.exec(t.slice(i));
    if (!m) throw new Error('nombre attendu');
    i += m[0].length;
    return parseInt(m[0], 10);
  };
  const facteur = () => {
    if (t[i] === '-') { i++; return -facteur(); }
    if (t[i] === '(') {
      i++;
      const v = expression();
      if (t[i] !== ')') throw new Error('parenthèse manquante');
      i++;
      return v;
    }
    return lireNombre();
  };
  const terme = () => {
    let v = facteur();
    while (t[i] === '*' || t[i] === '/') {
      const op = t[i++];
      const d = facteur();
      if (op === '/' && d === 0) throw new Error('division par zéro');
      v = op === '*' ? v * d : v / d;
    }
    return v;
  };
  const expression = () => {
    let v = terme();
    while (t[i] === '+' || t[i] === '-') {
      const op = t[i++];
      const d = terme();
      v = op === '+' ? v + d : v - d;
    }
    return v;
  };
  try {
    const v = expression();
    return i === t.length && Number.isInteger(v) && Number.isSafeInteger(v) ? v : null;
  } catch {
    return null;
  }
}

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
    .setColor(0xE8510D)
    .addFields(
      { name: 'Statut', value: cfg.counting_enabled ? '🟢 Activé' : '🔴 Désactivé', inline: true },
      { name: 'Salon', value: cfg.counting_channel_id ? `<#${cfg.counting_channel_id}>` : '❌ Non configuré', inline: true },
      { name: 'Compte actuel', value: `**${state.current}**`, inline: true },
      { name: 'Record du serveur', value: `**${state.highScore}**`, inline: true },
      { name: 'Deux fois d\'affilée', value: cfg.counting_allow_consecutive ? '✅ Autorisé' : '❌ Interdit', inline: true },
      { name: 'Reset en cas d\'erreur', value: cfg.counting_reset_on_error ? '✅ Oui' : '❌ Non (juste supprimé)', inline: true },
      { name: 'Calculs acceptés', value: cfg.counting_math ? '✅ Oui' : '❌ Non', inline: true },
      { name: 'Discussion libre', value: cfg.counting_ignore_text ? '✅ Oui' : '❌ Non', inline: true },
      { name: 'Paliers', value: cfg.counting_celebrate === false ? '❌ Désactivés' : (Number(cfg.counting_milestone_every) > 0 ? `Tous les ${Number(cfg.counting_milestone_every)}` : '50 · 100 · 250 · 500 · 1000'), inline: true }
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

      // Rôles exclus : le jeu ignore totalement leurs messages.
      const rolesExclus = Array.isArray(cfg.counting_ignored_roles) ? cfg.counting_ignored_roles : [];
      if (rolesExclus.length && message.member?.roles?.cache?.some(r => rolesExclus.includes(r.id))) return;

      const contenu = message.content.trim();
      const state = getCountingState(message.guild.id);
      const attendu = state.current + 1;

      // Valeur lue : nombre entier, ou résultat d'un calcul si l'option est active.
      const calculActif = !!cfg.counting_math;
      const ressembleNombre = calculActif ? /^[\d\s+\-*/()×x÷]+$/i.test(contenu) && /\d/.test(contenu) : /^\d+$/.test(contenu);
      // Mode discussion : un message qui n'est pas un nombre n'est ni supprimé ni sanctionné.
      if (cfg.counting_ignore_text && !ressembleNombre) return;

      let valeur = null;
      if (/^\d+$/.test(contenu)) valeur = parseInt(contenu, 10);
      else if (calculActif && ressembleNombre) valeur = evaluerCalcul(contenu);

      const memeMembre = !cfg.counting_allow_consecutive && state.lastUserId === message.author.id;
      const bonNombre = valeur !== null && valeur === attendu;

      if (bonNombre && !memeMembre) {
        state.current = attendu;
        state.lastUserId = message.author.id;
        if (attendu > state.highScore) state.highScore = attendu;
        setCountingState(message.guild.id, state);

        if (cfg.counting_react_ok !== false) await message.react('✅').catch(() => {});

        const pas = Number(cfg.counting_milestone_every) || 0;
        const estUnPalier = pas > 0 ? attendu % pas === 0 : PALIERS_CELEBRATION.includes(attendu);
        if (cfg.counting_celebrate !== false && estUnPalier) {
          const embed = new EmbedBuilder()
            .setTitle('🎉 Palier atteint !')
            .setDescription(`La communauté vient d'atteindre **${attendu}** !`)
            .setColor(0xE8510D)
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

        if (cfg.counting_announce_break === false) return;
        const embed = new EmbedBuilder()
          .setTitle('💥 Compte cassé !')
          .setDescription(`${message.author} ${raison}.\nLe compte était à **${ancienCompte}**, il repart de **1**.`)
          .setColor(0xE8510D)
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
