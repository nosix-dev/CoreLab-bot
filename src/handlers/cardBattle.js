'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Combats de cartes Pokémon en PvP (/poke-fight)
//
//  1. /poke-fight challenge @membre [mise]  → le membre accepte ou refuse
//  2. chaque joueur choisit 3 cartes de sa collection (ou « équipe auto »)
//  3. combat au tour par tour : chaque manche, les deux joueurs choisissent
//     EN SECRET (Attaque / Spécial / Garde / Changer), puis la manche est
//     résolue : la carte la plus rapide frappe en premier
//  4. la mise (💠, optionnelle) est mise en séquestre au début du combat et
//     versée au vainqueur ; remboursée en cas d'égalité ou de plantage du bot
//
// Les cartes ne sont JAMAIS perdues. Tout est rendu en Components V2.
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');
const cg = require('../core/cardGame');
const { getRarity } = require('../core/collectionItems');
const { getCardImage } = require('../core/pokemonCards');
const { toCV2Payload, containerFromEmbed } = require('../core/componentsV2');
const { glassPayload } = require('../core/glassEmbed');

const COULEUR = 0xFFFFFF;
const PAS_DE_PING = { parse: [] };
const EPH = MessageFlags.Ephemeral;

const TAILLE_EQUIPE = 3;
const DELAI_DEFI = 60_000;
const DELAI_EQUIPE = 120_000;
const DELAI_MANCHE = 60_000;
const MANCHES_MAX = 30;
const MISE_MAX = 1_000_000;
const RECHARGE_SPECIAL = 3;
const FACTEUR_DEGATS = 1.35; // règle la durée des combats (~12-14 manches pour 3 cartes équivalentes)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random();

// joueurs occupés (défi ou combat en cours) : "guildId:userId" -> battleId
const occupes = new Map();
const cle = (gid, uid) => `${gid}:${uid}`;
const estOccupe = (gid, uid) => occupes.has(cle(gid, uid));

// ── Images des cartes (cache mémoire) ───────────────────────────────────
const cacheImages = new Map(); // itemId -> url | null
function prechargerImage(itemId, item) {
  if (cacheImages.has(itemId)) return Promise.resolve(cacheImages.get(itemId));
  return getCardImage(item)
    .then(r => { cacheImages.set(itemId, r?.url || null); return r?.url || null; })
    .catch(() => null);
}
const imageAvecDelai = (itemId, item, ms = 3500) =>
  Promise.race([prechargerImage(itemId, item), sleep(ms).then(() => null)]);

// ── Construction des combattants ────────────────────────────────────────
function creerCombattant(item) {
  const s = cg.statsCarte(item);
  return {
    itemId: item.id,
    item,
    name: item.name.replace(/^Carte\s+/i, ''),
    emoji: item.emoji,
    rarity: item.rarity,
    maxHp: s.pv,
    hp: s.pv,
    atk: s.atk,
    def: s.def,
    vit: s.vit,
    special: s.special,
    cd: 0,
  };
}

function equipeAuto(gid, uid) {
  return cg.cartesPossedees(gid, uid).slice(0, TAILLE_EQUIPE).map(e => e.item); // les plus fortes
}

const actif = j => j.team[j.active];
const vivants = j => j.team.filter(c => c.hp > 0);
const autre = (b, j) => b.players[0] === j ? b.players[1] : b.players[0];

function barre(hp, max, n = 8) {
  const plein = Math.max(0, Math.min(n, Math.round((hp / max) * n)));
  return '▰'.repeat(plein) + '▱'.repeat(n - plein);
}

// ── Rendu Components V2 ─────────────────────────────────────────────────
function lignesEquipe(j) {
  return j.team.map((c, i) => {
    const rare = getRarity(c.rarity).emoji;
    if (c.hp <= 0) return `💀 ~~${c.name}~~`;
    const fleche = i === j.active ? '▶️' : '▫️';
    const det = i === j.active ? ` • ⚔️${c.atk} 🛡️${c.def} 💨${c.vit}` : '';
    return `${fleche} ${rare} **${c.name}** ${barre(c.hp, c.maxHp)} ${c.hp}/${c.maxHp}${det}`;
  }).join('\n');
}

