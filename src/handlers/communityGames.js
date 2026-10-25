'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { toCV2Payload } = require('../core/componentsV2');
const { THEMES, SUJETS_MELANGE, MOTS_PENDU } = require('../core/communityData');
const store = require('../core/communityStore');
const { ajouterPointsClan } = require('./communitySocial');
const { buildRankingPayload, resolveNames } = require('../core/rankingCard');

// ─────────────────────────────────────────────────────────────────────────
// Mini-jeux communautaires
//  • Quiz (plusieurs manches, boutons, bonus de rapidité)
//  • Pendu collaboratif (tout le salon joue ensemble)
//  • Devine le nombre
//  • Mots enchaînés (salon dédié permanent)
// Tous donnent des 💠 (si l'économie est active), des points de clan et
// alimentent /game leaderboard.
// ─────────────────────────────────────────────────────────────────────────

const COULEUR = 0xFFFFFF;
const MEDAILLES = ['🥇', '🥈', '🥉'];
const ROUND_MS = 20000;
const PENDU_MAX_ERREURS = 7;
const PENDU_DUREE_MS = 10 * 60 * 1000;
const DEVINE_DUREE_MS = 10 * 60 * 1000;
const COOLDOWN_LANCEMENT_MS = 20000;
const MOTS_USED_MAX = 1000;
const PAS_DE_PING = { parse: [] };

const quizzes = new Map();  // channelId -> état du quiz
const pendus = new Map();   // channelId -> état du pendu
const devines = new Map();  // channelId -> état du "devine le nombre"
const cooldowns = new Map(); // userId -> timestamp du dernier lancement

// ── Utilitaires ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function norm(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function melanger(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function emb(titre, desc, couleur = COULEUR) {
  return new EmbedBuilder().setTitle(titre).setDescription(desc).setColor(couleur);
}
function envoyer(channel, embed, extra = {}) {
  return channel.send(toCV2Payload({ embeds: [embed], allowedMentions: PAS_DE_PING, ...extra }));
}
function occupe(channelId) {
  return quizzes.has(channelId) || pendus.has(channelId) || devines.has(channelId);
}
function verifierCooldown(userId) {
  const now = Date.now();
  const last = cooldowns.get(userId) || 0;
  if (now - last < COOLDOWN_LANCEMENT_MS) return Math.ceil((COOLDOWN_LANCEMENT_MS - (now - last)) / 1000);
  cooldowns.set(userId, now);
  return 0;
}
function refuser(interaction, texte) {
  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}
// Contrôle commun avant de lancer un jeu. Retourne true si on peut continuer.
async function peutLancer(interaction) {
  const ch = interaction.channel;
  if (!interaction.guild || !ch || typeof ch.send !== 'function') {
    await refuser(interaction, '❌ Cette commande fonctionne uniquement dans un salon de serveur.');
    return false;
  }
  if (occupe(ch.id)) {
    await refuser(interaction, '❌ Un jeu est déjà en cours dans ce salon. Utilise `/game stop` pour l\'arrêter ou change de salon.');
    return false;
  }
  const attente = verifierCooldown(interaction.user.id);
  if (attente) {
    await refuser(interaction, `⏳ Patiente encore ${attente}s avant de relancer un jeu.`);
    return false;
  }
  return true;
}
function gain(guildId, userId, montant) {
  const ok = store.ecoAjouter(guildId, userId, montant);
  return ok ? montant : 0;
}
function formatGain(guildId, montant) {
  return montant > 0 ? ` (+${montant} ${store.ecoEmoji(guildId)})` : '';
}

// ═════════════════════════════════════════════════════════════════════════
// QUIZ
// ═════════════════════════════════════════════════════════════════════════
// ── Génération des questions par l'IA (Gemini) ──
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const DIFFICULTES = ['facile', 'moyenne', 'moyenne', 'difficile'];

function choisirSujet(theme) {
  if (theme !== 'melange' && THEMES[theme]) {
    return { texte: THEMES[theme].sujet, emoji: THEMES[theme].emoji };
  }
  const s = SUJETS_MELANGE[Math.floor(Math.random() * SUJETS_MELANGE.length)];
  return { texte: s.nom, emoji: s.emoji };
}

