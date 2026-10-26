'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Marché & enchères entre membres (/market)
//
//  - vente à prix fixe (annonce valable 7 jours) ou enchère (1 h à 72 h)
//  - la carte est mise en séquestre à la création de l'annonce (retirée de
//    la collection du vendeur) ; l'argent des enchérisseurs aussi
//  - quand quelqu'un est surenchéri, il est remboursé immédiatement
//  - anti-sniping : une enchère dans les 2 dernières minutes prolonge de 2 min
//  - frais de vente de 5 % retenus sur le prix reçu par le vendeur
//  - les boutons sont permanents (routés par `mkt_`), les annonces survivent
//    aux redémarrages ; un minuteur clôture les enchères terminées
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const cg = require('../core/cardGame');
const { getItem, getRarity } = require('../core/collectionItems');
const { getCardImage } = require('../core/pokemonCards');
const { toCV2Payload } = require('../core/componentsV2');
const { glassPayload } = require('../core/glassEmbed');

const COULEUR = 0xFFFFFF;
const EPH = MessageFlags.Ephemeral;
const PAS_DE_PING = { parse: [] };

const FRAIS_PCT = 5;
const MAX_ANNONCES = 5;
const PRIX_MAX = 10_000_000;
const DUREE_FIXE_MS = 7 * 24 * 3600 * 1000;
const ANTI_SNIPE_MS = 2 * 60 * 1000;
const ANTI_SNIPE_MAX = 5;
const SURENCHERE_PCT = 5;
const PAR_PAGE = 8;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nom = item => item.name.replace(/^Carte\s+/i, '');
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const frais = prix => Math.floor(prix * FRAIS_PCT / 100);
const lien = (gid, l) => `https://discord.com/channels/${gid}/${l.channelId}/${l.messageId}`;
const ts = ms => Math.floor(ms / 1000);


// Répond (ou modifie la réponse si le filet de sécurité d'index.js a déjà « defer » l'interaction)
function rep(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const p = { ...payload };
    if (p.flags !== undefined) p.flags &= ~EPH;
    return interaction.editReply(p);
  }
  return interaction.reply(payload);
}

function annonce(gid, id) { return cg.marche(gid).listings[String(id)] || null; }
function annoncesActives(gid) { return Object.values(cg.marche(gid).listings); }
function compteVendeur(gid, uid) { return annoncesActives(gid).filter(l => l.sellerId === uid).length; }

function prixMinimum(l) {
  if (l.bidderId) return l.bid + Math.max(1, Math.ceil(l.bid * SURENCHERE_PCT / 100));
  return l.start;
}

function sauver() { cg.sauverEco(); cg.sauverMarche(); }

// ── Rendu ───────────────────────────────────────────────────────────────
function statsLigne(item) {
  const s = cg.statsCarte(item);
  return `❤️ ${s.pv} • ⚔️ ${s.atk} • 🛡️ ${s.def} • 💨 ${s.vit} • 💥 ${s.special}`;
}

function embedAnnonce(gid, l, final = null) {
  const item = getItem(l.itemId);
  const rar = getRarity(item?.rarity);
  const e = new EmbedBuilder().setColor(COULEUR);
  const ico = cg.emoji(gid);
  const titre = item ? `${item.emoji} ${nom(item)}` : l.itemId;

  if (final) {
    e.setTitle(`${final.emoji} ${titre} — ${final.titre}`).setDescription(final.texte);
  } else if (l.type === 'fixe') {
    e.setTitle(`🏷️ ${titre} — À vendre`)
      .setDescription(`${rar.emoji} **${rar.label}** • ${item ? statsLigne(item) : ''}\n\n` +
        `💰 Prix : **${cg.fmt(gid, l.price)}**\n👤 Vendeur : <@${l.sellerId}>\n⏳ Expire : <t:${ts(l.endsAt)}:R>`);
  } else {
    e.setTitle(`🔨 ${titre} — Enchère`)
      .setDescription(`${rar.emoji} **${rar.label}** • ${item ? statsLigne(item) : ''}\n\n` +
        `🏁 Départ : **${cg.fmt(gid, l.start)}**\n` +
        `📈 Enchère actuelle : ${l.bidderId ? `**${cg.fmt(gid, l.bid)}** par <@${l.bidderId}> (${l.bids} offre${l.bids > 1 ? 's' : ''})` : '*aucune offre*'}\n` +
        `💡 Prochaine mise minimale : **${cg.fmt(gid, prixMinimum(l))}**\n` +
        (l.buyout ? `⚡ Achat immédiat : **${cg.fmt(gid, l.buyout)}**\n` : '') +
        `👤 Vendeur : <@${l.sellerId}>\n⏳ Fin : <t:${ts(l.endsAt)}:R>` +
        (l.extended ? `\n🕑 Prolongée ${l.extended}× (anti-sniping)` : ''));
  }
  if (l.image) e.setThumbnail(l.image);
  e.setFooter({ text: `Annonce #${l.id} • frais de vente ${FRAIS_PCT} % payés par le vendeur` });
  void ico;
  return e;
}

