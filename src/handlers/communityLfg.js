'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { toCV2Payload } = require('../core/componentsV2');
const { glassPayload } = require('../core/glassEmbed');
const store = require('../core/communityStore');

// ─────────────────────────────────────────────────────────────────────────
// Recherche de joueurs (/lfg)
//  • Annonce avec boutons Rejoindre / Quitter / Fermer
//  • Quand l'équipe est complète : ping des joueurs + salon vocal temporaire
//    optionnel (supprimé automatiquement quand il est vide ou à l'expiration)
//  • Les annonces expirent toutes seules (durée au choix)
// ─────────────────────────────────────────────────────────────────────────

const COULEUR = 0xFFFFFF;
const MAX_ANNONCES_PAR_MEMBRE = 2;
const DUREE_DEFAUT_MIN = 60;
const VERIF_INTERVALLE_MS = 30 * 1000;
const SUPPRESSION_VOCAL_VIDE_MS = 5 * 60 * 1000;
const PAS_DE_PING = { parse: [] };

let clientRef = null;

function erreur(interaction, texte) {
  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}
function emb(titre, desc, couleur = COULEUR) {
  return new EmbedBuilder().setTitle(titre).setDescription(desc).setColor(couleur);
}

// ── Rendu de l'annonce ──────────────────────────────────────────────────
function embedAnnonce(post) {
  const complet = post.joueurs.length >= post.places;
  const actif = post.statut === 'ouvert';
  const places = `${post.joueurs.length}/${post.places}`;
  const barre = '🟩'.repeat(Math.min(post.joueurs.length, post.places)) + '⬜'.repeat(Math.max(0, post.places - post.joueurs.length));

  const lignes = [];
  if (post.description) lignes.push(`📝 ${post.description}`, '');
  lignes.push(`👑 **Organisateur :** <@${post.auteurId}>`);
  if (post.heure) lignes.push(`🕒 **Quand :** ${post.heure}`);
  lignes.push(`👥 **Joueurs (${places})**  ${barre}`);
  lignes.push(post.joueurs.map(id => `• <@${id}>`).join('\n'));
  if (post.vocalId) lignes.push('', `🔊 **Vocal :** <#${post.vocalId}>`);

  let couleur = COULEUR;
  let titre = `🎮 Recherche de joueurs — ${post.jeu}`;
  if (post.statut === 'ferme') { titre = `🔒 Annonce fermée — ${post.jeu}`; couleur = 0x99AAB5; }
  else if (post.statut === 'expire') { titre = `⌛ Annonce expirée — ${post.jeu}`; couleur = 0x99AAB5; }
  else if (complet) { titre = `✅ Équipe complète — ${post.jeu}`; couleur = 0x5865F2; }

  if (actif && !complet) lignes.push('', `⏳ Expire ${`<t:${Math.floor(post.expireLe / 1000)}:R>`}`);
  return emb(titre, lignes.join('\n'), couleur);
}

