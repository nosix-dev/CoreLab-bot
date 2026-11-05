'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Collection de personnages d'anime façon Mudae
//   /anime roll [type]          → tire un personnage (waifu / husbando / mix) avec un bouton « Claim »
//   /anime harem [membre]       → la collection d'un membre (paginée)
//   /anime info <nom>           → fiche d'un personnage + son propriétaire
//   /anime divorce <nom>        → libère un personnage (remboursement en pièces)
//   /anime give <membre> <nom>  → donne un personnage
//   /anime wish-add / wish-remove / wish-list → liste de souhaits (ping quand le perso sort)
//   /anime top                  → classement des plus gros harems du serveur
//   /anime daily                → pièces + remise à zéro des rolls et du claim
//
// Source des personnages : API publique AniList (GraphQL, sans clé).
// Limites : 10 rolls par heure, 1 claim toutes les 3 heures (par membre).
// Un personnage ne peut appartenir qu'à un seul membre par serveur.
// Données : anime_data.json  { [guildId]: { chars, owners, users } }
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const axios = require('axios');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');
const eco = require('../core/cardGame');

const FICHIER = 'anime_data.json';
const ANILIST = 'https://graphql.anilist.co';

const ROLLS_MAX = 10;
const ROLL_WINDOW_MS = 60 * 60 * 1000;
const CLAIM_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const DAILY_COINS = 200;
const WISH_MAX = 10;
const PAGE_SIZE = 10;
const CLAIM_BUTTON_MS = 60 * 1000;
const POOL_PAGES = 80;          // top ~4000 personnages (50 par page)
const PAGE_TTL_MS = 6 * 60 * 60 * 1000;

// ── Stockage ────────────────────────────────────────────────
const donnees = chargerDonnees(FICHIER, {});
let saveTimer = null;
function sauver() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { sauvegarderDonnees(FICHIER, donnees); } catch (e) { console.error('[Anime] sauvegarde :', e.message); }
  }, 5000);
}

function guildData(guildId) {
  const g = String(guildId);
  if (!donnees[g]) donnees[g] = { chars: {}, owners: {}, users: {} };
  const d = donnees[g];
  if (!d.chars) d.chars = {};
  if (!d.owners) d.owners = {};
  if (!d.users) d.users = {};
  return d;
}

function userData(guildId, userId) {
  const d = guildData(guildId);
  const u = String(userId);
  if (!d.users[u]) d.users[u] = { rolls: ROLLS_MAX, rollsReset: 0, lastClaim: 0, lastDaily: 0, wish: [] };
  const x = d.users[u];
  if (!Array.isArray(x.wish)) x.wish = [];
  if (typeof x.rolls !== 'number') x.rolls = ROLLS_MAX;
  return x;
}

// ── Rareté / valeur ─────────────────────────────────────────
function rarete(fav) {
  if (fav >= 50000) return { nom: 'Mythique', emoji: '🌟', couleur: 0xE91E63 };
  if (fav >= 20000) return { nom: 'Légendaire', emoji: '👑', couleur: 0xF1C40F };
  if (fav >= 8000)  return { nom: 'Épique', emoji: '💜', couleur: 0x9B59B6 };
  if (fav >= 2500)  return { nom: 'Rare', emoji: '💎', couleur: 0x3498DB };
  if (fav >= 800)   return { nom: 'Peu commun', emoji: '🍀', couleur: 0x2ECC71 };
  return { nom: 'Commun', emoji: '⚪', couleur: 0x95A5A6 };
}
const valeur = fav => Math.max(50, Math.round(Math.sqrt(Math.max(0, fav)) * 10));
const nombre = n => Math.floor(n).toLocaleString('fr-FR');
const ts = ms => `<t:${Math.floor(ms / 1000)}:R>`;

// ── AniList ─────────────────────────────────────────────────
const FIELDS = `id name { full native } image { large } gender favourites
  media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji english } } }`;

function normaliser(c) {
  const t = c?.media?.nodes?.[0]?.title;
  return {
    id: String(c.id),
    name: c.name?.full || c.name?.native || 'Inconnu',
    native: c.name?.native || '',
    series: t?.english || t?.romaji || '—',
    image: c.image?.large || null,
    gender: c.gender || '',
    fav: c.favourites || 0
  };
}

async function anilist(query, variables) {
  const res = await axios.post(ANILIST, { query, variables }, {
    timeout: 8000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  });
  if (res.data?.errors?.length) throw new Error(res.data.errors[0].message);
  return res.data.data;
}