function payloadCombat(b, { final = null } = {}) {
  const [A, B] = b.players;
  const embed = new EmbedBuilder().setColor(COULEUR);
  if (final) {
    embed.setTitle(`🏆 ${final.titre}`).setDescription(final.description);
  } else {
    const mise = b.mise > 0 ? `💰 Mise : **${cg.fmt(b.guildId, b.mise)}** par joueur • ` : '';
    embed.setTitle(`⚔️ ${A.name}  VS  ${B.name}`)
      .setDescription(`${mise}Manche **${b.round}**/${MANCHES_MAX}\n⏳ Choisissez votre action (secrète) : <t:${Math.floor(b.finManche / 1000)}:R>`);
  }
  embed.addFields(
    { name: `${A.pret && !final ? '✅' : (final ? '' : '⌛')} ${A.name}`.trim(), value: lignesEquipe(A) },
    { name: `${B.pret && !final ? '✅' : (final ? '' : '⌛')} ${B.name}`.trim(), value: lignesEquipe(B) },
  );
  if (b.log.length) embed.addFields({ name: '📜 Dernière manche', value: b.log.join('\n').slice(0, 1000) });

  const container = containerFromEmbed(embed);
  const imgs = [A, B]
    .map(j => cacheImages.get(actif(j).itemId))
    .filter(Boolean);
  if (imgs.length) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(...imgs.map(u => new MediaGalleryItemBuilder().setURL(u)))
    );
  }

  const components = [container];
  if (!final) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cb_atk').setLabel('Attaque').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cb_spe').setLabel('Spécial').setEmoji('💥').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cb_def').setLabel('Garde').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cb_swap').setLabel('Changer').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cb_ff').setLabel('Abandon').setEmoji('🏳️').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: PAS_DE_PING };
}

// ── Commande : /poke-fight challenge ───────────────────────────────────────────
async function lancerDefi(interaction) {
  const gid = interaction.guild.id;
  const auteur = interaction.user;
  const cible = interaction.options.getUser('membre', true);
  const mise = interaction.options.getInteger('mise') || 0;
  const refus = txt => interaction.reply({ content: txt, flags: EPH });

  if (cible.bot) return refus('❌ Les bots ne savent pas se battre (enfin… pas avec des cartes).');
  if (cible.id === auteur.id) return refus('❌ Tu ne peux pas te défier toi-même.');
  if (mise > 0 && !cg.ecoActive(gid)) return refus('❌ L\'économie est désactivée sur ce serveur : combats sans mise uniquement.');
  if (estOccupe(gid, auteur.id)) return refus('❌ Tu as déjà un défi ou un combat en cours.');
  if (estOccupe(gid, cible.id)) return refus(`❌ **${cible.username}** a déjà un défi ou un combat en cours.`);
  if (!cg.cartesPossedees(gid, auteur.id).length) return refus('📭 Tu n\'as aucune carte. Tente ta chance avec `/poke-wheel` !');
  if (!cg.cartesPossedees(gid, cible.id).length) return refus(`📭 **${cible.username}** n'a aucune carte à engager.`);
  if (mise > 0) {
    if (cg.solde(gid, auteur.id) < mise) return refus(`❌ Solde insuffisant pour miser **${cg.fmt(gid, mise)}**.`);
    if (cg.solde(gid, cible.id) < mise) return refus(`❌ **${cible.username}** n'a pas assez pour miser **${cg.fmt(gid, mise)}**.`);
  }

  const id = `${Date.now().toString(36)}${Math.floor(rnd() * 1e4)}`;
  occupes.set(cle(gid, auteur.id), id);
  occupes.set(cle(gid, cible.id), id);
  const liberer = () => { occupes.delete(cle(gid, auteur.id)); occupes.delete(cle(gid, cible.id)); };

  const b = {
    id, guildId: gid, mise, round: 1, log: [], over: false, resolving: false,
    players: [auteur, cible].map(u => ({
      id: u.id,
      name: u.globalName || u.username,
      mention: `<@${u.id}>`,
      team: null, active: 0, action: null, afk: 0, lastGuard: false, guard: 1, pret: false,
    })),
  };

  const ligneMise = mise > 0 ? `\n💰 Mise : **${cg.fmt(gid, mise)}** chacun — le vainqueur remporte **${cg.fmt(gid, mise * 2)}**` : '\n🎴 Sans mise : pour l\'honneur (et le classement) !';
  const embedDefi = new EmbedBuilder().setColor(COULEUR)
    .setTitle('⚔️ Défi de combat de cartes')
    .setDescription(`${auteur} défie ${cible} !${ligneMise}\n\n${cible}, acceptes-tu ? <t:${Math.floor((Date.now() + DELAI_DEFI) / 1000)}:R>`);
  const ligneDefi = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cbd_ok').setLabel('Accepter').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cbd_no').setLabel('Refuser').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );
  await interaction.reply(await glassPayload({ embeds: [embedDefi], components: [ligneDefi], allowedMentions: { users: [cible.id] } },
    { guild: interaction.guild, client: interaction.client, badge: 'POKÉ-FIGHT', versus: [auteur, cible], versusIcon: '⚔️' }));
  const msg = await interaction.fetchReply();

  const col = msg.createMessageComponentCollector({ time: DELAI_DEFI });
  let decision = null;
  col.on('collect', async i => {
    const estCible = i.user.id === cible.id;
    const estAuteur = i.user.id === auteur.id;
    if (!estCible && !estAuteur) return i.reply({ content: '❌ Ce défi ne te concerne pas.', flags: EPH }).catch(() => { });
    if (i.customId === 'cbd_ok' && !estCible) return i.reply({ content: '⏳ C\'est à l\'adversaire d\'accepter.', flags: EPH }).catch(() => { });
    decision = i.customId === 'cbd_ok' ? 'ok' : 'no';
    await i.deferUpdate().catch(() => { });
    col.stop('decision');
  });
  col.on('end', async () => {
    if (decision === 'ok') return phaseEquipes(msg, b, liberer).catch(e => { liberer(); console.error('[Combat] équipes :', e); });
    liberer();
    const e = new EmbedBuilder().setColor(COULEUR).setTitle('⚔️ Défi de combat de cartes')
      .setDescription(decision === 'no' ? `✖️ Le défi a été refusé ou annulé.` : `⌛ ${cible} n'a pas répondu : défi expiré.`);
    msg.edit(await glassPayload({ embeds: [e], components: [] },
      { guild: msg.guild, client: msg.client, badge: 'POKÉ-FIGHT', versus: [auteur, cible], versusIcon: decision === 'no' ? '✖️' : '⌛', update: true })).catch(() => { });
  });
}