function ligneBoutons(post, desactive = false) {
  const complet = post.joueurs.length >= post.places;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lfg_join:${post.id}`).setLabel('Rejoindre').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(desactive || complet),
    new ButtonBuilder().setCustomId(`lfg_leave:${post.id}`).setLabel('Quitter').setEmoji('🚪').setStyle(ButtonStyle.Secondary).setDisabled(desactive),
    new ButtonBuilder().setCustomId(`lfg_close:${post.id}`).setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(desactive),
  );
}

// Carte « verre fumé » de l'annonce (async : rendu image). edit = true quand on modifie un message existant.
function payloadAnnonce(post, guild, extra = {}, edit = false) {
  const fini = post.statut !== 'ouvert';
  return glassPayload({
    embeds: [embedAnnonce(post)],
    components: fini ? [] : [ligneBoutons(post)],
    allowedMentions: PAS_DE_PING,
    ...extra,
  }, { guild, client: guild && guild.client, badge: 'LFG', update: edit });
}

// Boutons : on accuse réception tout de suite (le rendu de la carte peut prendre un instant)
async function majAnnonceBouton(interaction, post, guild) {
  await interaction.deferUpdate().catch(() => {});
  return interaction.editReply(await payloadAnnonce(post, guild, {}, true));
}

async function recupererMessage(guild, post) {
  try {
    const salon = await guild.channels.fetch(post.channelId);
    if (!salon?.messages) return null;
    return await salon.messages.fetch(post.messageId);
  } catch (_) {
    return null;
  }
}
async function rafraichir(guild, post) {
  const msg = await recupererMessage(guild, post);
  if (msg) await msg.edit(await payloadAnnonce(post, guild, {}, true)).catch(() => {});
}

// ── Commandes ───────────────────────────────────────────────────────────
async function creer(interaction) {
  const guild = interaction.guild;
  const cfg = store.lfg(guild.id);
  const jeu = interaction.options.getString('jeu', true).trim().slice(0, 60);
  const places = interaction.options.getInteger('places', true);
  const description = (interaction.options.getString('description') || '').trim().slice(0, 300);
  const heure = (interaction.options.getString('quand') || '').trim().slice(0, 60);
  const duree = interaction.options.getInteger('duree') || DUREE_DEFAUT_MIN;
  const vocal = interaction.options.getBoolean('vocal') || false;

  if (/@everyone|@here|discord\.gg/i.test(`${jeu} ${description} ${heure}`)) {
    return erreur(interaction, '❌ Pas de @everyone, @here ni d\'invitation dans une annonce.');
  }
  const actives = Object.values(cfg.posts).filter(p => p.auteurId === interaction.user.id && p.statut === 'ouvert');
  if (actives.length >= MAX_ANNONCES_PAR_MEMBRE) {
    return erreur(interaction, `❌ Tu as déjà ${MAX_ANNONCES_PAR_MEMBRE} annonces ouvertes. Ferme-en une (bouton 🔒) avant d'en créer une autre.`);
  }

  // Salon de publication : celui configuré, sinon le salon actuel
  let salon = interaction.channel;
  if (cfg.channelId) {
    const configure = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (configure?.isTextBased()) salon = configure;
  }
  if (!salon || typeof salon.send !== 'function') return erreur(interaction, '❌ Impossible de publier dans ce salon.');

  if (vocal) {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return erreur(interaction, '❌ Pour créer un vocal automatique, il me faut la permission **Gérer les salons**.');
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = String(cfg.nextId++);
  const post = {
    id, auteurId: interaction.user.id, jeu, places, description, heure,
    joueurs: [interaction.user.id], vocal, vocalId: null, statut: 'ouvert',
    channelId: salon.id, messageId: null, creeLe: Date.now(), expireLe: Date.now() + duree * 60 * 1000,
    vocalVideDepuis: null,
  };

  const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;
  let msg;
  try {
    msg = await salon.send(await payloadAnnonce(post, guild, {
      content: ping || undefined,
      allowedMentions: ping ? { roles: [cfg.pingRoleId] } : PAS_DE_PING,
    }));
  } catch (e) {
    cfg.nextId--;
    return interaction.editReply({ content: '❌ Je n\'ai pas pu publier l\'annonce (permissions du salon ?).' });
  }
  post.messageId = msg.id;
  cfg.posts[id] = post;
  store.sauverLfg();
  return interaction.editReply({ content: `✅ Annonce publiée dans ${salon} (expire dans ${duree} min).` });
}

async function liste(interaction) {
  const cfg = store.lfg(interaction.guild.id);
  const ouvertes = Object.values(cfg.posts).filter(p => p.statut === 'ouvert').sort((a, b) => a.expireLe - b.expireLe);
  if (!ouvertes.length) {
    return interaction.reply(await glassPayload({ embeds: [emb('🎮 Annonces ouvertes', 'Aucune annonce pour le moment. Lance-en une avec `/lfg create` !')], ephemeral: true }, { guild: interaction.guild, client: interaction.client, badge: 'LFG' }));
  }
  const lignes = ouvertes.slice(0, 15).map(p => {
    const lien = `https://discord.com/channels/${interaction.guild.id}/${p.channelId}/${p.messageId}`;
    return `**${p.jeu}** — ${p.joueurs.length}/${p.places} • <@${p.auteurId}> • [voir l'annonce](${lien})`;
  });
  return interaction.reply(await glassPayload({
    embeds: [emb(`🎮 Annonces ouvertes (${ouvertes.length})`, lignes.join('\n'))],
    ephemeral: true,
    allowedMentions: PAS_DE_PING,
  }, { guild: interaction.guild, client: interaction.client, badge: 'LFG' }));
}