function extraireJson(texte) {
  const propre = String(texte).replace(/```json|```/gi, '').trim();
  const debut = propre.indexOf('{');
  const fin = propre.lastIndexOf('}');
  if (debut === -1 || fin === -1) throw new Error('JSON introuvable dans la réponse');
  return JSON.parse(propre.slice(debut, fin + 1));
}

function validerQuestion(o) {
  if (!o || typeof o !== 'object') return null;
  const q = String(o.question ?? o.q ?? '').trim();
  const r = String(o.bonne_reponse ?? o.r ?? '').trim();
  const f = (o.fausses_reponses ?? o.f);
  if (!q || !r || !Array.isArray(f)) return null;
  const faux = [...new Set(f.map(x => String(x).trim()).filter(Boolean))].filter(x => norm(x) !== norm(r));
  if (faux.length < 3) return null;
  if (q.length > 350 || r.length > 70 || faux.some(x => x.length > 70)) return null;
  return { q, r, f: faux.slice(0, 3) };
}

async function genererQuestionIA(theme, dejaPosees) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY manquante');

  let derniereErreur = null;
  for (let essai = 0; essai < 3; essai++) {
    const sujet = choisirSujet(theme);
    const difficulte = DIFFICULTES[Math.floor(Math.random() * DIFFICULTES.length)];
    const graine = Math.random().toString(36).slice(2, 8);
    const evite = dejaPosees.length
      ? `\nQuestions déjà posées (ne pas répéter, ni le même sujet précis) :\n- ${dejaPosees.slice(-20).join('\n- ')}`
      : '';
    const prompt =
      `Invente UNE question de quiz originale en français sur le sujet : ${sujet.texte}.\n` +
      `Difficulté : ${difficulte}. Graine d'aléa : ${graine} (choisis un angle inattendu, pas la question la plus évidente).\n` +
      `Règles : une seule bonne réponse, factuellement certaine et vérifiable ; 3 fausses réponses plausibles mais clairement fausses ; ` +
      `réponses courtes (70 caractères max) ; la question ne contient pas la réponse.${evite}\n\n` +
      `Réponds UNIQUEMENT avec un objet JSON, sans texte autour ni balises :\n` +
      `{"question":"...","bonne_reponse":"...","fausses_reponses":["...","...","..."]}`;

    try {
      const res = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          messages: [
            { role: 'system', content: 'Tu es un animateur de quiz rigoureux. Tu ne produis que du JSON valide.' },
            { role: 'user', content: prompt },
          ],
          temperature: 1.0,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`API Gemini ${res.status} ${t.slice(0, 150)}`);
      }
      const data = await res.json();
      const contenu = data?.choices?.[0]?.message?.content;
      if (!contenu) throw new Error('réponse vide');
      const question = validerQuestion(extraireJson(contenu));
      if (!question) throw new Error('question invalide');
      if (dejaPosees.some(p => norm(p) === norm(question.q))) throw new Error('question déjà posée');
      return { ...question, emoji: sujet.emoji };
    } catch (e) {
      derniereErreur = e;
      console.error(`[Quiz] Génération IA (essai ${essai + 1}/3) :`, e.message);
    }
  }
  throw derniereErreur || new Error('génération impossible');
}

async function lancerQuiz(interaction, { manches = 5, theme = 'melange' } = {}) {
  if (!process.env.GEMINI_API_KEY) {
    return refuser(interaction, "❌ Le quiz utilise l'IA, mais aucune clé `GEMINI_API_KEY` n'est configurée sur le bot.");
  }
  if (!(await peutLancer(interaction))) return;

  const channel = interaction.channel;
  const etat = { channelId: channel.id, starterId: interaction.user.id, scores: new Map(), stopped: false, current: null, wake: null };
  quizzes.set(channel.id, etat);

  await interaction.reply({ content: `✅ Quiz lancé (${manches} manche${manches > 1 ? 's' : ''}) !`, flags: MessageFlags.Ephemeral });
  boucleQuiz(interaction.guild, channel, etat, manches, theme).catch(e => {
    console.error('[Quiz] Erreur :', e.message);
    quizzes.delete(channel.id);
  });
}