function boutons(gid, l) {
  const ico = cg.emoji(gid);
  if (l.type === 'fixe') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mkt_buy_${l.id}`).setLabel(`Acheter — ${l.price.toLocaleString('fr-FR')} ${ico}`).setEmoji('🛒').setStyle(ButtonStyle.Success),
    )];
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mkt_min_${l.id}`).setLabel(`Enchérir — ${prixMinimum(l).toLocaleString('fr-FR')} ${ico}`).setEmoji('💰').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mkt_bid_${l.id}`).setLabel('Autre montant').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  );
  if (l.buyout) {
    row.addComponents(new ButtonBuilder().setCustomId(`mkt_now_${l.id}`).setLabel(`Achat immédiat — ${l.buyout.toLocaleString('fr-FR')} ${ico}`).setEmoji('⚡').setStyle(ButtonStyle.Success));
  }
  return [row];
}

// Annonces en cartes « verre fumé » (async : rendu image). edit = true quand on modifie un message existant.
const payloadAnnonce = (gid, l, edit = false) => glassPayload({ embeds: [embedAnnonce(gid, l)], components: boutons(gid, l), allowedMentions: PAS_DE_PING },
  { guildId: gid, badge: l.type === 'fixe' ? 'MARCHÉ · VENTE' : 'MARCHÉ · ENCHÈRE', thumbSquare: true, update: edit });
const payloadFinal = (gid, l, final) => glassPayload({ embeds: [embedAnnonce(gid, l, final)], components: [], allowedMentions: PAS_DE_PING },
  { guildId: gid, badge: 'MARCHÉ · TERMINÉ', thumbSquare: true, update: true });

async function recupererMessage(client, l) {
  try {
    const ch = await client.channels.fetch(l.channelId);
    return await ch.messages.fetch(l.messageId);
  } catch { return null; }
}

async function majAnnonce(client, gid, l) {
  const m = await recupererMessage(client, l);
  if (m) await m.edit(await payloadAnnonce(gid, l, true)).catch(() => { });
}

async function prevenir(client, userId, texte) {
  try {
    const u = await client.users.fetch(userId);
    await u.send(toCV2Payload({ embeds: [new EmbedBuilder().setColor(COULEUR).setTitle('🔔 Marché des cartes').setDescription(texte)] }));
  } catch { /* MP fermés : tant pis */ }
}

// Annonce de fin : édite le message d'origine + petit message dans le salon
async function annoncerFin(client, gid, l, final, notice) {
  const m = await recupererMessage(client, l);
  if (m) await m.edit(await payloadFinal(gid, l, final)).catch(() => { });
  if (notice) {
    try {
      const ch = await client.channels.fetch(l.channelId);
      await ch.send(toCV2Payload({
        embeds: [new EmbedBuilder().setColor(COULEUR).setDescription(notice)],
        allowedMentions: { users: [l.sellerId, l.bidderId, l.buyerId].filter(Boolean) },
      }));
    } catch { /* salon supprimé */ }
  }
}

// ── Opérations (synchrones : aucune attente entre vérification et modification) ──
function supprimer(gid, id) { delete cg.marche(gid).listings[String(id)]; }

function creer(gid, base) {
  const m = cg.marche(gid);
  const id = m.nextId++;
  const l = { id, createdAt: Date.now(), bids: 0, bid: 0, bidderId: null, extended: 0, image: null, ...base };
  m.listings[String(id)] = l;
  return l;
}

function acheterFixe(gid, buyerId, id) {
  const l = annonce(gid, id);
  if (!l) return { ok: false, error: 'Annonce introuvable ou déjà terminée.' };
  if (l.type !== 'fixe') return { ok: false, error: 'Cette annonce est une enchère : utilise **Enchérir**.' };
  if (Date.now() >= l.endsAt) return { ok: false, error: 'Cette annonce vient d\'expirer.' };
  if (!cg.ecoActive(gid)) return { ok: false, error: 'L\'économie est désactivée sur ce serveur.' };
  if (l.sellerId === buyerId) return { ok: false, error: 'Tu ne peux pas acheter ta propre annonce (utilise `/market cancel`).' };
  if (cg.solde(gid, buyerId) < l.price) return { ok: false, error: `Solde insuffisant : il te faut **${cg.fmt(gid, l.price)}**.` };
  cg.debiter(gid, buyerId, l.price);
  const f = frais(l.price);
  cg.crediter(gid, l.sellerId, l.price - f);
  cg.donnerCarte(gid, buyerId, l.itemId);
  supprimer(gid, id);
  l.buyerId = buyerId;
  sauver();
  return { ok: true, l, frais: f, prix: l.price };
}

function acheterMaintenant(gid, buyerId, id) {
  const l = annonce(gid, id);
  if (!l) return { ok: false, error: 'Annonce introuvable ou déjà terminée.' };
  if (l.type !== 'enchere' || !l.buyout) return { ok: false, error: 'Cette enchère n\'a pas d\'achat immédiat.' };
  if (!cg.ecoActive(gid)) return { ok: false, error: 'L\'économie est désactivée sur ce serveur.' };
  if (l.sellerId === buyerId) return { ok: false, error: 'Tu ne peux pas acheter ta propre annonce.' };
  const deja = l.bidderId === buyerId ? l.bid : 0;
  if (cg.solde(gid, buyerId) < l.buyout - deja) return { ok: false, error: `Solde insuffisant : il te faut **${cg.fmt(gid, l.buyout - deja)}** de plus.` };
  const precedent = l.bidderId ? { id: l.bidderId, montant: l.bid } : null;
  if (precedent) cg.crediter(gid, precedent.id, precedent.montant); // rembourse l'enchère en cours (y compris la sienne)
  cg.debiter(gid, buyerId, l.buyout);
  const f = frais(l.buyout);
  cg.crediter(gid, l.sellerId, l.buyout - f);
  cg.donnerCarte(gid, buyerId, l.itemId);
  supprimer(gid, id);
  l.buyerId = buyerId;
  sauver();
  return { ok: true, l, frais: f, prix: l.buyout, precedent: precedent && precedent.id !== buyerId ? precedent : null };
}

function placerEnchere(gid, userId, id, montant) {
  const l = annonce(gid, id);
  if (!l) return { ok: false, error: 'Annonce introuvable ou déjà terminée.' };
  if (l.type !== 'enchere') return { ok: false, error: 'Cette annonce est à prix fixe : utilise **Acheter**.' };
  if (Date.now() >= l.endsAt) return { ok: false, error: 'Cette enchère est terminée.' };
  if (!cg.ecoActive(gid)) return { ok: false, error: 'L\'économie est désactivée sur ce serveur.' };
  if (l.sellerId === userId) return { ok: false, error: 'Tu ne peux pas enchérir sur ta propre annonce.' };
  if (l.bidderId === userId) return { ok: false, error: 'Tu es déjà le meilleur enchérisseur.' };
  if (!Number.isInteger(montant) || montant <= 0) return { ok: false, error: 'Montant invalide.' };
  if (l.buyout && montant >= l.buyout) return acheterMaintenant(gid, userId, id);
  const min = prixMinimum(l);
  if (montant < min) return { ok: false, error: `Enchère trop basse : minimum **${cg.fmt(gid, min)}**.` };
  if (montant > PRIX_MAX) return { ok: false, error: 'Montant trop élevé.' };
  if (cg.solde(gid, userId) < montant) return { ok: false, error: `Solde insuffisant : il te faut **${cg.fmt(gid, montant)}**.` };

  cg.debiter(gid, userId, montant);
  const precedent = l.bidderId ? { id: l.bidderId, montant: l.bid } : null;
  if (precedent) cg.crediter(gid, precedent.id, precedent.montant);
  l.bid = montant;
  l.bidderId = userId;
  l.bids++;
  let prolonge = false;
  if (l.endsAt - Date.now() < ANTI_SNIPE_MS && (l.extended || 0) < ANTI_SNIPE_MAX) {
    l.endsAt = Date.now() + ANTI_SNIPE_MS;
    l.extended = (l.extended || 0) + 1;
    prolonge = true;
  }
  sauver();
  return { ok: true, enchere: true, l, precedent, prolonge };
}

function annulerAnnonce(gid, userId, id, admin) {
  const l = annonce(gid, id);
  if (!l) return { ok: false, error: 'Annonce introuvable ou déjà terminée.' };
  if (l.sellerId !== userId && !admin) return { ok: false, error: 'Cette annonce n\'est pas la tienne.' };
  if (l.type === 'enchere' && l.bidderId && !admin) return { ok: false, error: 'Impossible d\'annuler une enchère qui a déjà reçu des offres.' };
  const precedent = l.bidderId ? { id: l.bidderId, montant: l.bid } : null;
  if (precedent) cg.crediter(gid, precedent.id, precedent.montant);
  cg.donnerCarte(gid, l.sellerId, l.itemId);
  supprimer(gid, id);
  sauver();
  return { ok: true, l, precedent };
}

// Clôture une annonce arrivée à échéance
async function cloturer(client, gid, l) {
  if (!annonce(gid, l.id)) return;
  const item = getItem(l.itemId);
  const n = item ? `${item.emoji} **${nom(item)}**` : l.itemId;
  if (l.type === 'enchere' && l.bidderId) {
    const f = frais(l.bid);
    cg.crediter(gid, l.sellerId, l.bid - f);
    cg.donnerCarte(gid, l.bidderId, l.itemId);
    supprimer(gid, l.id);
    l.buyerId = l.bidderId;
    sauver();
    await annoncerFin(client, gid, l,
      { emoji: '✅', titre: 'Vendu', texte: `🔨 Enchère terminée !\n🏆 Gagnant : <@${l.bidderId}> pour **${cg.fmt(gid, l.bid)}**\n👤 Vendeur : <@${l.sellerId}> (reçoit **${cg.fmt(gid, l.bid - f)}** après frais)` },
      `🔨 <@${l.bidderId}> remporte ${n} pour **${cg.fmt(gid, l.bid)}** (vendeur : <@${l.sellerId}>).`);
    prevenir(client, l.sellerId, `Ton enchère sur ${n} est terminée : vendue **${cg.fmt(gid, l.bid)}** (tu reçois **${cg.fmt(gid, l.bid - f)}** après frais).`);
    return;
  }
  cg.donnerCarte(gid, l.sellerId, l.itemId);
  supprimer(gid, l.id);
  sauver();
  await annoncerFin(client, gid, l,
    { emoji: '⌛', titre: 'Expirée', texte: `Personne n'a acheté cette carte : elle est retournée dans la collection de <@${l.sellerId}>.` },
    `⌛ L'annonce #${l.id} (${n}) a expiré sans acheteur : la carte est rendue à <@${l.sellerId}>.`);
}