// ── Phase 2 : choix des équipes ─────────────────────────────────────────
async function phaseEquipes(msg, b, liberer) {
  const gid = b.guildId;
  const fin = Date.now() + DELAI_EQUIPE;

  const rendu = () => {
    const e = new EmbedBuilder().setColor(COULEUR)
      .setTitle('🎴 Choisissez votre équipe')
      .setDescription(
        `Chaque joueur choisit jusqu'à **${TAILLE_EQUIPE} cartes** de sa collection.\n\n` +
        b.players.map(p => `${p.pret ? '✅' : '⌛'} ${p.mention}${p.pret ? ` — ${p.team.map(c => c.name).join(', ')}` : ''}`).join('\n') +
        `\n\n⏳ Fin du délai : <t:${Math.floor(fin / 1000)}:R>`);
    const ligne = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cbt_pick').setLabel('Choisir mes cartes').setEmoji('🎴').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cbt_auto').setLabel('Équipe auto').setEmoji('⚡').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cbt_cancel').setLabel('Annuler').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    );
    return toCV2Payload({ embeds: [e], components: [ligne], allowedMentions: PAS_DE_PING });
  };
  await msg.edit(rendu()).catch(() => { });

  const col = msg.createMessageComponentCollector({ time: DELAI_EQUIPE });
  let annule = false;

  const valider = (joueur, items) => {
    joueur.team = items.slice(0, TAILLE_EQUIPE).map(creerCombattant);
    joueur.pret = true;
    msg.edit(rendu()).catch(() => { });
    if (b.players.every(p => p.pret)) col.stop('prets');
  };

  col.on('collect', async i => {
    const j = b.players.find(p => p.id === i.user.id);
    if (!j) return i.reply({ content: '❌ Ce combat ne te concerne pas.', flags: EPH }).catch(() => { });
    if (i.customId === 'cbt_cancel') { annule = true; await i.deferUpdate().catch(() => { }); return col.stop('cancel'); }
    if (i.customId === 'cbt_auto') {
      const items = equipeAuto(gid, j.id);
      if (!items.length) return i.reply({ content: '📭 Tu n\'as plus aucune carte.', flags: EPH }).catch(() => { });
      await i.reply({ content: `⚡ Équipe auto : ${items.map(c => `${c.emoji} **${c.name}**`).join(', ')}`, flags: EPH }).catch(() => { });
      return valider(j, items);
    }
    if (i.customId === 'cbt_pick') {
      return ouvrirSelecteur(i, gid, j, items => valider(j, items));
    }
  });

  col.on('end', async () => {
    if (b.players.every(p => p.pret)) return demarrerCombat(msg, b, liberer).catch(e => { b.liberer?.(); liberer(); console.error('[Combat] démarrage :', e); });
    liberer();
    const e = new EmbedBuilder().setColor(COULEUR).setTitle('🎴 Combat annulé')
      .setDescription(annule ? '✖️ Le combat a été annulé.' : '⌛ Équipes non validées à temps : combat annulé.');
    msg.edit(toCV2Payload({ embeds: [e], components: [] })).catch(() => { });
  });
}

