'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { toCV2Payload } = require('../core/componentsV2');
const { glassPayload, glassUpdate } = require('../core/glassEmbed');
const store = require('../core/communityStore');
const { buildRankingPayload } = require('../core/rankingCard');

// ─────────────────────────────────────────────────────────────────────────
// Social : mariage 💍, amis 🤝, clans 🛡️
//  • Les demandes (mariage / ami / invitation de clan) passent par des
//    boutons dont l'identifiant contient tout l'état → rien à stocker en
//    mémoire, ça survit aux redémarrages (expiration au bout de 10 min).
//  • Chaque clan peut avoir un rôle Discord [TAG] créé automatiquement
//    (si le bot a la permission "Gérer les rôles").
//  • Les clans gagnent des points quand leurs membres gagnent aux mini-jeux.
// ─────────────────────────────────────────────────────────────────────────

const COULEUR = 0xFFFFFF;
const MAX_AMIS = 50;
const MAX_MEMBRES_CLAN = 25;
const COUT_CREATION_CLAN = 500;      // en 💠 (ignoré si l'économie est désactivée)
const DELAI_DEMANDE_MS = 10 * 60 * 1000;
const MEDAILLES = ['🥇', '🥈', '🥉'];
const ROLES_ICONES = { chef: '👑', officier: '🛡️', membre: '•' };

// ── Utilitaires ─────────────────────────────────────────────────────────
function emb(titre, desc, couleur = COULEUR) {
  return new EmbedBuilder().setTitle(titre).setDescription(desc).setColor(couleur);
}
function erreur(interaction, texte) {
  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}
async function repondre(interaction, embed, extra = {}, glassOpts = {}) {
  const payload = await glassPayload({ embeds: [embed], ...extra }, { guild: interaction.guild, client: interaction.client, badge: 'SOCIAL', ...glassOpts });
  // Si le filet de sécurité d'index.js a déjà defer l'interaction (réseau lent), on passe en followUp.
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}
async function duo(interaction, a, b) {
  try { return await Promise.all([interaction.client.users.fetch(a), interaction.client.users.fetch(b)]); } catch { return undefined; }
}
function date(ms) { return `<t:${Math.floor(ms / 1000)}:D>`; }
function relatif(ms) { return `<t:${Math.floor(ms / 1000)}:R>`; }
function idGuilde(g) { return typeof g === 'object' && g !== null ? g.id : String(g); }
function boutonsOuiNon(idOui, idNon, labelOui = 'Accepter', labelNon = 'Refuser') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(idOui).setLabel(labelOui).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(idNon).setLabel(labelNon).setStyle(ButtonStyle.Danger),
  );
}
function expire(ts) { return Date.now() - Number(ts) > DELAI_DEMANDE_MS; }
async function majMessage(interaction, embed, glassOpts = {}) {
  return glassUpdate(interaction, { embeds: [embed], components: [], allowedMentions: { parse: [] } }, { badge: 'SOCIAL', ...glassOpts });
}

// ═════════════════════════════════════════════════════════════════════════
// CLANS — fonctions de base
// ═════════════════════════════════════════════════════════════════════════
function clanDe(g, userId) {
  const id = g.clanOf[String(userId)];
  return id ? g.clans[id] || null : null;
}
function trouverClan(g, texte) {
  const t = String(texte || '').trim().toLowerCase();
  if (!t) return null;
  return Object.values(g.clans).find(c => c.nom.toLowerCase() === t || c.tag.toLowerCase() === t) || null;
}
function roleDe(clan, userId) {
  return clan.membres[String(userId)]?.role || null;
}
function estGradé(clan, userId) {
  const r = roleDe(clan, userId);
  return r === 'chef' || r === 'officier';
}

async function syncRole(guild, clan, userId, ajouter) {
  if (!clan?.roleId || !guild?.members) return;
  try {
    const m = await guild.members.fetch(userId);
    if (ajouter) await m.roles.add(clan.roleId, `Clan ${clan.nom}`);
    else await m.roles.remove(clan.roleId, `Clan ${clan.nom}`);
  } catch (_) { /* pas de permission / membre parti : on ignore */ }
}

// Appelé par les mini-jeux. Accepte un objet guilde ou un simple id.
function ajouterPointsClan(guildOrId, userId, pts) {
  if (!(pts > 0)) return;
  const g = store.social(idGuilde(guildOrId));
  const clan = clanDe(g, userId);
  if (!clan) return;
  clan.points = (clan.points || 0) + Math.floor(pts);
  store.sauverSocial();
}