let minuteur = null;
async function tick(client) {
  const maintenant = Date.now();
  for (const gid of cg.guildesMarche()) {
    for (const l of [...annoncesActives(gid)]) {
      if (maintenant >= l.endsAt) await cloturer(client, gid, l).catch(e => console.error('[Marché] clôture :', e));
    }
  }
}
function startMarche(client) {
  if (minuteur) return;
  tick(client).catch(() => { });
  minuteur = setInterval(() => tick(client).catch(() => { }), 15_000);
  minuteur.unref?.();
}

// ── Création d'annonces (commandes) ─────────────────────────────────────
async function creerAnnonce(interaction, type) {
  const gid = interaction.guild.id;
  const uid = interaction.user.id;
  const refus = txt => rep(interaction, { content: txt, flags: EPH });

  if (!cg.ecoActive(gid)) return refus('❌ L\'économie est désactivée sur ce serveur.');
  const itemId = interaction.options.getString('carte', true);
  const item = getItem(itemId);
  if (!item) return refus('❌ Carte inconnue : choisis-en une dans la liste proposée.');
  if (cg.nbCartes(gid, uid, itemId) < 1) return refus(`❌ Tu ne possèdes pas **${nom(item)}**.`);
  if (compteVendeur(gid, uid) >= MAX_ANNONCES) return refus(`❌ Tu as déjà ${MAX_ANNONCES} annonces actives (maximum). Attends qu'elles se terminent ou utilise \`/market cancel\`.`);

  let base;
  if (type === 'fixe') {
    const prix = interaction.options.getInteger('prix', true);
    if (prix < 1 || prix > PRIX_MAX) return refus(`❌ Le prix doit être compris entre 1 et ${PRIX_MAX.toLocaleString('fr-FR')}.`);
    base = { type: 'fixe', price: prix, endsAt: Date.now() + DUREE_FIXE_MS };
  } else {
    const depart = interaction.options.getInteger('prix-depart', true);
    const heures = interaction.options.getInteger('duree') || 24;
    const achat = interaction.options.getInteger('achat-immediat') || 0;
    if (depart < 1 || depart > PRIX_MAX) return refus(`❌ Le prix de départ doit être compris entre 1 et ${PRIX_MAX.toLocaleString('fr-FR')}.`);
    if (achat && (achat <= depart || achat > PRIX_MAX)) return refus('❌ L\'achat immédiat doit être supérieur au prix de départ.');
    base = { type: 'enchere', start: depart, buyout: achat || 0, endsAt: Date.now() + heures * 3600 * 1000 };
  }

  // séquestre de la carte + création
  if (!cg.retirerCarte(gid, uid, itemId)) return refus('❌ Impossible de retirer la carte de ta collection.');
  const l = creer(gid, { ...base, sellerId: uid, itemId, channelId: interaction.channelId, messageId: null });
  sauver();

  try {
    await rep(interaction, await payloadAnnonce(gid, l));
    const m = await interaction.fetchReply();
    l.messageId = m.id;
    l.channelId = m.channelId || interaction.channelId;
    cg.sauverMarche();
  } catch (e) {
    // échec d'envoi : on annule et on rend la carte
    supprimer(gid, l.id);
    cg.donnerCarte(gid, uid, itemId);
    sauver();
    console.error('[Marché] publication :', e.message);
    return;
  }

  // image de la carte, en arrière-plan (ne retarde pas la réponse)
  Promise.race([getCardImage(item), sleep(8000).then(() => null)]).then(async r => {
    if (!r?.url || !annonce(gid, l.id)) return;
    l.image = r.url;
    cg.sauverMarche();
    await majAnnonce(interaction.client, gid, l);
  }).catch(() => { });
}