// Sélecteur de cartes paginé (message éphémère) ; cartes cumulées sur plusieurs pages
async function ouvrirSelecteur(i, gid, joueur, onValide) {
  const owned = cg.cartesPossedees(gid, joueur.id);
  if (!owned.length) return i.reply({ content: '📭 Tu n\'as plus aucune carte.', flags: EPH }).catch(() => { });
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(owned.length / PAGE));
  let page = 0;
  let choisies = [];

  const rendu = (eph = false) => {
    const debut = page * PAGE;
    const sur = owned.slice(debut, debut + PAGE);
    const menu = new StringSelectMenuBuilder()
      .setCustomId('cbp_sel')
      .setPlaceholder(`Cartes (page ${page + 1}/${pages}) — jusqu'à ${TAILLE_EQUIPE} au total`)
      .setMinValues(0)
      .setMaxValues(Math.min(TAILLE_EQUIPE, sur.length))
      .addOptions(sur.map(({ item, count }) => {
        const s = cg.statsCarte(item);
        return {
          label: `${item.name.replace(/^Carte\s+/i, '')}${count > 1 ? ` ×${count}` : ''}`.slice(0, 100),
          value: item.id,
          description: `${getRarity(item.rarity).label} • PV ${s.pv} ATK ${s.atk} DEF ${s.def} VIT ${s.vit}`.slice(0, 100),
          default: choisies.includes(item.id),
        };
      }));
    const e = new EmbedBuilder().setColor(COULEUR)
      .setTitle('🎴 Ton équipe')
      .setDescription(
        choisies.length
          ? choisies.map((id, k) => { const it = owned.find(o => o.item.id === id).item; const s = cg.statsCarte(it); return `**${k + 1}.** ${getRarity(it.rarity).emoji} **${it.name.replace(/^Carte\s+/i, '')}** — PV ${s.pv} • ATK ${s.atk} • DEF ${s.def} • VIT ${s.vit} • 💥 ${s.special}`; }).join('\n')
          : 'Aucune carte choisie pour l\'instant.')
      .setFooter({ text: `Page ${page + 1}/${pages} • ${owned.length} carte(s) • la 1re carte entre en jeu en premier` });
    return toCV2Payload({
      embeds: [e],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cbp_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('cbp_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
          new ButtonBuilder().setCustomId('cbp_ok').setLabel('Valider').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!choisies.length),
        ),
      ],
      ephemeral: eph,
    });
  };

  await i.reply(rendu(true));
  const m = await i.fetchReply();
  const col = m.createMessageComponentCollector({ time: DELAI_EQUIPE, filter: x => x.user.id === joueur.id });
  col.on('collect', async x => {
    if (x.customId === 'cbp_prev') page = Math.max(0, page - 1);
    else if (x.customId === 'cbp_next') page = Math.min(pages - 1, page + 1);
    else if (x.customId === 'cbp_sel') {
      const surPage = owned.slice(page * PAGE, page * PAGE + PAGE).map(o => o.item.id);
      choisies = [...choisies.filter(id => !surPage.includes(id)), ...x.values].slice(-TAILLE_EQUIPE);
    } else if (x.customId === 'cbp_ok') {
      if (!choisies.length) return x.deferUpdate().catch(() => { });
      const items = choisies.map(id => owned.find(o => o.item.id === id)?.item).filter(Boolean);
      await x.update(toCV2Payload({
        embeds: [new EmbedBuilder().setColor(COULEUR).setTitle('✅ Équipe validée').setDescription(items.map(it => `${it.emoji} **${it.name.replace(/^Carte\s+/i, '')}**`).join('\n'))],
        components: [],
      })).catch(() => { });
      col.stop('ok');
      return onValide(items);
    }
    await x.update(rendu()).catch(() => { });
  });
}