function retirerMembreClan(g, clan, userId) {
  delete clan.membres[String(userId)];
  delete g.clanOf[String(userId)];
}

// Dissout un clan : libère les membres, supprime le rôle, rend la banque au chef.
async function supprimerClan(guild, g, clan) {
  for (const uid of Object.keys(clan.membres)) delete g.clanOf[uid];
  if (clan.banque > 0) store.ecoAjouter(guild.id, clan.chefId, clan.banque);
  if (clan.roleId) {
    try { await guild.roles.delete(clan.roleId, `Clan ${clan.nom} dissous`); } catch (_) { /* ignoré */ }
  }
  delete g.clans[clan.id];
  store.sauverSocial();
}

// Nettoyage quand un membre quitte le serveur.
async function nettoyerMembre(guild, userId) {
  const g = store.social(guild.id);
  const uid = String(userId);
  let modifie = false;

  const conjoint = g.couples[uid];
  if (conjoint) {
    delete g.couples[conjoint.partnerId];
    delete g.couples[uid];
    modifie = true;
  }
  if (g.amis[uid]) {
    for (const ami of g.amis[uid]) {
      if (g.amis[ami]) g.amis[ami] = g.amis[ami].filter(x => x !== uid);
    }
    delete g.amis[uid];
    modifie = true;
  }
  const clan = clanDe(g, uid);
  if (clan) {
    modifie = true;
    const etaitChef = clan.chefId === uid;
    retirerMembreClan(g, clan, uid);
    const restants = Object.entries(clan.membres);
    if (!restants.length) {
      await supprimerClan(guild, g, clan);
    } else if (etaitChef) {
      // L'officier le plus ancien (sinon le membre le plus ancien) devient chef.
      restants.sort((a, b) => {
        const pa = a[1].role === 'officier' ? 0 : 1;
        const pb = b[1].role === 'officier' ? 0 : 1;
        return pa - pb || a[1].depuis - b[1].depuis;
      });
      const [nouveauChef] = restants[0];
      clan.membres[nouveauChef].role = 'chef';
      clan.chefId = nouveauChef;
    }
  }
  if (modifie) store.sauverSocial();
}

// ═════════════════════════════════════════════════════════════════════════
// MARIAGE
// ═════════════════════════════════════════════════════════════════════════
async function mariageProposer(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const moi = interaction.user;

  if (cible.bot) return erreur(interaction, '❌ Tu ne peux pas épouser un bot (même moi 😅).');
  if (cible.id === moi.id) return erreur(interaction, '❌ Tu ne peux pas t\'épouser toi-même.');
  if (g.couples[moi.id]) return erreur(interaction, '❌ Tu es déjà marié(e). Fais d\'abord `/social marriage divorce`.');
  if (g.couples[cible.id]) return erreur(interaction, `❌ ${cible} est déjà marié(e).`);

  const ts = Date.now();
  return repondre(interaction,
    emb('💍 Demande en mariage', `${moi} demande ${cible} en mariage !\n\n${cible}, acceptes-tu ? *(la demande expire <t:${Math.floor((ts + DELAI_DEMANDE_MS) / 1000)}:R>)*`),
    {
      content: `${cible}`,
      components: [boutonsOuiNon(`soc_mar_ok:${moi.id}:${cible.id}:${ts}`, `soc_mar_no:${moi.id}:${cible.id}:${ts}`, 'Oui, je le veux 💖', 'Non merci')],
      allowedMentions: { users: [cible.id] },
    }, { badge: 'MARIAGE', versus: [moi, cible], versusIcon: '💍' });
}

async function boutonMariage(interaction, accepte) {
  const [, de, vers, ts] = interaction.customId.split(':');
  if (interaction.user.id !== vers) return erreur(interaction, '❌ Cette demande ne t\'est pas destinée.');
  const gm = { badge: 'MARIAGE', versus: await duo(interaction, de, vers), versusIcon: '💍' };
  if (expire(ts)) return majMessage(interaction, emb('⌛ Demande expirée', `La demande de <@${de}> n'a pas reçu de réponse à temps.`, 0x99AAB5), gm);
  if (!accepte) return majMessage(interaction, emb('💔 Refusé', `<@${vers}> a décliné la demande de <@${de}>.`, 0xED4245), { ...gm, versusIcon: '💔' });

  const g = store.social(interaction.guild.id);
  if (g.couples[de] || g.couples[vers]) {
    return majMessage(interaction, emb('❌ Impossible', 'L\'un de vous deux est déjà marié(e).', 0xED4245), gm);
  }
  const since = Date.now();
  g.couples[de] = { partnerId: vers, since };
  g.couples[vers] = { partnerId: de, since };
  store.sauverSocial();
  return majMessage(interaction, emb('💒 Félicitations !', `<@${de}> et <@${vers}> sont maintenant mariés ! 🎉\nQue la route vous soit douce. 🚛💕`, 0x57F287), { ...gm, versusIcon: '💖' });
}