const vendre = i => creerAnnonce(i, 'fixe');
const mettreAuxEncheres = i => creerAnnonce(i, 'enchere');

// ── Actions partagées commandes / boutons ───────────────────────────────
async function actionAcheter(interaction, id) {
  const gid = interaction.guild.id;
  const r = acheterFixe(gid, interaction.user.id, id);
  if (!r.ok) return rep(interaction, { content: `❌ ${r.error}`, flags: EPH });
  const item = getItem(r.l.itemId);
  await rep(interaction, { content: `✅ Tu as acheté **${nom(item)}** pour **${cg.fmt(gid, r.prix)}** ! Elle est dans ta collection (\`/economy collection\`).`, flags: EPH });
  await annoncerFin(interaction.client, gid, r.l,
    { emoji: '✅', titre: 'Vendu', texte: `🛒 Acheté par <@${interaction.user.id}> pour **${cg.fmt(gid, r.prix)}**\n👤 Vendeur : <@${r.l.sellerId}> (reçoit **${cg.fmt(gid, r.prix - r.frais)}** après frais)` },
    `🛒 <@${interaction.user.id}> a acheté ${item.emoji} **${nom(item)}** à <@${r.l.sellerId}> pour **${cg.fmt(gid, r.prix)}**.`);
  prevenir(interaction.client, r.l.sellerId, `${item.emoji} **${nom(item)}** vendue **${cg.fmt(gid, r.prix)}** (tu reçois **${cg.fmt(gid, r.prix - r.frais)}** après frais).`);
}