async function boucleQuiz(guild, channel, etat, total, theme) {
  try {
    const themeLabel = theme === 'melange' ? '🎲 Thèmes mélangés' : THEMES[theme].label;
    const posees = [];
    // La génération de la 1re question tourne pendant le message d'intro
    let suivante = genererQuestionIA(theme, posees).catch(e => ({ erreur: e }));

    await envoyer(channel, emb(
      '🧠 Quiz de la communauté',
      `${themeLabel} • 🤖 Questions générées par l'IA\n**${total}** question${total > 1 ? 's' : ''} • **${ROUND_MS / 1000}s** par question\n\nRépondez avec les boutons. Plus vous répondez vite, plus vous gagnez de points !\n*Lancé par <@${etat.starterId}>*`
    ));
    await sleep(3500);

    for (let i = 0; i < total && !etat.stopped; i++) {
      const item = await suivante;
      if (etat.stopped) break;
      if (!item || item.erreur) {
        await envoyer(channel, emb('⚠️ Quiz interrompu', "L'IA n'a pas réussi à générer la question suivante. Réessaie dans un instant avec `/game quiz`."), {});
        etat.stopped = true;
        break;
      }
      posees.push(item.q);
      // On prépare déjà la question suivante pendant que celle-ci se joue
      if (i < total - 1) suivante = genererQuestionIA(theme, posees).catch(e => ({ erreur: e }));

      const choix = melanger([item.r, ...item.f]);
      const correct = choix.indexOf(item.r);
      const finTs = Date.now() + ROUND_MS;
      const lettres = ['A', 'B', 'C', 'D'];

      const ligne = new ActionRowBuilder().addComponents(
        choix.map((c, k) => new ButtonBuilder()
          .setCustomId(`jeu_quiz:${channel.id}:${i}:${k}`)
          .setLabel(`${lettres[k]} · ${c}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary))
      );
      const themeQ = item.emoji || '❓';
      const msg = await channel.send(toCV2Payload({
        embeds: [emb(
          `${themeQ} Question ${i + 1}/${total}`,
          `**${item.q}**\n\n⏱️ Fin <t:${Math.floor(finTs / 1000)}:R>`
        )],
        components: [ligne],
        allowedMentions: PAS_DE_PING,
      }));

      etat.current = { round: i, correct, answers: new Map(), open: true };
      await new Promise(res => {
        etat.wake = res;
        setTimeout(res, ROUND_MS);
      });
      etat.wake = null;
      etat.current.open = false;

      // Points : 10 pour une bonne réponse + jusqu'à 5 de bonus de rapidité
      const trouveurs = [];
      for (const [uid, rep] of etat.current.answers) {
        if (rep.k !== correct) continue;
        const restant = Math.max(0, finTs - rep.ts);
        const pts = 10 + Math.round(5 * restant / ROUND_MS);
        etat.scores.set(uid, (etat.scores.get(uid) || 0) + pts);
        trouveurs.push({ uid, pts });
      }
      trouveurs.sort((a, b) => b.pts - a.pts);

      const ligneFin = new ActionRowBuilder().addComponents(
        choix.map((c, k) => new ButtonBuilder()
          .setCustomId(`jeu_quiz_done:${channel.id}:${i}:${k}`)
          .setLabel(`${lettres[k]} · ${c}`.slice(0, 80))
          .setStyle(k === correct ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(true))
      );
      const resume = trouveurs.length
        ? trouveurs.slice(0, 8).map(t => `<@${t.uid}> **+${t.pts}**`).join(' • ') + (trouveurs.length > 8 ? ` … (+${trouveurs.length - 8})` : '')
        : 'Personne n\'a trouvé 😅';
      await msg.edit(toCV2Payload({
        embeds: [emb(
          `${themeQ} Question ${i + 1}/${total} — terminée`,
          `**${item.q}**\n\n✅ Bonne réponse : **${item.r}**\n👥 ${etat.current.answers.size} participant${etat.current.answers.size > 1 ? 's' : ''}\n${resume}`,
          trouveurs.length ? 0x57F287 : 0xED4245
        )],
        components: [ligneFin],
        allowedMentions: PAS_DE_PING,
      })).catch(() => {});

      if (i < total - 1 && !etat.stopped) await sleep(4000);
    }

    // ── Résultats ──
    const classement = [...etat.scores.entries()].sort((a, b) => b[1] - a[1]);
    if (!classement.length) {
      await envoyer(channel, emb('🧠 Quiz terminé', 'Personne n\'a marqué de point cette fois. À la prochaine !'));
      return;
    }
    const recompenses = [200, 100, 50];
    const lignes = [];
    classement.slice(0, 10).forEach(([uid, pts], idx) => {
      const g = !etat.stopped && idx < 3 ? gain(guild.id, uid, recompenses[idx]) : 0;
      lignes.push(`${MEDAILLES[idx] || `**${idx + 1}.**`} <@${uid}> — **${pts}** pts${formatGain(guild.id, g)}`);
    });
    for (const [uid, pts] of classement) {
      const s = store.statsJoueur(guild.id, uid);
      s.quizPoints += pts;
      if (!etat.stopped) ajouterPointsClan(guild, uid, pts);
    }
    if (!etat.stopped) store.statsJoueur(guild.id, classement[0][0]).quizWins += 1;
    store.sauverJeux();

    await envoyer(channel, emb(
      etat.stopped ? '🛑 Quiz interrompu — scores' : '🏆 Quiz terminé !',
      lignes.join('\n') + (etat.stopped ? '\n\n*Pas de récompenses pour un quiz interrompu.*' : '')
    ), {});
  } finally {
    quizzes.delete(channel.id);
  }
}

function boutonQuiz(interaction) {
  const [, channelId, roundStr, kStr] = interaction.customId.split(':');
  const etat = quizzes.get(channelId);
  const cur = etat?.current;
  if (!etat || !cur || !cur.open || cur.round !== Number(roundStr)) {
    return refuser(interaction, '⏱️ Cette question est terminée.');
  }
  if (cur.answers.has(interaction.user.id)) {
    return refuser(interaction, '✋ Tu as déjà répondu à cette question.');
  }
  cur.answers.set(interaction.user.id, { k: Number(kStr), ts: Date.now() });
  return refuser(interaction, '✅ Réponse enregistrée ! Résultat à la fin du chrono.');
}

// ═════════════════════════════════════════════════════════════════════════
// PENDU (collaboratif)
// ═════════════════════════════════════════════════════════════════════════
const PENDU_ART = [
  '  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========',
  '  +---+\n  |   |\n  X   |\n /|\\  |\n / \\  |\n      |\n=========',
];

function masquePendu(p) {
  return [...p.mot].map(c => (p.trouvees.has(c) ? c.toUpperCase() : '_')).join(' ');
}
function embedPendu(p, fin = null) {
  const art = PENDU_ART[Math.min(p.erreurs, PENDU_ART.length - 1)];
  const fausses = [...p.fausses].map(c => c.toUpperCase()).join(', ') || '—';
  let desc = '```\n' + art + '\n\n  ' + (fin ? [...p.mot].map(c => c.toUpperCase()).join(' ') : masquePendu(p)) + '\n```';
  desc += `\n❌ Lettres fausses : **${fausses}**\n💔 Erreurs : **${p.erreurs}/${PENDU_MAX_ERREURS}**`;
  let couleur = COULEUR;
  if (fin === 'win') { desc += '\n\n🎉 **Trouvé !**'; couleur = 0x57F287; }
  else if (fin === 'lose') { desc += `\n\n💀 **Perdu !** Le mot était **${p.mot.toUpperCase()}**.`; couleur = 0xED4245; }
  else if (fin === 'timeout') { desc += `\n\n⌛ **Temps écoulé !** Le mot était **${p.mot.toUpperCase()}**.`; couleur = 0xED4245; }
  else desc += `\n\n✍️ Tape **une lettre** dans le salon, ou \`mot ${'x'.repeat(Math.min(5, p.mot.length))}\` pour tenter le mot entier (2 erreurs si c'est faux).`;
  return emb('🪢 Pendu collaboratif', desc, couleur);
}

async function lancerPendu(interaction) {
  if (!(await peutLancer(interaction))) return;
  const channel = interaction.channel;
  const mot = MOTS_PENDU[Math.floor(Math.random() * MOTS_PENDU.length)];
  const p = {
    channelId: channel.id, guildId: interaction.guild.id, starterId: interaction.user.id,
    mot, trouvees: new Set(), fausses: new Set(), erreurs: 0,
    contrib: new Map(), msg: null, timer: null, fini: false,
  };
  pendus.set(channel.id, p);
  await interaction.reply({ content: '✅ Pendu lancé !', flags: MessageFlags.Ephemeral });
  try {
    p.msg = await channel.send(toCV2Payload({ embeds: [embedPendu(p)], allowedMentions: PAS_DE_PING }));
  } catch (e) {
    pendus.delete(channel.id);
    return;
  }
  p.timer = setTimeout(() => finirPendu(p, 'timeout'), PENDU_DUREE_MS);
}

async function finirPendu(p, resultat, gagnantId = null) {
  if (p.fini) return;
  p.fini = true;
  clearTimeout(p.timer);
  pendus.delete(p.channelId);

  try {
    await p.msg?.edit(toCV2Payload({ embeds: [embedPendu(p, resultat)], allowedMentions: PAS_DE_PING }));
  } catch (_) { /* message supprimé : on continue */ }

  const channel = p.msg?.channel;
  if (resultat !== 'win' || !channel) return;

  // Récompenses : 20 💠 + 5 par bonne lettre (max 100) pour chaque participant, +50 pour celui qui conclut.
  const lignes = [];
  for (const [uid, bonnes] of p.contrib) {
    let montant = Math.min(100, 20 + 5 * bonnes);
    if (uid === gagnantId) montant += 50;
    const g = gain(p.guildId, uid, montant);
    lignes.push(`<@${uid}> — ${bonnes} lettre${bonnes > 1 ? 's' : ''}${uid === gagnantId ? ' ⭐ (dernière lettre)' : ''}${formatGain(p.guildId, g)}`);
    ajouterPointsClan({ id: p.guildId }, uid, 5 + bonnes);
  }
  if (gagnantId) store.statsJoueur(p.guildId, gagnantId).penduWins += 1;
  store.sauverJeux();
  if (lignes.length) {
    await envoyer(channel, emb('🎉 Pendu gagné ensemble !', lignes.slice(0, 15).join('\n'), 0x57F287)).catch(() => {});
  }
}

async function messagePendu(message, p) {
  const t = norm(message.content.trim());
  let mot = null;
  let lettre = null;
  const m = t.match(/^(?:mot|m)\s+([a-z]{2,25})$/);
  if (/^[a-z]$/.test(t)) lettre = t;
  else if (m) mot = m[1];
  else return false;

  const uid = message.author.id;
  if (lettre) {
    if (p.trouvees.has(lettre) || p.fausses.has(lettre)) {
      message.react('♻️').catch(() => {});
      return true;
    }
    if (p.mot.includes(lettre)) {
      p.trouvees.add(lettre);
      const nb = [...p.mot].filter(c => c === lettre).length;
      p.contrib.set(uid, (p.contrib.get(uid) || 0) + nb);
      message.react('✅').catch(() => {});
      if ([...p.mot].every(c => p.trouvees.has(c))) return (await finirPendu(p, 'win', uid), true);
    } else {
      p.fausses.add(lettre);
      p.erreurs += 1;
      message.react('❌').catch(() => {});
      if (p.erreurs >= PENDU_MAX_ERREURS) return (await finirPendu(p, 'lose'), true);
    }
  } else if (mot) {
    if (mot === p.mot) {
      for (const c of p.mot) p.trouvees.add(c);
      p.contrib.set(uid, (p.contrib.get(uid) || 0) + 1);
      message.react('🎯').catch(() => {});
      return (await finirPendu(p, 'win', uid), true);
    }
    p.erreurs = Math.min(PENDU_MAX_ERREURS, p.erreurs + 2);
    message.react('❌').catch(() => {});
    if (p.erreurs >= PENDU_MAX_ERREURS) return (await finirPendu(p, 'lose'), true);
  }
  p.msg?.edit(toCV2Payload({ embeds: [embedPendu(p)], allowedMentions: PAS_DE_PING })).catch(() => {});
  return true;
}

// ═════════════════════════════════════════════════════════════════════════
// DEVINE LE NOMBRE
// ═════════════════════════════════════════════════════════════════════════
function embedDevine(d, fin = null, gagnantId = null) {
  let desc = `Je pense à un nombre entre **1** et **${d.max.toLocaleString('fr-FR')}**.\nTapez simplement des nombres dans le salon !\n\n`;
  desc += `📏 Il est entre **${d.bas}** et **${d.haut}**\n🎯 Essais : **${d.total}**`;
  let couleur = COULEUR;
  if (fin === 'win') { desc += `\n\n🎉 <@${gagnantId}> a trouvé **${d.nombre}** !`; couleur = 0x57F287; }
  else if (fin === 'timeout') { desc += `\n\n⌛ Temps écoulé ! C'était **${d.nombre}**.`; couleur = 0xED4245; }
  return emb('🔢 Devine le nombre', desc, couleur);
}

async function lancerDevine(interaction, { max = 1000 } = {}) {
  if (!(await peutLancer(interaction))) return;
  const channel = interaction.channel;
  const d = {
    channelId: channel.id, guildId: interaction.guild.id, max,
    nombre: 1 + Math.floor(Math.random() * max),
    bas: 1, haut: max, total: 0, essais: new Map(), msg: null, timer: null, fini: false, derniereMaj: 0,
  };
  devines.set(channel.id, d);
  await interaction.reply({ content: '✅ Jeu lancé !', flags: MessageFlags.Ephemeral });
  try {
    d.msg = await channel.send(toCV2Payload({ embeds: [embedDevine(d)], allowedMentions: PAS_DE_PING }));
  } catch (e) {
    devines.delete(channel.id);
    return;
  }
  d.timer = setTimeout(() => finirDevine(d, 'timeout'), DEVINE_DUREE_MS);
}

async function finirDevine(d, resultat, gagnantId = null) {
  if (d.fini) return;
  d.fini = true;
  clearTimeout(d.timer);
  devines.delete(d.channelId);
  try {
    await d.msg?.edit(toCV2Payload({ embeds: [embedDevine(d, resultat, gagnantId)], allowedMentions: PAS_DE_PING }));
  } catch (_) { /* ignoré */ }
  if (resultat !== 'win' || !gagnantId) return;

  // Plus on trouve vite (peu d'essais au total), plus la récompense est grosse (50 à 250).
  const montant = Math.max(50, 250 - d.total * 4);
  const g = gain(d.guildId, gagnantId, montant);
  ajouterPointsClan({ id: d.guildId }, gagnantId, 10);
  store.statsJoueur(d.guildId, gagnantId).devineWins += 1;
  store.sauverJeux();
  const channel = d.msg?.channel;
  if (channel) {
    await envoyer(channel, emb('🏆 Bien joué !', `<@${gagnantId}> trouve **${d.nombre}** en **${d.total}** essais au total${formatGain(d.guildId, g)}`, 0x57F287)).catch(() => {});
  }
}

async function messageDevine(message, d) {
  const t = message.content.trim();
  if (!/^\d{1,9}$/.test(t)) return false;
  const n = parseInt(t, 10);
  if (n < 1 || n > d.max) return false;

  d.total += 1;
  d.essais.set(message.author.id, (d.essais.get(message.author.id) || 0) + 1);
  if (n === d.nombre) {
    message.react('🎯').catch(() => {});
    await finirDevine(d, 'win', message.author.id);
    return true;
  }
  if (n < d.nombre) {
    message.react('⬆️').catch(() => {});
    if (n + 1 > d.bas) d.bas = n + 1;
  } else {
    message.react('⬇️').catch(() => {});
    if (n - 1 < d.haut) d.haut = n - 1;
  }
  // On limite les mises à jour du message principal (1 toutes les 3 s max)
  const now = Date.now();
  if (now - d.derniereMaj > 3000) {
    d.derniereMaj = now;
    d.msg?.edit(toCV2Payload({ embeds: [embedDevine(d)], allowedMentions: PAS_DE_PING })).catch(() => {});
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════
// MOTS ENCHAÎNÉS (salon permanent)
// ═════════════════════════════════════════════════════════════════════════
async function messageMots(message) {
  const g = store.jeux(message.guild.id);
  const mots = g.mots;
  if (!mots.enabled || !mots.channelId || message.channel.id !== mots.channelId) return false;

  const brut = message.content.trim();
  // On ignore tout ce qui ne ressemble pas à un mot seul (discussion normale dans le salon)
  if (!/^[\p{L}'-]{2,30}$/u.test(brut)) return false;
  const mot = norm(brut).replace(/[^a-z]/g, '');
  if (mot.length < 2) return false;

  let erreur = null;
  if (mots.lastUserId === message.author.id) erreur = 'tu ne peux pas jouer deux fois de suite';
  else if (mots.lastWord && mot[0] !== mots.lastWord[mots.lastWord.length - 1]) {
    erreur = `le mot doit commencer par **${mots.lastWord[mots.lastWord.length - 1].toUpperCase()}**`;
  } else if (mots.used.includes(mot)) erreur = 'ce mot a déjà été utilisé dans cette chaîne';

  if (erreur) {
    message.react('❌').catch(() => {});
    const ancien = mots.chain;
    mots.chain = 0;
    mots.lastWord = null;
    mots.lastUserId = null;
    mots.used = [];
    store.sauverJeux();
    await envoyer(message.channel, emb(
      '💥 Chaîne brisée !',
      `${message.author} : ${erreur}.\nLa chaîne s'arrête à **${ancien}** mot${ancien > 1 ? 's' : ''} (record : **${mots.record}**).\nOn repart : n'importe quel mot !`,
      0xED4245
    )).catch(() => {});
    return true;
  }

  mots.chain += 1;
  mots.lastWord = mot;
  mots.lastUserId = message.author.id;
  mots.used.push(mot);
  if (mots.used.length > MOTS_USED_MAX) mots.used.shift();
  const nouveauRecord = mots.chain > mots.record;
  if (nouveauRecord) mots.record = mots.chain;
  store.statsJoueur(message.guild.id, message.author.id).motsCount += 1;
  store.sauverJeux();

  message.react(nouveauRecord && mots.chain >= 10 ? '🏆' : '✅').catch(() => {});
  if (mots.chain % 25 === 0) {
    await envoyer(message.channel, emb('🔗 Palier atteint !', `La chaîne atteint **${mots.chain}** mots ! Prochain mot : lettre **${mot[mot.length - 1].toUpperCase()}**`, 0x57F287)).catch(() => {});
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════
// ARRÊT / CLASSEMENT
// ═════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════
// 8BALLS (boule magique)
// ═════════════════════════════════════════════════════════════════════════
const HUITBALLS_COOLDOWN_MS = 5000;
const huitballsCooldowns = new Map(); // userId -> timestamp de la dernière question
const HUITBALLS_REPONSES = {
  oui: {
    emoji: '🟢', couleur: 0x57F287,
    textes: [
      'C\'est certain.', 'C\'est décidément ainsi.', 'Sans aucun doute.', 'Oui, définitivement.',
      'Tu peux compter dessus.', 'Comme je le vois, oui.', 'Très probablement.', 'Les perspectives sont bonnes.',
      'Oui.', 'Les signes disent oui.',
    ],
  },
  peutetre: {
    emoji: '🟡', couleur: 0xFEE75C,
    textes: [
      'Réponse floue, réessaie.', 'Redemande plus tard.', 'Mieux vaut ne pas te le dire maintenant.',
      'Impossible de prédire maintenant.', 'Concentre-toi et redemande.',
    ],
  },
  non: {
    emoji: '🔴', couleur: 0xED4245,
    textes: [
      'N\'y compte pas.', 'Ma réponse est non.', 'Mes sources disent non.',
      'Les perspectives ne sont pas si bonnes.', 'Très douteux.',
    ],
  },
};

async function lancer8balls(interaction, { question } = {}) {
  const q = String(question || '').trim();
  if (!q) return refuser(interaction, '❌ Pose-moi une question !');

  const now = Date.now();
  const attente = HUITBALLS_COOLDOWN_MS - (now - (huitballsCooldowns.get(interaction.user.id) || 0));
  if (attente > 0) return refuser(interaction, `⏳ La boule se repose, patiente encore ${Math.ceil(attente / 1000)}s.`);
  huitballsCooldowns.set(interaction.user.id, now);

  // Tirage : chaque réponse a la même probabilité (10 oui / 5 peut-être / 5 non, comme la vraie boule)
  const toutes = Object.values(HUITBALLS_REPONSES).flatMap(cat => cat.textes.map(texte => ({ cat, texte })));
  const { cat, texte } = toutes[Math.floor(Math.random() * toutes.length)];

  const embed = emb(
    '🎱 La boule magique a parlé',
    `**❓ Question :** ${q.slice(0, 500)}\n\n${cat.emoji} **${texte}**`,
    cat.couleur
  ).setFooter({ text: `Demandé par ${interaction.user.username}` });

  return interaction.reply(toCV2Payload({ embeds: [embed], allowedMentions: PAS_DE_PING }));
}

async function arreterJeu(interaction) {
  const id = interaction.channel?.id;
  const q = quizzes.get(id);
  const p = pendus.get(id);
  const d = devines.get(id);
  if (!q && !p && !d) return refuser(interaction, '❌ Aucun jeu en cours dans ce salon.');

  const starter = (q || p || d).starterId;
  const modo = interaction.memberPermissions?.has('ManageMessages');
  if (interaction.user.id !== starter && !modo) {
    return refuser(interaction, '❌ Seul celui qui a lancé le jeu (ou un modérateur) peut l\'arrêter.');
  }
  if (q) { q.stopped = true; q.wake?.(); }
  if (p) await finirPendu(p, 'timeout');
  if (d) await finirDevine(d, 'timeout');
  return interaction.reply({ content: '🛑 Jeu arrêté.', flags: MessageFlags.Ephemeral });
}

async function construireClassement(guild, type) {
  const g = store.jeux(guild.id);
  const cfg = {
    quiz: { champ: 'quizPoints', titre: 'Classement Quiz', emoji: '🧠', badge: 'QUIZ', unite: 'pts' },
    pendu: { champ: 'penduWins', titre: 'Classement Pendu', emoji: '🪢', badge: 'PENDU', unite: 'victoires' },
    devine: { champ: 'devineWins', titre: 'Classement Devine le nombre', emoji: '🔢', badge: 'DEVINE', unite: 'victoires' },
    mots: { champ: 'motsCount', titre: 'Classement Mots enchaînés', emoji: '🔗', badge: 'MOTS', unite: 'mots' },
  }[type];
  const top = Object.entries(g.stats)
    .map(([uid, s]) => [uid, s[cfg.champ] || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const noms = await resolveNames(guild, top.map(([uid]) => uid));
  const rows = top.map(([uid, v]) => ({
    name: noms.get(uid),
    value: `${v.toLocaleString('fr-FR')} ${cfg.unite}`,
  }));
  const notes = [];
  if (!rows.length) notes.push('Lance une partie avec `/game` !');
  if (type === 'mots' && g.mots.record) notes.push(`🏆 Record de chaîne : **${g.mots.record}** mots`);
  return buildRankingPayload({
    guildId: guild.id,
    heading: `## ${cfg.emoji} ${cfg.titre}`,
    title: cfg.titre,
    subtitle: rows.length ? `${rows.length} joueur${rows.length > 1 ? 's' : ''}` : 'aucun joueur',
    badge: cfg.badge,
    rows,
    note: notes.join('\n') || null,
  });
}

// ── Entrées publiques ───────────────────────────────────────────────────
// Retourne true si le message a été consommé par un jeu.
async function traiterMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const id = message.channel.id;
  const p = pendus.get(id);
  if (p) return messagePendu(message, p);
  const d = devines.get(id);
  if (d) return messageDevine(message, d);
  return messageMots(message);
}

// Retourne true si l'interaction appartient aux mini-jeux.
function traiterInteraction(interaction) {
  const id = interaction.customId || '';
  if (id.startsWith('jeu_quiz:')) { boutonQuiz(interaction); return true; }
  if (id.startsWith('jeu_quiz_done:')) { interaction.deferUpdate().catch(() => {}); return true; }
  return false;
}

module.exports = {
  lancerQuiz, lancerPendu, lancerDevine, lancer8balls, arreterJeu, construireClassement,
  traiterMessage, traiterInteraction, THEMES,
};