async function mariageDivorcer(interaction) {
  const g = store.social(interaction.guild.id);
  const c = g.couples[interaction.user.id];
  if (!c) return erreur(interaction, '❌ Tu n\'es pas marié(e).');
  const ts = Date.now();
  return repondre(interaction,
    emb('💔 Divorce', `Tu veux vraiment divorcer de <@${c.partnerId}> ?\nVous étiez ensemble depuis ${date(c.since)}.`, 0xED4245),
    {
      components: [boutonsOuiNon(`soc_div_ok:${interaction.user.id}:${ts}`, `soc_div_no:${interaction.user.id}:${ts}`, 'Divorcer', 'Annuler')],
      flags: MessageFlags.Ephemeral,
    }, { badge: 'MARIAGE', versus: await duo(interaction, interaction.user.id, c.partnerId), versusIcon: '💔' });
}

async function boutonDivorce(interaction, accepte) {
  const [, uid, ts] = interaction.customId.split(':');
  if (interaction.user.id !== uid) return erreur(interaction, '❌ Ce bouton ne t\'est pas destiné.');
  if (!accepte) return majMessage(interaction, emb('💞 Annulé', 'Vous restez ensemble.', 0x57F287));
  if (expire(ts)) return majMessage(interaction, emb('⌛ Expiré', 'Relance la commande si tu veux divorcer.', 0x99AAB5));
  const g = store.social(interaction.guild.id);
  const c = g.couples[uid];
  if (!c) return majMessage(interaction, emb('❌ Déjà fait', 'Tu n\'es plus marié(e).', 0x99AAB5));
  delete g.couples[c.partnerId];
  delete g.couples[uid];
  store.sauverSocial();
  return majMessage(interaction, emb('💔 Divorcés', `<@${uid}> et <@${c.partnerId}> ne sont plus mariés.`, 0xED4245), { badge: 'MARIAGE', versus: await duo(interaction, uid, c.partnerId), versusIcon: '💔' });
}

// ═════════════════════════════════════════════════════════════════════════
// AMIS
// ═════════════════════════════════════════════════════════════════════════
async function amiAjouter(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const moi = interaction.user;
  if (cible.bot) return erreur(interaction, '❌ Les bots ne se font pas d\'amis (enfin, pas comme ça).');
  if (cible.id === moi.id) return erreur(interaction, '❌ Tu es déjà ton propre ami 😄');
  const mesAmis = g.amis[moi.id] || [];
  if (mesAmis.includes(cible.id)) return erreur(interaction, `❌ Vous êtes déjà amis, ${cible} et toi.`);
  if (mesAmis.length >= MAX_AMIS) return erreur(interaction, `❌ Tu as atteint la limite de ${MAX_AMIS} amis.`);
  if ((g.amis[cible.id] || []).length >= MAX_AMIS) return erreur(interaction, `❌ ${cible} a atteint sa limite d'amis.`);

  const ts = Date.now();
  return repondre(interaction,
    emb('🤝 Demande d\'ami', `${moi} veut devenir ami avec ${cible} !`),
    {
      content: `${cible}`,
      components: [boutonsOuiNon(`soc_ami_ok:${moi.id}:${cible.id}:${ts}`, `soc_ami_no:${moi.id}:${cible.id}:${ts}`)],
      allowedMentions: { users: [cible.id] },
    }, { badge: 'AMIS', versus: [moi, cible], versusIcon: '🤝' });
}

async function boutonAmi(interaction, accepte) {
  const [, de, vers, ts] = interaction.customId.split(':');
  if (interaction.user.id !== vers) return erreur(interaction, '❌ Cette demande ne t\'est pas destinée.');
  if (expire(ts)) return majMessage(interaction, emb('⌛ Demande expirée', `La demande de <@${de}> a expiré.`, 0x99AAB5));
  if (!accepte) return majMessage(interaction, emb('🚫 Refusé', `<@${vers}> a décliné la demande de <@${de}>.`, 0xED4245));

  const g = store.social(interaction.guild.id);
  if (!g.amis[de]) g.amis[de] = [];
  if (!g.amis[vers]) g.amis[vers] = [];
  if (g.amis[de].length >= MAX_AMIS || g.amis[vers].length >= MAX_AMIS) {
    return majMessage(interaction, emb('❌ Impossible', 'Une des listes d\'amis est pleine.', 0xED4245));
  }
  if (!g.amis[de].includes(vers)) g.amis[de].push(vers);
  if (!g.amis[vers].includes(de)) g.amis[vers].push(de);
  store.sauverSocial();
  return majMessage(interaction, emb('🎉 Nouveaux amis !', `<@${de}> et <@${vers}> sont maintenant amis.`, 0x57F287), { badge: 'AMIS', versus: await duo(interaction, de, vers), versusIcon: '🤝' });
}