const pageCache = new Map();
async function pagePersonnages(page) {
  const hit = pageCache.get(page);
  if (hit && Date.now() - hit.t < PAGE_TTL_MS) return hit.list;
  const data = await anilist(
    `query($page:Int){ Page(page:$page, perPage:50){ characters(sort:FAVOURITES_DESC){ ${FIELDS} } } }`,
    { page }
  );
  const list = (data.Page.characters || []).map(normaliser).filter(c => c.image);
  pageCache.set(page, { t: Date.now(), list });
  return list;
}

// Plus on est haut dans le classement des favoris, plus c'est probable (tirage² )
async function personnageAleatoire(type) {
  for (let essai = 0; essai < 3; essai++) {
    const page = 1 + Math.floor(Math.random() ** 2 * POOL_PAGES);
    let list = await pagePersonnages(page);
    if (type === 'waifu') list = list.filter(c => c.gender === 'Female');
    else if (type === 'husbando') list = list.filter(c => c.gender === 'Male');
    if (list.length) return list[Math.floor(Math.random() * list.length)];
  }
  throw new Error('aucun personnage');
}

async function personnageParId(id) {
  const data = await anilist(`query($id:Int){ Character(id:$id){ ${FIELDS} } }`, { id: Number(id) });
  return data.Character ? normaliser(data.Character) : null;
}

async function personnageParNom(nom) {
  const data = await anilist(
    `query($s:String){ Page(page:1, perPage:1){ characters(search:$s, sort:FAVOURITES_DESC){ ${FIELDS} } } }`,
    { s: nom }
  );
  const c = data.Page.characters?.[0];
  return c ? normaliser(c) : null;
}

// Cache des personnages tirés (pour que le bouton Claim n'ait pas à re-télécharger)
const rollCache = new Map();
function cacher(c) {
  if (rollCache.size > 300) rollCache.delete(rollCache.keys().next().value);
  rollCache.set(c.id, c);
}

// ── Recherche locale ────────────────────────────────────────
const sans = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function cherchePossede(guildId, userId, texte) {
  const d = guildData(guildId);
  const q = sans(texte);
  const siens = Object.keys(d.owners).filter(id => d.owners[id] === String(userId) && d.chars[id]).map(id => d.chars[id]);
  return siens.find(c => c.id === texte)
    || siens.find(c => sans(c.name) === q)
    || siens.find(c => sans(c.name).includes(q))
    || null;
}

function cherchePartout(guildId, texte) {
  const d = guildData(guildId);
  const q = sans(texte);
  const tous = Object.values(d.chars);
  return tous.find(c => sans(c.name) === q) || tous.find(c => sans(c.name).includes(q)) || null;
}

function harem(guildId, userId) {
  const d = guildData(guildId);
  return Object.keys(d.owners)
    .filter(id => d.owners[id] === String(userId) && d.chars[id])
    .map(id => d.chars[id])
    .sort((a, b) => b.fav - a.fav || a.name.localeCompare(b.name, 'fr'));
}

// ── Affichage ───────────────────────────────────────────────
function carteEmbed(c, { proprietaire, footer } = {}) {
  const r = rarete(c.fav);
  const e = new EmbedBuilder()
    .setColor(r.couleur)
    .setTitle(c.name)
    .setDescription(
      `**${c.series}**\n` +
      `❤️ ${nombre(c.fav)} favoris • ${r.emoji} ${r.nom}\n` +
      `💰 Valeur : **${nombre(valeur(c.fav))}**` +
      (proprietaire ? `\n💖 Appartient à ${proprietaire}` : '')
    );
  if (c.image) e.setImage(c.image);
  if (footer) e.setFooter({ text: footer });
  return e;
}

function boutonClaim(id, desactive) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`anime:claim:${id}`)
      .setLabel('Claim')
      .setEmoji('💖')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!desactive)
  );
}

function pageHarem(guildId, targetId, page, viewerId, nom) {
  const liste = harem(guildId, targetId);
  const pages = Math.max(1, Math.ceil(liste.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = liste.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const total = liste.reduce((s, c) => s + valeur(c.fav), 0);
  const embed = new EmbedBuilder()
    .setColor(0xE91E63)
    .setTitle(`💖 Harem de ${nom}`)
    .setDescription(slice.length
      ? slice.map((c, i) => `**${page * PAGE_SIZE + i + 1}.** ${rarete(c.fav).emoji} ${c.name} — *${c.series}* • 💰 ${nombre(valeur(c.fav))}`).join('\n')
      : '*Aucun personnage pour le moment. Tente `/anime roll` !*')
    .setFooter({ text: `${liste.length} personnage(s) • Valeur totale : ${nombre(total)} • Page ${page + 1}/${pages}` });
  if (slice[0]?.image) embed.setThumbnail(slice[0].image);
  const components = [];
  if (pages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`anime:harem:${targetId}:${page - 1}:${viewerId}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`anime:harem:${targetId}:${page + 1}:${viewerId}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    ));
  }
  return { embeds: [embed], components };
}