// ── Phase 3 : le combat ─────────────────────────────────────────────────
async function demarrerCombat(msg, b, liberer) {
  const gid = b.guildId;
  const [A, B] = b.players;

  // Vérifie que les joueurs possèdent toujours leurs cartes (elles ont pu être vendues entre-temps)
  for (const p of b.players) {
    const manquantes = p.team.filter(c => cg.nbCartes(gid, p.id, c.itemId) < 1);
    if (manquantes.length) {
      liberer();
      const e = new EmbedBuilder().setColor(COULEUR).setTitle('❌ Combat annulé')
        .setDescription(`${p.mention} ne possède plus **${manquantes.map(c => c.name).join(', ')}** (vendue ou échangée entre-temps).`);
      return msg.edit(toCV2Payload({ embeds: [e], components: [], allowedMentions: PAS_DE_PING })).catch(() => { });
    }
  }

  // Séquestre des mises
  if (b.mise > 0) {
    const okA = cg.debiter(gid, A.id, b.mise);
    const okB = okA && cg.debiter(gid, B.id, b.mise);
    if (!okA || !okB) {
      if (okA) cg.crediter(gid, A.id, b.mise);
      cg.sauverEco();
      liberer();
      const e = new EmbedBuilder().setColor(COULEUR).setTitle('❌ Combat annulé')
        .setDescription('Un des joueurs n\'a plus assez de fonds pour la mise.');
      return msg.edit(toCV2Payload({ embeds: [e], components: [] })).catch(() => { });
    }
    cg.sauverEco();
    cg.combat.escrow[b.id] = { guildId: gid, players: [A.id, B.id], mise: b.mise };
    await cg.sauverCombatMaintenant();
  }

  b.players.forEach(p => { p.pret = false; });
  b.msg = msg;
  b.liberer = liberer;
  b.timer = null;
  b.finManche = Date.now() + DELAI_MANCHE;

  // images des cartes (en parallèle, sans bloquer plus de ~3,5 s)
  const toutes = [...A.team, ...B.team];
  toutes.forEach(c => prechargerImage(c.itemId, c.item));
  await Promise.all([actif(A), actif(B)].map(c => imageAvecDelai(c.itemId, c.item)));

  b.col = msg.createMessageComponentCollector({ time: (MANCHES_MAX + 2) * DELAI_MANCHE });
  b.col.on('collect', i => gererBouton(b, i).catch(e => console.error('[Combat] bouton :', e)));

  await editer(b, payloadCombat(b));
  armerTimer(b);
}

function armerTimer(b) {
  clearTimeout(b.timer);
  b.timer = setTimeout(() => resoudreManche(b).catch(e => console.error('[Combat] manche :', e)), DELAI_MANCHE);
  b.timer.unref?.();
}

async function editer(b, payload) {
  try {
    await b.msg.edit(payload);
  } catch (e) {
    if (e?.code === 10008 || e?.code === 10003 || e?.code === 50001) {
      // message supprimé / salon inaccessible : on rembourse et on arrête
      await terminer(b, { egalite: true, raison: 'Message de combat introuvable.' });
    } else {
      console.error('[Combat] édition :', e.message);
    }
  }
}