async function amiRetirer(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const moi = interaction.user.id;
  if (!(g.amis[moi] || []).includes(cible.id)) return erreur(interaction, `❌ ${cible} n'est pas dans ta liste d'amis.`);
  g.amis[moi] = g.amis[moi].filter(x => x !== cible.id);
  if (g.amis[cible.id]) g.amis[cible.id] = g.amis[cible.id].filter(x => x !== moi);
  store.sauverSocial();
  return erreur(interaction, `✅ ${cible} a été retiré de tes amis.`);
}

async function amiListe(interaction) {
  const cible = interaction.options.getUser('membre') || interaction.user;
  const g = store.social(interaction.guild.id);
  const liste = g.amis[cible.id] || [];
  const desc = liste.length
    ? liste.slice(0, 40).map(id => `• <@${id}>`).join('\n') + (liste.length > 40 ? `\n… et ${liste.length - 40} autres` : '')
    : 'Aucun ami pour l\'instant. Utilise `/social friend add` !';
  return repondre(interaction, emb(`🤝 Amis de ${cible.displayName || cible.username} (${liste.length}/${MAX_AMIS})`, desc), {
    allowedMentions: { parse: [] },
  }, { badge: 'AMIS', avatar: cible.displayAvatarURL({ extension: 'png', size: 256 }) });
}

// ═════════════════════════════════════════════════════════════════════════
// PROFIL SOCIAL
// ═════════════════════════════════════════════════════════════════════════
async function profil(interaction) {
  const cible = interaction.options.getUser('membre') || interaction.user;
  const g = store.social(interaction.guild.id);
  const couple = g.couples[cible.id];
  const clan = clanDe(g, cible.id);
  const nbAmis = (g.amis[cible.id] || []).length;
  const stats = store.jeux(interaction.guild.id).stats[cible.id];

  const lignes = [
    `💍 **Mariage :** ${couple ? `<@${couple.partnerId}> — depuis ${date(couple.since)}` : 'Célibataire'}`,
    `🤝 **Amis :** ${nbAmis}`,
    `🛡️ **Clan :** ${clan ? `**[${clan.tag}] ${clan.nom}** (${roleDe(clan, cible.id)})` : 'Aucun'}`,
  ];
  if (stats) {
    lignes.push(`🎮 **Jeux :** ${stats.quizPoints} pts quiz • ${stats.penduWins} pendu • ${stats.devineWins} devine • ${stats.motsCount} mots`);
  }
  return repondre(interaction, emb(`👤 Profil social — ${cible.displayName || cible.username}`, lignes.join('\n')), {
    allowedMentions: { parse: [] },
  }, { badge: 'PROFIL', avatar: cible.displayAvatarURL({ extension: 'png', size: 256 }) });
}