async function actionAchatImmediat(interaction, id) {
  const gid = interaction.guild.id;
  const r = acheterMaintenant(gid, interaction.user.id, id);
  return finEnchereImmediate(interaction, gid, r);
}

async function finEnchereImmediate(interaction, gid, r) {
  if (!r.ok) return rep(interaction, { content: `❌ ${r.error}`, flags: EPH });
  const item = getItem(r.l.itemId);
  await rep(interaction, { content: `⚡ Achat immédiat réussi : **${nom(item)}** pour **${cg.fmt(gid, r.prix)}** !`, flags: EPH });
  await annoncerFin(interaction.client, gid, r.l,
    { emoji: '⚡', titre: 'Vendu (achat immédiat)', texte: `⚡ Acheté par <@${interaction.user.id}> pour **${cg.fmt(gid, r.prix)}**\n👤 Vendeur : <@${r.l.sellerId}> (reçoit **${cg.fmt(gid, r.prix - r.frais)}** après frais)` },
    `⚡ <@${interaction.user.id}> a acheté ${item.emoji} **${nom(item)}** en achat immédiat pour **${cg.fmt(gid, r.prix)}**.`);
  prevenir(interaction.client, r.l.sellerId, `${item.emoji} **${nom(item)}** vendue **${cg.fmt(gid, r.prix)}** en achat immédiat (tu reçois **${cg.fmt(gid, r.prix - r.frais)}** après frais).`);
  if (r.precedent) prevenir(interaction.client, r.precedent.id, `Tu as été surenchéri sur ${item.emoji} **${nom(item)}** (achat immédiat) : tes **${cg.fmt(gid, r.precedent.montant)}** t'ont été remboursés.`);
}