// ── Commande ────────────────────────────────────────────────
const nomOpt = (o, desc = 'Nom du personnage', auto = true) =>
  o.setName('nom').setDescription(desc).setRequired(true).setAutocomplete(auto);

const anime = {
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('💖 Collectionne des personnages d\'anime (façon Mudae)')
    .addSubcommand(s => s.setName('roll').setDescription('🎲 Tire un personnage au hasard')
      .addStringOption(o => o.setName('type').setDescription('Type de personnage').addChoices(
        { name: 'Mix', value: 'mix' }, { name: 'Waifu', value: 'waifu' }, { name: 'Husbando', value: 'husbando' })))
    .addSubcommand(s => s.setName('harem').setDescription('📚 Voir la collection d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre (toi par défaut)')))
    .addSubcommand(s => s.setName('info').setDescription('🔎 Fiche d\'un personnage')
      .addStringOption(o => nomOpt(o, 'Nom du personnage', false)))
    .addSubcommand(s => s.setName('divorce').setDescription('💔 Libérer un de tes personnages (remboursement en pièces)')
      .addStringOption(o => nomOpt(o)))
    .addSubcommand(s => s.setName('give').setDescription('🎁 Donner un de tes personnages')
      .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
      .addStringOption(o => nomOpt(o)))
    .addSubcommand(s => s.setName('wish-add').setDescription('⭐ Ajouter un personnage à ta liste de souhaits')
      .addStringOption(o => nomOpt(o, 'Nom du personnage', false)))
    .addSubcommand(s => s.setName('wish-remove').setDescription('🗑️ Retirer un personnage de ta liste de souhaits')
      .addStringOption(o => nomOpt(o)))
    .addSubcommand(s => s.setName('wish-list').setDescription('⭐ Voir ta liste de souhaits'))
    .addSubcommand(s => s.setName('top').setDescription('🏆 Classement des plus gros harems du serveur'))
    .addSubcommand(s => s.setName('daily').setDescription('🎁 Récompense quotidienne : pièces + rolls et claim remis à zéro')),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Cette commande fonctionne uniquement dans un serveur.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    try {
      switch (sub) {
        case 'roll': return await cmdRoll(interaction);
        case 'harem': return await cmdHarem(interaction);
        case 'info': return await cmdInfo(interaction);
        case 'divorce': return await cmdDivorce(interaction);
        case 'give': return await cmdGive(interaction);
        case 'wish-add': return await cmdWishAdd(interaction);
        case 'wish-remove': return await cmdWishRemove(interaction);
        case 'wish-list': return await cmdWishList(interaction);
        case 'top': return await cmdTop(interaction);
        case 'daily': return await cmdDaily(interaction);
      }
    } catch (e) {
      console.error(`[Anime] /anime ${sub} :`, e.message);
      const payload = { content: '❌ Impossible de joindre l\'API AniList pour le moment, réessaie dans quelques secondes.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: payload.content, embeds: [], components: [] }).catch(() => {});
      return interaction.reply(payload).catch(() => {});
    }
  }
};

const eph = content => ({ content, flags: MessageFlags.Ephemeral });