// ═════════════════════════════════════════════════════════════════════════
// CLANS — commandes
// ═════════════════════════════════════════════════════════════════════════
async function clanCreer(interaction) {
  const nom = interaction.options.getString('nom', true).trim();
  const tag = interaction.options.getString('tag', true).trim().toUpperCase();
  const g = store.social(interaction.guild.id);
  const uid = interaction.user.id;

  if (clanDe(g, uid)) return erreur(interaction, '❌ Tu es déjà dans un clan. Quitte-le d\'abord (`/social clan leave`).');
  if (nom.length < 3 || nom.length > 24) return erreur(interaction, '❌ Le nom doit faire entre 3 et 24 caractères.');
  if (!/^[A-Z0-9]{2,5}$/.test(tag)) return erreur(interaction, '❌ Le tag doit faire 2 à 5 caractères (lettres ou chiffres, sans accent).');
  if (/@|discord\.gg|https?:\/\//i.test(nom)) return erreur(interaction, '❌ Nom de clan invalide.');
  if (Object.values(g.clans).some(c => c.nom.toLowerCase() === nom.toLowerCase())) return erreur(interaction, '❌ Un clan avec ce nom existe déjà.');
  if (Object.values(g.clans).some(c => c.tag === tag)) return erreur(interaction, '❌ Ce tag est déjà pris.');

  const emoji = store.ecoEmoji(interaction.guild.id);
  if (store.ecoActive(interaction.guild.id)) {
    if (!store.ecoRetirer(interaction.guild.id, uid, COUT_CREATION_CLAN)) {
      return erreur(interaction, `❌ Créer un clan coûte **${COUT_CREATION_CLAN} ${emoji}** (dans ton porte-monnaie). Tu as **${store.ecoSolde(interaction.guild.id, uid)} ${emoji}**.`);
    }
  }

  const id = String(g.nextClanId++);
  const clan = {
    id, nom, tag, chefId: uid, description: '', banque: 0, points: 0, roleId: null,
    creeLe: Date.now(), membres: { [uid]: { role: 'chef', depuis: Date.now() } },
  };
  try {
    const role = await interaction.guild.roles.create({ name: `[${tag}] ${nom}`, mentionable: false, reason: `Clan créé par ${interaction.user.tag}` });
    clan.roleId = role.id;
  } catch (_) { /* pas de permission : le clan fonctionne sans rôle */ }
  g.clans[id] = clan;
  g.clanOf[uid] = id;
  store.sauverSocial();
  await syncRole(interaction.guild, clan, uid, true);

  return repondre(interaction,
    emb('🛡️ Clan créé !', `**[${tag}] ${nom}** est né, avec ${interaction.user} comme chef 👑\n${clan.roleId ? `Rôle : <@&${clan.roleId}>\n` : ''}\nInvite des membres avec \`/social clan invite\`.`, 0x57F287),
    { allowedMentions: { parse: [] } }, { badge: 'CLAN' });
}

function embedClan(g, clan, guildId) {
  const classement = Object.values(g.clans).sort((a, b) => b.points - a.points);
  const rang = classement.findIndex(c => c.id === clan.id) + 1;
  const ordre = { chef: 0, officier: 1, membre: 2 };
  const membres = Object.entries(clan.membres).sort((a, b) => ordre[a[1].role] - ordre[b[1].role] || a[1].depuis - b[1].depuis);
  const liste = membres.slice(0, 20).map(([uid, m]) => `${ROLES_ICONES[m.role]} <@${uid}>`).join('\n') + (membres.length > 20 ? `\n… +${membres.length - 20}` : '');
  const emoji = store.ecoEmoji(guildId);
  const desc = [
    clan.description ? `*${clan.description}*\n` : '',
    `🏆 **Points :** ${clan.points.toLocaleString('fr-FR')} (rang **#${rang}**)`,
    `💰 **Banque :** ${Math.floor(clan.banque).toLocaleString('fr-FR')} ${emoji}`,
    `👥 **Membres :** ${membres.length}/${MAX_MEMBRES_CLAN}`,
    `📅 **Créé :** ${date(clan.creeLe)}`,
    clan.roleId ? `🎭 **Rôle :** <@&${clan.roleId}>` : '',
    `\n**Effectif**\n${liste}`,
  ].filter(Boolean).join('\n');
  return emb(`🛡️ [${clan.tag}] ${clan.nom}`, desc);
}

async function clanInfo(interaction) {
  const g = store.social(interaction.guild.id);
  const nom = interaction.options.getString('nom');
  const clan = nom ? trouverClan(g, nom) : clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, nom ? '❌ Aucun clan avec ce nom ou ce tag.' : '❌ Tu n\'es dans aucun clan. Précise un nom : `/social clan info nom:...`');
  return repondre(interaction, embedClan(g, clan, interaction.guild.id), { allowedMentions: { parse: [] } }, { badge: 'CLAN' });
}