async function actionEncherir(interaction, id, montant) {
  const gid = interaction.guild.id;
  const r = placerEnchere(gid, interaction.user.id, id, montant);
  if (!r.ok) return rep(interaction, { content: `❌ ${r.error}`, flags: EPH });
  if (!r.enchere) return finEnchereImmediate(interaction, gid, r); // montant ≥ achat immédiat
  const item = getItem(r.l.itemId);
  await rep(interaction, { content: `💰 Enchère de **${cg.fmt(gid, montant)}** placée sur **${nom(item)}** !${r.prolonge ? ' 🕑 Fin prolongée de 2 minutes (anti-sniping).' : ''}\nSi quelqu'un surenchérit, tu es remboursé automatiquement.`, flags: EPH });
  await majAnnonce(interaction.client, gid, r.l);
  if (r.precedent) prevenir(interaction.client, r.precedent.id, `Tu as été surenchéri sur ${item.emoji} **${nom(item)}** (nouvelle offre : **${cg.fmt(gid, montant)}**). Tes **${cg.fmt(gid, r.precedent.montant)}** t'ont été remboursés. [Voir l'annonce](${lien(gid, r.l)})`);
}

async function actionAnnuler(interaction, id) {
  const gid = interaction.guild.id;
  const admin = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const r = annulerAnnonce(gid, interaction.user.id, id, admin);
  if (!r.ok) return rep(interaction, { content: `❌ ${r.error}`, flags: EPH });
  const item = getItem(r.l.itemId);
  await rep(interaction, { content: `✅ Annonce #${r.l.id} annulée : **${nom(item)}** est de retour dans la collection de <@${r.l.sellerId}>.${r.precedent ? ' L\'enchérisseur a été remboursé.' : ''}`, flags: EPH, allowedMentions: PAS_DE_PING });
  await annoncerFin(interaction.client, gid, r.l, { emoji: '🚫', titre: 'Annulée', texte: 'Cette annonce a été retirée.' }, null);
  if (r.precedent) prevenir(interaction.client, r.precedent.id, `L'enchère sur ${item.emoji} **${nom(item)}** a été annulée : tes **${cg.fmt(gid, r.precedent.montant)}** t'ont été remboursés.`);
}