async function annuler(interaction) {
  const cfg = store.lfg(interaction.guild.id);
  const mesAnnonces = Object.values(cfg.posts).filter(p => p.auteurId === interaction.user.id && p.statut === 'ouvert');
  if (!mesAnnonces.length) return erreur(interaction, '❌ Tu n\'as aucune annonce ouverte.');
  for (const p of mesAnnonces) await terminer(interaction.guild, p, 'ferme');
  return erreur(interaction, `✅ ${mesAnnonces.length} annonce${mesAnnonces.length > 1 ? 's' : ''} fermée${mesAnnonces.length > 1 ? 's' : ''}.`);
}

async function configurer(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return erreur(interaction, '❌ Permission requise : **Gérer le serveur**.');
  }
  const cfg = store.lfg(interaction.guild.id);
  const salon = interaction.options.getChannel('salon');
  const role = interaction.options.getRole('role');
  const reset = interaction.options.getBoolean('reinitialiser');

  if (reset) {
    cfg.channelId = null;
    cfg.pingRoleId = null;
  } else {
    if (salon) cfg.channelId = salon.id;
    if (role) cfg.pingRoleId = role.id;
  }
  store.sauverLfg();
  return erreur(interaction,
    `✅ Configuration LFG :\n• Salon des annonces : ${cfg.channelId ? `<#${cfg.channelId}>` : 'salon où la commande est utilisée'}\n• Rôle pingé : ${cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : 'aucun'}`);
}

// ── Fin d'annonce / vocal ───────────────────────────────────────────────
async function terminer(guild, post, statut) {
  post.statut = statut;
  await rafraichir(guild, post);
  // Le vocal (s'il existe) est géré par la tâche de nettoyage : supprimé quand vide.
  store.sauverLfg();
}

async function creerVocal(guild, post) {
  try {
    const parent = (await guild.channels.fetch(post.channelId).catch(() => null))?.parentId || undefined;
    const permissions = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
      ...post.joueurs.map(uid => ({ id: uid, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak] })),
    ];
    const salon = await guild.channels.create({
      name: `🎮 ${post.jeu}`.slice(0, 90),
      type: ChannelType.GuildVoice,
      parent,
      userLimit: post.places,
      permissionOverwrites: permissions,
      reason: `LFG #${post.id}`,
    });
    post.vocalId = salon.id;
    post.vocalVideDepuis = Date.now();
  } catch (e) {
    console.warn('[LFG] Création du vocal impossible :', e.message);
  }
}