async function clanTop(interaction) {
  const g = store.social(interaction.guild.id);
  const top = Object.values(g.clans).sort((a, b) => b.points - a.points || Object.keys(b.membres).length - Object.keys(a.membres).length).slice(0, 10);
  const rows = top.map((c) => {
    const n = Object.keys(c.membres).length;
    return { name: `[${c.tag}] ${c.nom}`, value: `${c.points.toLocaleString('fr-FR')} pts · ${n} membre${n > 1 ? 's' : ''}` };
  });
  const payload = buildRankingPayload({
    guildId: interaction.guild.id,
    heading: '## 🏆 Classement des clans',
    title: 'Classement des clans',
    subtitle: rows.length ? `${rows.length} clan${rows.length > 1 ? 's' : ''}` : 'aucun clan',
    badge: 'CLANS',
    rows,
    note: rows.length
      ? '-# Les clans gagnent des points quand leurs membres gagnent aux mini-jeux (/game).'
      : 'Crée le premier clan avec `/social clan create` !',
  });
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function clanInviter(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (!estGradé(clan, interaction.user.id)) return erreur(interaction, '❌ Seuls le chef et les officiers peuvent inviter.');
  if (cible.bot) return erreur(interaction, '❌ Les bots ne rejoignent pas les clans.');
  if (clanDe(g, cible.id)) return erreur(interaction, `❌ ${cible} est déjà dans un clan.`);
  if (Object.keys(clan.membres).length >= MAX_MEMBRES_CLAN) return erreur(interaction, `❌ Le clan est plein (${MAX_MEMBRES_CLAN} membres).`);

  const ts = Date.now();
  return repondre(interaction,
    emb('🛡️ Invitation de clan', `${interaction.user} invite ${cible} à rejoindre **[${clan.tag}] ${clan.nom}** !`),
    {
      content: `${cible}`,
      components: [boutonsOuiNon(`soc_clan_ok:${clan.id}:${cible.id}:${interaction.user.id}:${ts}`, `soc_clan_no:${clan.id}:${cible.id}:${interaction.user.id}:${ts}`, 'Rejoindre', 'Refuser')],
      allowedMentions: { users: [cible.id] },
    }, { badge: 'CLAN', versus: [interaction.user, cible], versusIcon: '🛡️' });
}

async function boutonClan(interaction, accepte) {
  const [, clanId, vers, par, ts] = interaction.customId.split(':');
  if (interaction.user.id !== vers) return erreur(interaction, '❌ Cette invitation ne t\'est pas destinée.');
  if (expire(ts)) return majMessage(interaction, emb('⌛ Invitation expirée', 'Demande un nouveau lien d\'invitation.', 0x99AAB5));
  if (!accepte) return majMessage(interaction, emb('🚫 Refusée', `<@${vers}> a décliné l'invitation.`, 0xED4245));

  const g = store.social(interaction.guild.id);
  const clan = g.clans[clanId];
  if (!clan) return majMessage(interaction, emb('❌ Clan introuvable', 'Ce clan n\'existe plus.', 0xED4245));
  if (!estGradé(clan, par)) return majMessage(interaction, emb('❌ Invitation invalide', 'La personne qui t\'a invité n\'a plus les droits.', 0xED4245));
  if (clanDe(g, vers)) return majMessage(interaction, emb('❌ Impossible', 'Tu es déjà dans un clan.', 0xED4245));
  if (Object.keys(clan.membres).length >= MAX_MEMBRES_CLAN) return majMessage(interaction, emb('❌ Clan plein', 'Plus de place dans ce clan.', 0xED4245));

  clan.membres[vers] = { role: 'membre', depuis: Date.now() };
  g.clanOf[vers] = clan.id;
  store.sauverSocial();
  await syncRole(interaction.guild, clan, vers, true);
  return majMessage(interaction, emb('🎉 Bienvenue !', `<@${vers}> rejoint **[${clan.tag}] ${clan.nom}** !`, 0x57F287));
}

async function clanQuitter(interaction) {
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (clan.chefId === interaction.user.id) {
    return erreur(interaction, '❌ Tu es le chef : transfère le clan (`/social clan transfer`) ou dissous-le (`/social clan disband`).');
  }
  retirerMembreClan(g, clan, interaction.user.id);
  store.sauverSocial();
  await syncRole(interaction.guild, clan, interaction.user.id, false);
  return repondre(interaction, emb('👋 Clan quitté', `${interaction.user} a quitté **[${clan.tag}] ${clan.nom}**.`), { allowedMentions: { parse: [] } });
}

async function clanExpulser(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (!estGradé(clan, interaction.user.id)) return erreur(interaction, '❌ Seuls le chef et les officiers peuvent expulser.');
  if (roleDe(clan, cible.id) === null) return erreur(interaction, '❌ Cette personne n\'est pas dans ton clan.');
  if (cible.id === interaction.user.id) return erreur(interaction, '❌ Utilise `/social clan leave` pour partir.');
  if (clan.chefId === cible.id) return erreur(interaction, '❌ On n\'expulse pas le chef.');
  if (roleDe(clan, cible.id) === 'officier' && clan.chefId !== interaction.user.id) return erreur(interaction, '❌ Seul le chef peut expulser un officier.');
  retirerMembreClan(g, clan, cible.id);
  store.sauverSocial();
  await syncRole(interaction.guild, clan, cible.id, false);
  return repondre(interaction, emb('🚪 Expulsé', `${cible} a été expulsé de **[${clan.tag}] ${clan.nom}** par ${interaction.user}.`, 0xED4245), { allowedMentions: { parse: [] } });
}

async function clanChangerGrade(interaction, nouveauRole) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (clan.chefId !== interaction.user.id) return erreur(interaction, '❌ Seul le chef peut gérer les grades.');
  const actuel = roleDe(clan, cible.id);
  if (!actuel) return erreur(interaction, '❌ Cette personne n\'est pas dans ton clan.');
  if (cible.id === interaction.user.id) return erreur(interaction, '❌ Tu es déjà le chef.');
  if (actuel === nouveauRole) return erreur(interaction, `❌ ${cible} est déjà ${nouveauRole}.`);
  clan.membres[cible.id].role = nouveauRole;
  store.sauverSocial();
  const promu = nouveauRole === 'officier';
  return repondre(interaction, emb(promu ? '🛡️ Promotion' : '⬇️ Rétrogradation', `${cible} est maintenant **${nouveauRole}** dans **[${clan.tag}] ${clan.nom}**.`, promu ? 0x57F287 : 0xFEE75C), { allowedMentions: { parse: [] } });
}