// ── Listes ──────────────────────────────────────────────────────────────
function ligneAnnonce(gid, l) {
  const item = getItem(l.itemId);
  const rar = getRarity(item?.rarity);
  const n = item ? `${rar.emoji} **${nom(item)}**` : l.itemId;
  const prix = l.type === 'fixe'
    ? `🏷️ **${cg.fmt(gid, l.price)}**`
    : `🔨 **${cg.fmt(gid, l.bidderId ? l.bid : l.start)}**${l.bidderId ? ` (${l.bids} offre${l.bids > 1 ? 's' : ''})` : ' (départ)'}${l.buyout ? ` • ⚡ ${cg.fmt(gid, l.buyout)}` : ''}`;
  return `**#${l.id}** ${n} — ${prix} • <@${l.sellerId}> • <t:${ts(l.endsAt)}:R> • [voir](${lien(gid, l)})`;
}

function embedListe(interaction, { type, recherche, page }) {
  const gid = interaction.guild.id;
  let liste = annoncesActives(gid).filter(l => l.messageId);
  if (type === 'fixe' || type === 'enchere') liste = liste.filter(l => l.type === type);
  if (recherche) {
    const q = norm(recherche);
    liste = liste.filter(l => norm(getItem(l.itemId)?.name).includes(q));
  }
  liste.sort((a, b) => a.endsAt - b.endsAt);
  const pages = Math.max(1, Math.ceil(liste.length / PAR_PAGE));
  const p = Math.min(Math.max(1, page || 1), pages);
  const sur = liste.slice((p - 1) * PAR_PAGE, p * PAR_PAGE);
  return new EmbedBuilder().setColor(COULEUR)
    .setTitle('🏪 Marché des cartes')
    .setDescription(sur.length
      ? sur.map(l => ligneAnnonce(gid, l)).join('\n')
      : 'Aucune annonce pour l\'instant. Mets une carte en vente avec `/market sell` ou `/market auction` !')
    .setFooter({ text: `Page ${p}/${pages} • ${liste.length} annonce(s) • /market buy • /market bid` });
}

function embedMesAnnonces(interaction) {
  const gid = interaction.guild.id;
  const uid = interaction.user.id;
  const miennes = annoncesActives(gid).filter(l => l.sellerId === uid).sort((a, b) => a.endsAt - b.endsAt);
  const encheres = annoncesActives(gid).filter(l => l.type === 'enchere' && l.bidderId === uid);
  return new EmbedBuilder().setColor(COULEUR)
    .setTitle('📦 Mes annonces')
    .setDescription(
      `**Mes ventes (${miennes.length}/${MAX_ANNONCES})**\n${miennes.length ? miennes.map(l => ligneAnnonce(gid, l)).join('\n') : '*aucune*'}\n\n` +
      `**Enchères où je suis en tête (${encheres.length})**\n${encheres.length ? encheres.map(l => ligneAnnonce(gid, l)).join('\n') : '*aucune*'}`);
}