// ── Boutons ─────────────────────────────────────────────────────────────
async function boutonLfg(interaction) {
  const [action, postId] = interaction.customId.split(':');
  const guild = interaction.guild;
  const cfg = store.lfg(guild.id);
  const post = cfg.posts[postId];
  if (!post || post.statut !== 'ouvert') {
    return interaction.update(await glassPayload({ embeds: [embedAnnonce({ ...(post || { jeu: '?', joueurs: [], places: 0, auteurId: '0', expireLe: 0 }), statut: post?.statut || 'ferme' })], components: [], allowedMentions: PAS_DE_PING },
      { guild, client: interaction.client, badge: 'LFG', update: true })).catch(() => {});
  }
  const uid = interaction.user.id;

  if (action === 'lfg_join') {
    if (post.joueurs.includes(uid)) return erreur(interaction, '✋ Tu es déjà dans l\'équipe.');
    if (post.joueurs.length >= post.places) return erreur(interaction, '❌ L\'équipe est déjà complète.');
    post.joueurs.push(uid);
    const complet = post.joueurs.length >= post.places;

    if (complet && post.vocal && !post.vocalId) await creerVocal(guild, post);
    store.sauverLfg();
    await majAnnonceBouton(interaction, post, guild);

    if (complet) {
      const salon = interaction.channel;
      salon.send({
        content: `🎉 **Équipe complète pour ${post.jeu} !** ${post.joueurs.map(id => `<@${id}>`).join(' ')}${post.vocalId ? `\n🔊 Rejoignez le vocal : <#${post.vocalId}>` : ''}`,
        allowedMentions: { users: post.joueurs },
      }).catch(() => {});
    } else {
      interaction.channel.send({
        content: `✅ <@${uid}> a rejoint l'équipe **${post.jeu}** (${post.joueurs.length}/${post.places}) — <@${post.auteurId}>`,
        allowedMentions: { users: [post.auteurId] },
      }).then(m => setTimeout(() => m.delete().catch(() => {}), 15000)).catch(() => {});
    }
    return;
  }

  if (action === 'lfg_leave') {
    if (!post.joueurs.includes(uid)) return erreur(interaction, '❌ Tu n\'es pas dans cette équipe.');
    if (uid === post.auteurId) return erreur(interaction, '❌ Tu es l\'organisateur : utilise 🔒 **Fermer** pour annuler l\'annonce.');
    post.joueurs = post.joueurs.filter(id => id !== uid);
    if (post.vocalId) {
      const vocal = await guild.channels.fetch(post.vocalId).catch(() => null);
      vocal?.permissionOverwrites?.delete(uid).catch(() => {});
    }
    store.sauverLfg();
    return majAnnonceBouton(interaction, post, guild);
  }

  if (action === 'lfg_close') {
    const modo = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
    if (uid !== post.auteurId && !modo) return erreur(interaction, '❌ Seul l\'organisateur (ou un modérateur) peut fermer l\'annonce.');
    post.statut = 'ferme';
    store.sauverLfg();
    return majAnnonceBouton(interaction, post, guild);
  }
}

// ── Tâche de fond : expiration + nettoyage des vocaux ───────────────────
async function verifier(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = store.lfg(guild.id);
    const now = Date.now();
    let modifie = false;

    for (const post of Object.values(cfg.posts)) {
      if (post.statut === 'ouvert' && post.expireLe <= now) {
        post.statut = 'expire';
        modifie = true;
        await rafraichir(guild, post);
      }
      // Nettoyage du vocal : supprimé s'il est vide depuis 5 min, ou si l'annonce est finie et qu'il est vide
      if (post.vocalId) {
        const vocal = guild.channels.cache.get(post.vocalId) || await guild.channels.fetch(post.vocalId).catch(() => null);
        if (!vocal) { post.vocalId = null; modifie = true; continue; }
        if (vocal.members.size > 0) {
          post.vocalVideDepuis = null;
        } else {
          if (!post.vocalVideDepuis) post.vocalVideDepuis = now;
          const videDepuis = now - post.vocalVideDepuis;
          if (videDepuis >= SUPPRESSION_VOCAL_VIDE_MS || (post.statut !== 'ouvert' && videDepuis >= 30000)) {
            await vocal.delete('LFG : vocal vide').catch(() => {});
            post.vocalId = null;
            modifie = true;
          }
        }
      }
      // Purge des vieilles annonces terminées (plus de 3 jours) pour garder le fichier léger
      if (post.statut !== 'ouvert' && !post.vocalId && now - post.expireLe > 3 * 24 * 3600 * 1000) {
        delete cfg.posts[post.id];
        modifie = true;
      }
    }
    if (modifie) store.sauverLfg();
  }
}

function demarrerTache(client) {
  clientRef = client;
  setInterval(() => verifier(clientRef).catch(e => console.error('[LFG] Erreur tâche :', e.message)), VERIF_INTERVALLE_MS);
}

async function executerLfg(interaction) {
  if (!interaction.guild) return erreur(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const sub = interaction.options.getSubcommand();
  if (sub === 'creer') return creer(interaction);
  if (sub === 'liste') return liste(interaction);
  if (sub === 'annuler') return annuler(interaction);
  if (sub === 'config') return configurer(interaction);
  return erreur(interaction, '❌ Sous-commande inconnue.');
}

function traiterInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('lfg_')) return false;
  Promise.resolve(boutonLfg(interaction)).catch(e => console.error('[LFG] Erreur bouton :', e.message));
  return true;
}

module.exports = { executerLfg, traiterInteraction, demarrerTache, verifier };