// ── /anime roll ─────────────────────────────────────────────
async function cmdRoll(interaction) {
  const guildId = interaction.guildId;
  const u = userData(guildId, interaction.user.id);
  const now = Date.now();
  if (now >= (u.rollsReset || 0)) { u.rolls = ROLLS_MAX; u.rollsReset = 0; }
  if (u.rolls <= 0) {
    return interaction.reply(eph(`⏳ Plus de rolls ! Prochain lot ${ts(u.rollsReset)} (ou \`/anime daily\`).`));
  }

  await interaction.deferReply();
  const c = await personnageAleatoire(interaction.options.getString('type') || 'mix');
  cacher(c);

  if (!u.rollsReset) u.rollsReset = now + ROLL_WINDOW_MS;
  u.rolls--;
  sauver();

  const d = guildData(guildId);
  const ownerId = d.owners[c.id];
  const claimOk = now - (u.lastClaim || 0) >= CLAIM_COOLDOWN_MS;
  const footer = `Rolls restants : ${u.rolls}/${ROLLS_MAX} • Claim ${claimOk ? 'disponible' : 'dans ' + Math.ceil((CLAIM_COOLDOWN_MS - (now - u.lastClaim)) / 60000) + ' min'}`;

  const wishers = Object.keys(d.users).filter(id => id !== interaction.user.id && d.users[id].wish?.some(w => w.id === c.id));
  const content = wishers.length ? `⭐ Souhaité par ${wishers.map(id => `<@${id}>`).join(' ')} !` : undefined;

  await interaction.editReply({
    content,
    embeds: [carteEmbed(c, { proprietaire: ownerId ? `<@${ownerId}>` : null, footer })],
    components: ownerId ? [] : [boutonClaim(c.id, false)],
    allowedMentions: { users: wishers }
  });

  if (!ownerId) {
    setTimeout(() => {
      if (guildData(guildId).owners[c.id]) return;
      interaction.editReply({ components: [boutonClaim(c.id, true)] }).catch(() => {});
    }, CLAIM_BUTTON_MS).unref?.();
  }
}

// ── Bouton Claim ────────────────────────────────────────────
async function handleClaim(interaction, id) {
  await interaction.deferUpdate();
  const guildId = interaction.guildId;
  let c = rollCache.get(id);
  if (!c) c = await personnageParId(id);
  if (!c) return interaction.followUp(eph('❌ Personnage introuvable.'));

  // Vérifications + attribution sans await entre les deux (pas de double claim)
  const d = guildData(guildId);
  const u = userData(guildId, interaction.user.id);
  const now = Date.now();
  if (d.owners[id]) {
    return interaction.followUp(eph(`💔 Trop tard, **${c.name}** appartient déjà à <@${d.owners[id]}>.`));
  }
  if (now - (u.lastClaim || 0) < CLAIM_COOLDOWN_MS) {
    return interaction.followUp(eph(`⏳ Ton prochain claim est disponible ${ts(u.lastClaim + CLAIM_COOLDOWN_MS)} (ou \`/anime daily\`).`));
  }
  d.owners[id] = interaction.user.id;
  d.chars[id] = { ...c, claimedAt: now };
  u.lastClaim = now;
  sauver();

  await interaction.editReply({
    embeds: [carteEmbed(c, { footer: `💖 Claim par ${interaction.user.displayName || interaction.user.username}` })
      .setDescription(`**${c.series}**\n❤️ ${nombre(c.fav)} favoris • ${rarete(c.fav).emoji} ${rarete(c.fav).nom}\n💰 Valeur : **${nombre(valeur(c.fav))}**\n💖 Appartient à ${interaction.user}`)],
    components: [boutonClaim(id, true)]
  }).catch(() => {});
  await interaction.followUp({ content: `💖 ${interaction.user} a claim **${c.name}** !`, allowedMentions: { parse: [] } }).catch(() => {});
}

// ── /anime harem ────────────────────────────────────────────
async function cmdHarem(interaction) {
  const cible = interaction.options.getUser('membre') || interaction.user;
  const nom = interaction.guild.members.cache.get(cible.id)?.displayName || cible.displayName || cible.username;
  return interaction.reply(pageHarem(interaction.guildId, cible.id, 0, interaction.user.id, nom));
}

async function handleHarem(interaction, targetId, page, viewerId) {
  if (interaction.user.id !== viewerId) {
    return interaction.reply(eph('❌ Ce panneau n\'est pas le tien : fais `/anime harem`.'));
  }
  const m = interaction.guild.members.cache.get(targetId);
  const nom = m?.displayName || (await interaction.client.users.fetch(targetId).catch(() => null))?.username || 'Membre';
  return interaction.update(pageHarem(interaction.guildId, targetId, Number(page) || 0, viewerId, nom));
}

// ── /anime info ─────────────────────────────────────────────
async function cmdInfo(interaction) {
  const texte = interaction.options.getString('nom', true);
  await interaction.deferReply();
  let c = cherchePartout(interaction.guildId, texte);
  if (!c) c = await personnageParNom(texte);
  if (!c) return interaction.editReply('❌ Aucun personnage trouvé avec ce nom.');
  const ownerId = guildData(interaction.guildId).owners[c.id];
  const e = carteEmbed(c, { proprietaire: ownerId ? `<@${ownerId}>` : null, footer: ownerId ? undefined : 'Personne ne le possède encore' });
  if (c.native) e.setAuthor({ name: c.native });
  return interaction.editReply({ embeds: [e], allowedMentions: { parse: [] } });
}