// ── Autocomplétion ──────────────────────────────────────────────────────
async function autocomplete(interaction) {
  if (!interaction.guild) return interaction.respond([]);
  const gid = interaction.guild.id;
  const uid = interaction.user.id;
  const focus = interaction.options.getFocused(true);
  const q = norm(focus.value);
  let choix = [];

  if (focus.name === 'carte') {
    choix = cg.cartesPossedees(gid, uid)
      .filter(({ item }) => !q || norm(item.name).includes(q))
      .slice(0, 25)
      .map(({ item, count }) => ({ name: `${nom(item)}${count > 1 ? ` ×${count}` : ''} (${getRarity(item.rarity).label})`.slice(0, 100), value: item.id }));
  } else if (focus.name === 'id') {
    const sub = interaction.options.getSubcommand(false);
    const admin = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    let liste = annoncesActives(gid).filter(l => l.messageId);
    if (sub === 'acheter') liste = liste.filter(l => l.type === 'fixe' && l.sellerId !== uid);
    else if (sub === 'encherir') liste = liste.filter(l => l.type === 'enchere' && l.sellerId !== uid);
    else if (sub === 'annuler') liste = liste.filter(l => admin || l.sellerId === uid);
    choix = liste
      .filter(l => !q || String(l.id).startsWith(q) || norm(getItem(l.itemId)?.name).includes(q))
      .sort((a, b) => a.endsAt - b.endsAt)
      .slice(0, 25)
      .map(l => {
        const item = getItem(l.itemId);
        const prix = l.type === 'fixe' ? l.price : (l.bidderId ? l.bid : l.start);
        return { name: `#${l.id} • ${item ? nom(item) : l.itemId} • ${l.type === 'fixe' ? 'prix' : 'enchère'} ${prix.toLocaleString('fr-FR')}`.slice(0, 100), value: l.id };
      });
  }
  return interaction.respond(choix);
}

// ── Boutons / modales permanents (customId « mkt_… ») ───────────────────
async function routeMarcheInteraction(interaction) {
  if (!interaction.guild) {
    return rep(interaction, { content: '❌ Le marché fonctionne uniquement sur un serveur.', flags: EPH }).catch(() => { });
  }
  const [, action, idTxt] = String(interaction.customId).split('_');
  const id = Number(idTxt);
  const gid = interaction.guild.id;

  try {
    if (interaction.isModalSubmit() && action === 'bidm') {
      const brut = interaction.fields.getTextInputValue('montant');
      const montant = Number(String(brut).replace(/[\s\u202f\u00a0.,]/g, ''));
      return await actionEncherir(interaction, id, montant);
    }
    if (!interaction.isButton()) return;

    if (action === 'buy') return await actionAcheter(interaction, id);
    if (action === 'now') return await actionAchatImmediat(interaction, id);
    if (action === 'min') {
      const l = annonce(gid, id);
      if (!l) return await rep(interaction, { content: '❌ Annonce introuvable ou déjà terminée.', flags: EPH });
      return await actionEncherir(interaction, id, prixMinimum(l));
    }
    if (action === 'bid') {
      const l = annonce(gid, id);
      if (!l) return await rep(interaction, { content: '❌ Annonce introuvable ou déjà terminée.', flags: EPH });
      const modal = new ModalBuilder().setCustomId(`mkt_bidm_${id}`).setTitle(`Enchère sur l'annonce #${id}`)
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('montant').setLabel(`Ton enchère (minimum ${prixMinimum(l).toLocaleString('fr-FR')})`)
            .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(10).setPlaceholder(String(prixMinimum(l)))
        ));
      return await interaction.showModal(modal);
    }
  } catch (e) {
    console.error('[Marché] interaction :', e);
    if (!interaction.replied && !interaction.deferred) {
      rep(interaction, { content: '❌ Une erreur est survenue, réessaie.', flags: EPH }).catch(() => { });
    }
  }
}

module.exports = {
  vendre, mettreAuxEncheres,
  actionAcheter, actionEncherir, actionAnnuler,
  embedListe, embedMesAnnonces,
  autocomplete, routeMarcheInteraction, startMarche,
  PRIX_MAX, FRAIS_PCT, MAX_ANNONCES,
};