async function gererBouton(b, i) {
  const j = b.players.find(p => p.id === i.user.id);
  if (!j) return i.reply({ content: '❌ Tu ne participes pas à ce combat.', flags: EPH }).catch(() => { });
  if (b.over) return i.reply({ content: '🏁 Ce combat est terminé.', flags: EPH }).catch(() => { });
  if (b.resolving) return i.reply({ content: '⏳ La manche est en cours de résolution…', flags: EPH }).catch(() => { });
  const c = actif(j);
  const manche = b.round;

  if (i.customId === 'cb_atk') {
    j.action = { type: 'atk' };
    await i.reply({ content: `⚔️ **${c.name}** attaquera cette manche.`, flags: EPH }).catch(() => { });
  } else if (i.customId === 'cb_spe') {
    if (c.cd > 0) return i.reply({ content: `💥 **${c.special}** n'est pas prêt : encore **${c.cd}** manche(s).`, flags: EPH }).catch(() => { });
    j.action = { type: 'spe' };
    await i.reply({ content: `💥 **${c.name}** utilisera **${c.special}** (×1,8 dégâts, 90 % de précision).`, flags: EPH }).catch(() => { });
  } else if (i.customId === 'cb_def') {
    j.action = { type: 'def' };
    await i.reply({ content: j.lastGuard
      ? '🛡️ Garde (affaiblie : tu as gardé la manche précédente, −25 % de dégâts seulement).'
      : '🛡️ Garde : −60 % de dégâts subis et +5 % de PV récupérés.', flags: EPH }).catch(() => { });
  } else if (i.customId === 'cb_swap') {
    const bancs = j.team.map((x, k) => ({ x, k })).filter(({ x, k }) => x.hp > 0 && k !== j.active);
    if (!bancs.length) return i.reply({ content: '❌ Aucune autre carte en forme sur ton banc.', flags: EPH }).catch(() => { });
    await i.reply({
      content: '🔄 Quelle carte envoyer au combat ?',
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('cb_swap_sel').setPlaceholder('Choisis une carte')
          .addOptions(bancs.map(({ x, k }) => ({ label: x.name.slice(0, 100), value: String(k), description: `PV ${x.hp}/${x.maxHp} • ATK ${x.atk} DEF ${x.def} VIT ${x.vit}`.slice(0, 100) })))
      )],
      flags: EPH,
    }).catch(() => { });
    const rep = await i.fetchReply().catch(() => null);
    const r = await rep?.awaitMessageComponent({ time: 30_000, filter: x => x.user.id === j.id }).catch(() => null);
    if (!r) return;
    if (b.over || b.resolving || b.round !== manche) return r.update({ content: '⌛ Trop tard : la manche a déjà été jouée.', components: [] }).catch(() => { });
    j.action = { type: 'swap', to: Number(r.values[0]) };
    await r.update({ content: `🔄 **${j.team[j.action.to].name}** entrera en jeu cette manche.`, components: [] }).catch(() => { });
  } else if (i.customId === 'cb_ff') {
    await i.reply({
      content: '🏳️ Abandonner le combat ? Ton adversaire remportera la mise.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cb_ff_ok').setLabel('Oui, abandonner').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cb_ff_no').setLabel('Non').setStyle(ButtonStyle.Secondary),
      )],
      flags: EPH,
    }).catch(() => { });
    const rep = await i.fetchReply().catch(() => null);
    const r = await rep?.awaitMessageComponent({ time: 15_000, filter: x => x.user.id === j.id }).catch(() => null);
    if (!r) return;
    if (r.customId === 'cb_ff_ok' && !b.over) {
      await r.update({ content: '🏳️ Tu as abandonné.', components: [] }).catch(() => { });
      return terminer(b, { gagnant: autre(b, j), raison: `${j.name} a abandonné.` });
    }
    return r.update({ content: '👍 Le combat continue !', components: [] }).catch(() => { });
  } else {
    return;
  }

  // l'action vient d'être choisie : on regarde si la manche peut être résolue
  j.pret = true;
  if (b.players.every(p => p.action)) {
    await resoudreManche(b);
  } else if (!b.over) {
    await editer(b, payloadCombat(b)); // coche ✅ à côté du joueur prêt
  }
}

// ── Résolution d'une manche ─────────────────────────────────────────────
function degats(att, def, special) {
  const c = actif(att), t = actif(def);
  const touche = rnd() < (special ? 0.9 : 0.97);
  if (!touche) return { touche: false };
  const crit = rnd() < 0.1;
  const brut = c.atk * (special ? 1.8 : 1) * (crit ? 1.5 : 1) * (0.85 + rnd() * 0.3) * (60 / (60 + t.def)) * FACTEUR_DEGATS;
  const dmg = Math.max(1, Math.round(brut * def.guard));
  return { touche: true, dmg, crit };
}