async function clanTransferer(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (clan.chefId !== interaction.user.id) return erreur(interaction, '❌ Seul le chef peut transférer le clan.');
  if (cible.id === interaction.user.id || !clan.membres[cible.id]) return erreur(interaction, '❌ Choisis un autre membre de ton clan.');
  clan.membres[interaction.user.id].role = 'officier';
  clan.membres[cible.id].role = 'chef';
  clan.chefId = cible.id;
  store.sauverSocial();
  return repondre(interaction, emb('👑 Nouveau chef', `${cible} devient le chef de **[${clan.tag}] ${clan.nom}**.`, 0x57F287), { allowedMentions: { parse: [] } });
}

async function clanDissoudre(interaction) {
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (clan.chefId !== interaction.user.id) return erreur(interaction, '❌ Seul le chef peut dissoudre le clan.');
  const ts = Date.now();
  const emoji = store.ecoEmoji(interaction.guild.id);
  return repondre(interaction,
    emb('⚠️ Dissoudre le clan ?', `**[${clan.tag}] ${clan.nom}** et ses **${Object.keys(clan.membres).length}** membres seront libérés.\nLa banque (**${Math.floor(clan.banque)} ${emoji}**) te sera rendue. Action **définitive**.`, 0xED4245),
    {
      components: [boutonsOuiNon(`soc_dis_ok:${clan.id}:${interaction.user.id}:${ts}`, `soc_dis_no:${clan.id}:${interaction.user.id}:${ts}`, 'Dissoudre', 'Annuler')],
      flags: MessageFlags.Ephemeral,
    });
}

async function boutonDissoudre(interaction, accepte) {
  const [, clanId, uid, ts] = interaction.customId.split(':');
  if (interaction.user.id !== uid) return erreur(interaction, '❌ Ce bouton ne t\'est pas destiné.');
  if (!accepte) return majMessage(interaction, emb('✅ Annulé', 'Le clan est conservé.', 0x57F287));
  if (expire(ts)) return majMessage(interaction, emb('⌛ Expiré', 'Relance la commande.', 0x99AAB5));
  const g = store.social(interaction.guild.id);
  const clan = g.clans[clanId];
  if (!clan || clan.chefId !== uid) return majMessage(interaction, emb('❌ Impossible', 'Tu n\'es plus le chef de ce clan.', 0xED4245));
  const nom = `[${clan.tag}] ${clan.nom}`;
  await supprimerClan(interaction.guild, g, clan);
  return majMessage(interaction, emb('💥 Clan dissous', `**${nom}** n'existe plus.`, 0xED4245));
}