// ── /anime divorce ──────────────────────────────────────────
async function cmdDivorce(interaction) {
  const c = cherchePossede(interaction.guildId, interaction.user.id, interaction.options.getString('nom', true));
  if (!c) return interaction.reply(eph('❌ Tu ne possèdes aucun personnage de ce nom.'));
  const gain = Math.floor(valeur(c.fav) / 2);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`anime:divorce:${c.id}:${interaction.user.id}`).setLabel('Confirmer').setEmoji('💔').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`anime:cancel:${c.id}:${interaction.user.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({
    content: `💔 Libérer **${c.name}** ? Tu récupères **${nombre(gain)}** pièces.`,
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

async function handleDivorce(interaction, id, ownerId) {
  if (interaction.user.id !== ownerId) return interaction.reply(eph('❌ Ce n\'est pas ta confirmation.'));
  const d = guildData(interaction.guildId);
  const c = d.chars[id];
  if (!c || d.owners[id] !== interaction.user.id) {
    return interaction.update({ content: '❌ Tu ne possèdes plus ce personnage.', components: [] });
  }
  const gain = Math.floor(valeur(c.fav) / 2);
  delete d.owners[id];
  delete d.chars[id];
  sauver();
  let suffixe = '';
  try {
    if (eco.ecoActive(interaction.guildId)) {
      eco.crediter(interaction.guildId, interaction.user.id, gain);
      eco.sauverEco();
      suffixe = ` (+${eco.fmt(interaction.guildId, gain)})`;
    }
  } catch (e) { console.error('[Anime] remboursement :', e.message); }
  return interaction.update({ content: `💔 **${c.name}** est de nouveau libre${suffixe}.`, components: [] });
}

// ── /anime give ─────────────────────────────────────────────
async function cmdGive(interaction) {
  const cible = interaction.options.getUser('membre', true);
  if (cible.bot || cible.id === interaction.user.id) return interaction.reply(eph('❌ Choisis un autre membre (pas un bot).'));
  const c = cherchePossede(interaction.guildId, interaction.user.id, interaction.options.getString('nom', true));
  if (!c) return interaction.reply(eph('❌ Tu ne possèdes aucun personnage de ce nom.'));
  guildData(interaction.guildId).owners[c.id] = cible.id;
  sauver();
  return interaction.reply({ content: `🎁 ${interaction.user} a donné **${c.name}** à ${cible} !`, allowedMentions: { users: [cible.id] } });
}

// ── Wishlist ────────────────────────────────────────────────
async function cmdWishAdd(interaction) {
  const u = userData(interaction.guildId, interaction.user.id);
  if (u.wish.length >= WISH_MAX) return interaction.reply(eph(`❌ Ta liste est pleine (${WISH_MAX} max).`));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const c = await personnageParNom(interaction.options.getString('nom', true));
  if (!c) return interaction.editReply('❌ Aucun personnage trouvé avec ce nom.');
  if (u.wish.some(w => w.id === c.id)) return interaction.editReply(`⭐ **${c.name}** est déjà dans ta liste.`);
  u.wish.push({ id: c.id, name: c.name });
  sauver();
  return interaction.editReply(`⭐ **${c.name}** (*${c.series}*) ajouté ! Tu seras mentionné quand il sortira.`);
}

async function cmdWishRemove(interaction) {
  const u = userData(interaction.guildId, interaction.user.id);
  const q = sans(interaction.options.getString('nom', true));
  const w = u.wish.find(x => x.id === q || sans(x.name).includes(q));
  if (!w) return interaction.reply(eph('❌ Ce personnage n\'est pas dans ta liste.'));
  u.wish = u.wish.filter(x => x.id !== w.id);
  sauver();
  return interaction.reply(eph(`🗑️ **${w.name}** retiré de ta liste.`));
}

async function cmdWishList(interaction) {
  const u = userData(interaction.guildId, interaction.user.id);
  const d = guildData(interaction.guildId);
  const desc = u.wish.length
    ? u.wish.map((w, i) => `**${i + 1}.** ${w.name}${d.owners[w.id] ? ` — 💖 <@${d.owners[w.id]}>` : ''}`).join('\n')
    : '*Ta liste est vide. Ajoute des personnages avec `/anime wish-add`.*';
  const e = new EmbedBuilder().setColor(0xF1C40F).setTitle('⭐ Ta liste de souhaits').setDescription(desc).setFooter({ text: `${u.wish.length}/${WISH_MAX}` });
  return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

// ── /anime top ──────────────────────────────────────────────
async function cmdTop(interaction) {
  const d = guildData(interaction.guildId);
  const totaux = {};
  for (const [id, uid] of Object.entries(d.owners)) {
    const c = d.chars[id];
    if (!c) continue;
    if (!totaux[uid]) totaux[uid] = { n: 0, v: 0 };
    totaux[uid].n++;
    totaux[uid].v += valeur(c.fav);
  }
  const classement = Object.entries(totaux).sort((a, b) => b[1].v - a[1].v).slice(0, 10);
  const medailles = ['🥇', '🥈', '🥉'];
  const e = new EmbedBuilder()
    .setColor(0xE91E63)
    .setTitle('🏆 Plus gros harems du serveur')
    .setDescription(classement.length
      ? classement.map(([uid, t], i) => `${medailles[i] || `**${i + 1}.**`} <@${uid}> — ${t.n} perso(s) • 💰 ${nombre(t.v)}`).join('\n')
      : '*Personne n\'a encore claim de personnage.*');
  return interaction.reply({ embeds: [e], allowedMentions: { parse: [] } });
}

// ── /anime daily ────────────────────────────────────────────
async function cmdDaily(interaction) {
  const u = userData(interaction.guildId, interaction.user.id);
  const now = Date.now();
  if (now - (u.lastDaily || 0) < DAILY_COOLDOWN_MS) {
    return interaction.reply(eph(`⏳ Ton daily sera disponible ${ts(u.lastDaily + DAILY_COOLDOWN_MS)}.`));
  }
  u.lastDaily = now;
  u.rolls = ROLLS_MAX;
  u.rollsReset = 0;
  u.lastClaim = 0;
  sauver();
  let gain = '';
  try {
    if (eco.ecoActive(interaction.guildId)) {
      eco.crediter(interaction.guildId, interaction.user.id, DAILY_COINS);
      eco.sauverEco();
      gain = ` et **${eco.fmt(interaction.guildId, DAILY_COINS)}**`;
    }
  } catch (e) { console.error('[Anime] daily :', e.message); }
  return interaction.reply(`🎁 Daily récupéré : tes **${ROLLS_MAX} rolls** et ton **claim** sont remis à zéro${gain} !`);
}

// ── Autocomplétion (nom dans la collection / liste de souhaits) ──
async function handleAutocomplete(interaction) {
  const sub = interaction.options.getSubcommand(false);
  const q = sans(interaction.options.getFocused());
  let items = [];
  if (sub === 'divorce' || sub === 'give') {
    items = harem(interaction.guildId, interaction.user.id).map(c => ({ name: `${c.name} — ${c.series}`.slice(0, 100), value: c.name.slice(0, 100) }));
  } else if (sub === 'wish-remove') {
    items = userData(interaction.guildId, interaction.user.id).wish.map(w => ({ name: w.name.slice(0, 100), value: w.id }));
  }
  return interaction.respond(items.filter(i => sans(i.name).includes(q)).slice(0, 25));
}

// ── Branchement ─────────────────────────────────────────────
function registerAnime(client) {
  client.on('interactionCreate', interaction => {
    try {
      if (interaction.isAutocomplete() && interaction.commandName === 'anime' && interaction.guildId) {
        handleAutocomplete(interaction).catch(() => {});
        return;
      }
      if (!interaction.isButton() || !interaction.customId.startsWith('anime:') || !interaction.guildId) return;
      const [, action, a, b, c] = interaction.customId.split(':');
      let p;
      if (action === 'claim') p = handleClaim(interaction, a);
      else if (action === 'harem') p = handleHarem(interaction, a, b, c);
      else if (action === 'divorce') p = handleDivorce(interaction, a, b);
      else if (action === 'cancel') {
        p = interaction.user.id === b
          ? interaction.update({ content: 'Annulé.', components: [] })
          : interaction.reply(eph('❌ Ce n\'est pas ta confirmation.'));
      }
      p?.catch(e => { if (e?.code !== 10062 && e?.code !== 40060) console.error('[Anime] bouton :', e.message); });
    } catch (e) { console.error('[Anime] interaction :', e.message); }
  });
  console.log('✅ Collection de personnages d\'anime initialisée.');
}

module.exports = { commands: [anime], registerAnime, _test: { rarete, valeur } };