async function resoudreManche(b) {
  if (b.over || b.resolving) return;
  b.resolving = true;
  clearTimeout(b.timer);
  const log = [];
  const [A, B] = b.players;

  // joueurs inactifs : attaque automatique, 2 manches d'affilée = forfait
  for (const p of b.players) {
    if (!p.action) {
      p.afk++;
      p.action = { type: 'atk', auto: true };
      log.push(`💤 ${p.name} n'a pas joué : attaque automatique.`);
    } else if (!p.action.auto) p.afk = 0;
  }
  if (A.afk >= 2 && B.afk >= 2) {
    b.resolving = false;
    return terminer(b, { egalite: true, raison: 'Les deux joueurs sont restés inactifs.' });
  }
  for (const p of b.players) {
    if (p.afk >= 2) {
      b.resolving = false;
      return terminer(b, { gagnant: autre(b, p), raison: `${p.name} est resté inactif : forfait.` });
    }
  }

  // 1) changements de carte
  for (const p of b.players) {
    if (p.action.type === 'swap' && p.team[p.action.to]?.hp > 0) {
      p.active = p.action.to;
      log.push(`🔄 ${p.name} envoie **${actif(p).name}** !`);
      prechargerImage(actif(p).itemId, actif(p).item);
    }
  }
  // 2) gardes
  for (const p of b.players) {
    p.guard = 1;
    if (p.action.type === 'def') {
      const c = actif(p);
      if (p.lastGuard) {
        p.guard = 0.75;
        log.push(`🛡️ **${c.name}** se protège (garde affaiblie).`);
      } else {
        p.guard = 0.4;
        const soin = Math.min(c.maxHp - c.hp, Math.ceil(c.maxHp * 0.05));
        c.hp += soin;
        log.push(`🛡️ **${c.name}** se met en garde${soin ? ` (+${soin} PV)` : ''}.`);
      }
    }
    p.lastGuard = p.action.type === 'def';
  }
  // 3) attaques, la carte la plus rapide d'abord
  const attaquants = b.players
    .filter(p => p.action.type === 'atk' || p.action.type === 'spe')
    .map(p => ({ p, v: actif(p).vit + rnd() * 2 }))
    .sort((x, y) => y.v - x.v)
    .map(x => x.p);
  let gagnant = null;
  for (const att of attaquants) {
    const def = autre(b, att);
    const c = actif(att), t = actif(def);
    if (c.hp <= 0) continue; // mise K.O. avant d'avoir pu agir
    const special = att.action.type === 'spe';
    if (special) c.cd = RECHARGE_SPECIAL;
    const r = degats(att, def, special);
    const nom = special ? `💥 **${c.name}** lance **${c.special}**` : `⚔️ **${c.name}** attaque`;
    if (!r.touche) { log.push(`${nom}… mais **${t.name}** esquive !`); continue; }
    t.hp = Math.max(0, t.hp - r.dmg);
    log.push(`${nom} : **${t.name}** −${r.dmg} PV${r.crit ? ' 🎯 critique !' : ''}${def.guard < 1 ? ' 🛡️' : ''}`);
    if (t.hp <= 0) {
      log.push(`💀 **${t.name}** est K.O. !`);
      if (!vivants(def).length) { gagnant = att; break; }
    }
  }

  // remplacement automatique des K.O. (carte suivante en forme)
  if (!gagnant) {
    for (const p of b.players) {
      if (actif(p).hp <= 0) {
        const k = p.team.findIndex(x => x.hp > 0);
        if (k >= 0) {
          p.active = k;
          log.push(`➡️ ${p.name} envoie **${actif(p).name}** !`);
          prechargerImage(actif(p).itemId, actif(p).item);
        }
      }
    }
  }

  // fin de manche
  b.log = log;
  for (const p of b.players) { p.action = null; p.pret = false; p.team.forEach(c => { if (c.cd > 0) c.cd--; }); }

  if (gagnant) { b.resolving = false; return terminer(b, { gagnant, raison: 'Toutes les cartes adverses sont K.O.' }); }

  b.round++;
  if (b.round > MANCHES_MAX) {
    b.resolving = false;
    const pct = p => p.team.reduce((s, c) => s + c.hp, 0) / p.team.reduce((s, c) => s + c.maxHp, 0);
    const pa = pct(A), pb = pct(B);
    if (Math.abs(pa - pb) < 0.005) return terminer(b, { egalite: true, raison: `Limite de ${MANCHES_MAX} manches atteinte : égalité parfaite.` });
    return terminer(b, { gagnant: pa > pb ? A : B, raison: `Limite de ${MANCHES_MAX} manches : victoire aux points (PV restants).` });
  }

  b.finManche = Date.now() + DELAI_MANCHE;
  await Promise.all(b.players.map(p => imageAvecDelai(actif(p).itemId, actif(p).item, 1500)));
  b.resolving = false;
  await editer(b, payloadCombat(b));
  armerTimer(b);
}

// ── Fin de combat : versement, classement, message final ────────────────
async function terminer(b, { gagnant = null, egalite = false, raison = '' }) {
  if (b.over) return;
  b.over = true;
  clearTimeout(b.timer);
  try { b.col?.stop('fin'); } catch { /* déjà arrêté */ }
  const gid = b.guildId;
  const [A, B] = b.players;
  const g = egalite ? null : gagnant;

  if (b.mise > 0) {
    if (g) cg.crediter(gid, g.id, b.mise * 2);
    else { cg.crediter(gid, A.id, b.mise); cg.crediter(gid, B.id, b.mise); }
    cg.sauverEco();
    delete cg.combat.escrow[b.id];
    cg.sauverCombat();
  }
  const deltas = cg.enregistrerResultat(gid, A.id, B.id, g ? g.id : null);
  if (g && b.mise > 0) cg.joueurCombat(gid, g.id).gains += b.mise;
  b.liberer?.();

  const fmtDelta = d => `${d >= 0 ? '+' : ''}${d}`;
  const ra = cg.joueurCombat(gid, A.id).rating, rb = cg.joueurCombat(gid, B.id).rating;
  const description = g
    ? `🎉 ${g.mention} remporte le combat !\n*${raison}*${b.mise > 0 ? `\n\n💰 Gain : **${cg.fmt(gid, b.mise * 2)}** (mise de ${cg.fmt(gid, b.mise)} incluse)` : ''}\n\n📈 Classement : ${A.name} **${ra}** (${fmtDelta(deltas[A.id])}) • ${B.name} **${rb}** (${fmtDelta(deltas[B.id])})`
    : `🤝 Égalité !\n*${raison}*${b.mise > 0 ? '\n\n💰 Les mises ont été remboursées.' : ''}`;
  const payload = payloadCombat(b, { final: { titre: g ? `${g.name} gagne !` : 'Égalité', description } });
  try { await b.msg.edit(payload); } catch (e) { console.error('[Combat] message final :', e.message); }
}