async function clanBanque(interaction, sens) {
  const montant = interaction.options.getInteger('montant', true);
  const gid = interaction.guild.id;
  if (!store.ecoActive(gid)) return erreur(interaction, '❌ L\'économie est désactivée sur ce serveur.');
  const g = store.social(gid);
  const clan = clanDe(g, interaction.user.id);
  const emoji = store.ecoEmoji(gid);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');

  if (sens === 'deposer') {
    if (!store.ecoRetirer(gid, interaction.user.id, montant)) {
      return erreur(interaction, `❌ Pas assez de ${emoji} dans ton porte-monnaie (${store.ecoSolde(gid, interaction.user.id)}).`);
    }
    clan.banque += montant;
    store.sauverSocial();
    return repondre(interaction, emb('💰 Dépôt', `${interaction.user} dépose **${montant} ${emoji}** dans la banque de **[${clan.tag}] ${clan.nom}**.\nSolde du clan : **${Math.floor(clan.banque)} ${emoji}**`, 0x57F287), { allowedMentions: { parse: [] } });
  }
  if (clan.chefId !== interaction.user.id) return erreur(interaction, '❌ Seul le chef peut retirer de l\'argent de la banque.');
  if (clan.banque < montant) return erreur(interaction, `❌ La banque du clan ne contient que **${Math.floor(clan.banque)} ${emoji}**.`);
  clan.banque -= montant;
  store.ecoAjouter(gid, interaction.user.id, montant);
  store.sauverSocial();
  return repondre(interaction, emb('💸 Retrait', `${interaction.user} retire **${montant} ${emoji}** de la banque.\nSolde du clan : **${Math.floor(clan.banque)} ${emoji}**`), { allowedMentions: { parse: [] } });
}

async function clanDescription(interaction) {
  const texte = interaction.options.getString('texte', true).trim().slice(0, 150);
  const g = store.social(interaction.guild.id);
  const clan = clanDe(g, interaction.user.id);
  if (!clan) return erreur(interaction, '❌ Tu n\'es dans aucun clan.');
  if (!estGradé(clan, interaction.user.id)) return erreur(interaction, '❌ Seuls le chef et les officiers peuvent modifier la description.');
  if (/@everyone|@here|discord\.gg/i.test(texte)) return erreur(interaction, '❌ Description invalide.');
  clan.description = texte;
  store.sauverSocial();
  return erreur(interaction, '✅ Description mise à jour.');
}

// ═════════════════════════════════════════════════════════════════════════
// Entrées publiques
// ═════════════════════════════════════════════════════════════════════════
async function executerSocial(interaction) {
  if (!interaction.guild) return erreur(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const groupe = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (!groupe) {
    if (sub === 'profil') return profil(interaction);
  } else if (groupe === 'mariage') {
    if (sub === 'proposer') return mariageProposer(interaction);
    if (sub === 'divorcer') return mariageDivorcer(interaction);
    if (sub === 'profil') return profil(interaction);
  } else if (groupe === 'ami') {
    if (sub === 'ajouter') return amiAjouter(interaction);
    if (sub === 'retirer') return amiRetirer(interaction);
    if (sub === 'liste') return amiListe(interaction);
  } else if (groupe === 'clan') {
    if (sub === 'creer') return clanCreer(interaction);
    if (sub === 'info') return clanInfo(interaction);
    if (sub === 'top') return clanTop(interaction);
    if (sub === 'inviter') return clanInviter(interaction);
    if (sub === 'quitter') return clanQuitter(interaction);
    if (sub === 'expulser') return clanExpulser(interaction);
    if (sub === 'promouvoir') return clanChangerGrade(interaction, 'officier');
    if (sub === 'retrograder') return clanChangerGrade(interaction, 'membre');
    if (sub === 'transferer') return clanTransferer(interaction);
    if (sub === 'dissoudre') return clanDissoudre(interaction);
    if (sub === 'deposer') return clanBanque(interaction, 'deposer');
    if (sub === 'retirer') return clanBanque(interaction, 'retirer');
    if (sub === 'description') return clanDescription(interaction);
  }
  return erreur(interaction, '❌ Sous-commande inconnue.');
}

// Retourne true si l'interaction appartient au système social.
function traiterInteraction(interaction) {
  const action = (interaction.customId || '').split(':')[0];
  const table = {
    soc_mar_ok: () => boutonMariage(interaction, true),
    soc_mar_no: () => boutonMariage(interaction, false),
    soc_div_ok: () => boutonDivorce(interaction, true),
    soc_div_no: () => boutonDivorce(interaction, false),
    soc_ami_ok: () => boutonAmi(interaction, true),
    soc_ami_no: () => boutonAmi(interaction, false),
    soc_clan_ok: () => boutonClan(interaction, true),
    soc_clan_no: () => boutonClan(interaction, false),
    soc_dis_ok: () => boutonDissoudre(interaction, true),
    soc_dis_no: () => boutonDissoudre(interaction, false),
  };
  if (!table[action]) return false;
  Promise.resolve(table[action]()).catch(e => console.error('[Social] Erreur bouton :', e.message));
  return true;
}

module.exports = { executerSocial, traiterInteraction, ajouterPointsClan, nettoyerMembre };