// ── Récupération après crash : rembourse les mises restées en séquestre ──
function startCombat() {
  const restes = Object.entries(cg.combat.escrow || {});
  if (!restes.length) return;
  for (const [id, e] of restes) {
    for (const uid of e.players || []) cg.crediter(e.guildId, uid, e.mise);
    delete cg.combat.escrow[id];
  }
  cg.sauverEco();
  cg.sauverCombat();
  console.log(`[Combat] ${restes.length} mise(s) en séquestre remboursée(s) après redémarrage.`);
}

// ── Stats / classement ──────────────────────────────────────────────────
function embedStats(guild, user) {
  const s = cg.joueurCombat(guild.id, user.id);
  const total = s.wins + s.losses + s.draws;
  const taux = total ? Math.round((s.wins / total) * 100) : 0;
  const cartes = cg.cartesPossedees(guild.id, user.id);
  const top = cartes.slice(0, 3).map(({ item }) => `${item.emoji} ${item.name.replace(/^Carte\s+/i, '')}`).join(' • ') || '—';
  return new EmbedBuilder().setColor(COULEUR)
    .setTitle(`⚔️ Combats de ${user.globalName || user.username}`)
    .setDescription(
      `🏅 Classement : **${s.rating}**\n` +
      `✅ Victoires : **${s.wins}** • ❌ Défaites : **${s.losses}** • 🤝 Égalités : **${s.draws}**\n` +
      `📊 Taux de victoire : **${taux} %** (${total} combat${total > 1 ? 's' : ''})\n` +
      `🔥 Série : **${s.streak}** (record : ${s.best})\n` +
      (s.gains > 0 ? `💰 Gains de mises : **${cg.fmt(guild.id, s.gains)}**\n` : '') +
      `🃏 Meilleures cartes : ${top}`);
}

function embedClassement(guild) {
  const top = cg.classementCombat(guild.id).slice(0, 10);
  const medailles = ['🥇', '🥈', '🥉'];
  return new EmbedBuilder().setColor(COULEUR)
    .setTitle('🏆 Classement des combats de cartes')
    .setDescription(top.length
      ? top.map((s, k) => `${medailles[k] || `**${k + 1}.**`} <@${s.id}> — **${s.rating}** pts • ${s.wins}V/${s.losses}D/${s.draws}N`).join('\n')
      : 'Aucun combat joué pour l\'instant. Lance `/poke-fight challenge` !');
}

function embedRegles() {
  return new EmbedBuilder().setColor(COULEUR)
    .setTitle('📖 Règles des combats de cartes')
    .setDescription(
      `**Équipe** : jusqu'à ${TAILLE_EQUIPE} cartes de ta collection (\`/poke-wheel\`). Les stats dépendent de la rareté (PV, ATK, DEF, VIT) et sont fixes pour chaque Pokémon.\n\n` +
      `**Chaque manche**, les deux joueurs choisissent **en secret** :\n` +
      `⚔️ **Attaque** — dégâts normaux\n` +
      `💥 **Spécial** — ×1,8 dégâts, 90 % de précision, rechargement ${RECHARGE_SPECIAL} manches\n` +
      `🛡️ **Garde** — −60 % de dégâts subis, +5 % PV (affaiblie si utilisée 2 manches de suite)\n` +
      `🔄 **Changer** — envoie une autre carte (elle encaisse les coups de la manche)\n\n` +
      `La carte la plus **rapide** frappe en premier. 10 % de coups critiques (×1,5).\n` +
      `Le combat s'arrête quand une équipe est entièrement K.O., à l'abandon, après 2 manches d'inactivité ou après ${MANCHES_MAX} manches (victoire aux PV restants).\n\n` +
      `**Mise** (optionnelle, jusqu'à ${MISE_MAX.toLocaleString('fr-FR')}) : mise en séquestre au début, versée au vainqueur, remboursée en cas d'égalité.\n` +
      `🃏 **Tes cartes ne sont jamais perdues.** Le classement utilise un score Elo (départ : 1000).`);
}

module.exports = { lancerDefi, startCombat, embedStats, embedClassement, embedRegles, MISE_MAX };
