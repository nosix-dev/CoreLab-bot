const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const {
  getGuildBucket,
  persist
} = require('../core/config');
const {
  getLevelFromXp
} = require('../handlers/xpEngine');
const {
  toCV2Payload
} = require('../core/componentsV2');
const { glassPayload } = require('../core/glassEmbed');
// Carte verre fumé (glassmorphism) à la place de l'embed classique
const gp = (it, payload, extra = {}) => glassPayload(payload, { guild: it.guild, client: it.client, badge: 'ÉCONOMIE', ...extra });
const {
  buildSettingsPayload
} = require('../core/settingsCard');
const {
  isPremium,
  isFounder
} = require('../core/premium');
const {
  generateWalletCardImage
} = require('../handlers/walletCardImage');
const {
  generateLeaderboardImage
} = require('../handlers/leaderboardImage');
const {
  ITEMS,
  CATEGORIES,
  getItem,
  getRarity,
  rollItem,
  getSellValue,
  expectedSellValue,
  formatItem
} = require('../core/collectionItems');
const { getCardImage } = require('../core/pokemonCards');
const { generateReelFrame } = require('../handlers/wheelReelImage');

// ────────────────────────────────────────────────
// Économie CoreLab — casino & mini-jeux (💠 Scarabées)
// Regroupement de toutes les commandes economy en /economy <sous-commande>
// Avant : 12 commandes séparées
// Après : 1 commande /economy avec 17 sous-commandes (dont la collection : roue, collection, vendre, echanger)
// ────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  enabled: true,
  currencyName: 'Scarabée',
  currencyEmoji: '💠',
  dailyAmount: 200,
  dailyCooldownMs: 24 * 60 * 60 * 1000,
  workMin: 80,
  workMax: 220,
  workCooldownMs: 60 * 60 * 1000,
  fishCooldownMs: 10 * 60 * 1000,
  goalAmount: 1000000, // objectif affiché par la barre de progression de /economy wallet
  wheelCost: 100,          // prix d'un tour de /poke-wheel
  wheelCooldownMs: 15000,  // délai entre deux utilisations de /poke-wheel
  sellRatio: 0.5,          // part de la valeur d'un objet reversée lors d'une vente à la boutique
};

// Historique des soldes, utilisé par /economy wallet pour l'évolution
// semaine/mois. Un instantané par compte par jour maximum, conservé 40 jours.
const HISTORY_MAX_ENTRIES = 40;
const HISTORY_MIN_GAP_MS = 20 * 60 * 60 * 1000; // ~20h : évite les doublons si la tâche tourne plusieurs fois/jour

function recordEconomySnapshots(guildId) {
  const bucket = getBucket(guildId);
  const now = Date.now();
  let changed = false;
  for (const uid of Object.keys(bucket.accounts)) {
    const acc = bucket.accounts[uid];
    if (!Array.isArray(acc.history)) acc.history = [];
    const total = (acc.wallet || 0) + (acc.bank || 0);
    const last = acc.history[acc.history.length - 1];
    if (!last || now - last.ts > HISTORY_MIN_GAP_MS) {
      acc.history.push({ ts: now, total });
      if (acc.history.length > HISTORY_MAX_ENTRIES) acc.history.shift();
      changed = true;
    }
  }
  if (changed) saveEconomy();
}

function recordAllEconomySnapshots(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      recordEconomySnapshots(guild.id);
    } catch (e) {
      console.error(`[Eco][Historique] Erreur snapshot guilde ${guild.id}:`, e.message);
    }
  }
}

// Calcule l'évolution du solde sur 7 et 30 jours à partir de l'historique.
// Retourne null pour une valeur tant qu'il n'y a pas de point assez proche
// de la cible temporelle (±3 jours pour la semaine, ±6 jours pour le mois).
function computeEvolution(history, currentTotal) {
  if (!Array.isArray(history) || !history.length) return { weekDelta: null, monthPct: null };
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const closestTo = (targetTs, toleranceMs) => {
    let best = null, bestDiff = Infinity;
    for (const entry of history) {
      const diff = Math.abs(entry.ts - targetTs);
      if (diff < bestDiff) { bestDiff = diff; best = entry; }
    }
    return (best && bestDiff <= toleranceMs) ? best : null;
  };
  const weekPoint = closestTo(now - 7 * DAY, 3 * DAY);
  const monthPoint = closestTo(now - 30 * DAY, 6 * DAY);
  const weekDelta = weekPoint ? currentTotal - weekPoint.total : null;
  const monthPct = (monthPoint && monthPoint.total > 0) ? ((currentTotal - monthPoint.total) / monthPoint.total) * 100 : null;
  return { weekDelta, monthPct };
}

function defaultEconomyBucket() {
  return { settings: { ...DEFAULT_SETTINGS }, accounts: {} };
}

function getBucket(guildId) {
  const bucket = getGuildBucket(guildId, 'economyData', defaultEconomyBucket());
  if (!bucket.settings) bucket.settings = { ...DEFAULT_SETTINGS };
  if (!bucket.accounts) bucket.accounts = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (bucket.settings[key] === undefined) bucket.settings[key] = DEFAULT_SETTINGS[key];
  }
  return bucket;
}

function getSettings(guildId) { return getBucket(guildId).settings; }

function getAccount(guildId, userId) {
  const bucket = getBucket(guildId);
  const uid = String(userId);
  if (!bucket.accounts[uid]) {
    bucket.accounts[uid] = { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0, lastFish: 0, lastSpin: 0, inventory: {} };
  }
  return bucket.accounts[uid];
}

function saveEconomy() { persist('economyData'); }

function getLevelBonus(guildId, userId) {
  const xpBucket = getGuildBucket(guildId, 'xpData', {});
  const xp = xpBucket[String(userId)] || 0;
  const { level } = getLevelFromXp(xp);
  const bonus = Math.min(0.5, level * 0.01);
  return { level, bonus };
}

function formatMoney(amount, settings) {
  return `${Math.floor(amount).toLocaleString('fr-FR')} ${settings.currencyEmoji}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

function checkDisabled(interaction, settings) {
  if (!settings.enabled) {
    interaction.reply({ content: "❌ Le système d'économie est désactivé sur ce serveur.", flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

// ── Blackjack ──
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildShuffledDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardBaseValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handValue(cards) {
  let total = cards.reduce((sum, c) => sum + cardBaseValue(c), 0);
  let aces = cards.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function formatHand(cards, { hideSecond = false } = {}) {
  if (hideSecond) return `${cards[0].rank}${cards[0].suit} 🂠`;
  return cards.map(c => `${c.rank}${c.suit}`).join('  ');
}

// ── Slots ──
const SLOT_SYMBOLS = [
  { emoji: '🍒', weight: 35, pairMult: 1.5, tripleMult: 4 },
  { emoji: '🍋', weight: 28, pairMult: 1.5, tripleMult: 6 },
  { emoji: '🔔', weight: 18, pairMult: 2, tripleMult: 10 },
  { emoji: '⭐', weight: 12, pairMult: 2.5, tripleMult: 20 },
  { emoji: '💎', weight: 5, pairMult: 3, tripleMult: 40 },
  { emoji: '🪲', weight: 2, pairMult: 5, tripleMult: 100 },
];

// ── Pêche ──
const FISH_CATCHES = [
  { name: 'une vieille botte', min: 0, max: 0, weight: 15, emoji: '👢' },
  { name: 'un petit poisson', min: 15, max: 40, weight: 30, emoji: '🐟' },
  { name: 'un poisson bien gras', min: 40, max: 90, weight: 25, emoji: '🐠' },
  { name: 'un crabe surprenant', min: 60, max: 120, weight: 15, emoji: '🦀' },
  { name: 'un poisson doré', min: 150, max: 260, weight: 10, emoji: '🐡' },
  { name: 'un coffre englouti', min: 300, max: 500, weight: 4, emoji: '🧰' },
  { name: 'LE scarabée légendaire des mers', min: 600, max: 900, weight: 1, emoji: '🪲' },
];

const WORK_JOBS = [
  'a livré des colis à travers la ville',
  'a fait des heures sup au fast-food du coin',
  'a promené les chiens du quartier',
  'a donné des cours particuliers',
  'a aidé à déménager un appartement',
  'a fait le taxi pour des amis',
  'a servi des clients au restaurant',
  'a tondu la pelouse des voisins',
  'a lavé des voitures toute la journée',
  'a fait les courses pour une personne âgée',
  'a réparé une fuite chez un particulier',
  'a travaillé comme caissier au supermarché',
  'a gardé des enfants pour la soirée',
  'a peint les volets d\'une maison',
  'a travaillé sur un chantier de construction',
  'a vendu des fruits et légumes au marché',
  'a coupé des cheveux dans un salon de coiffure',
  'a préparé des pizzas pour la soirée',
  'a distribué des journaux dans le quartier',
  'a réparé des vélos dans un atelier',
];

function pickWeighted(list) {
  const totalWeight = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of list) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return list[list.length - 1];
}

// ── Collection (roue, inventaire, ventes, échanges) ──
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getInventory(account) {
  if (!account.inventory || typeof account.inventory !== 'object') account.inventory = {};
  return account.inventory;
}

function countItem(account, itemId) {
  return getInventory(account)[itemId] || 0;
}

function addItem(account, itemId, qty = 1) {
  const inv = getInventory(account);
  inv[itemId] = (inv[itemId] || 0) + qty;
}

function removeItem(account, itemId, qty = 1) {
  const inv = getInventory(account);
  if ((inv[itemId] || 0) < qty) return false;
  inv[itemId] -= qty;
  if (inv[itemId] <= 0) delete inv[itemId];
  return true;
}

// Objets possédés, des plus rares aux plus communs (les ids inconnus du catalogue sont ignorés)
function ownedItems(account) {
  const inv = getInventory(account);
  return Object.entries(inv)
    .map(([id, count]) => ({ item: getItem(id), count }))
    .filter(entry => entry.item && entry.count > 0)
    .sort((a, b) => getRarity(b.item.rarity).order - getRarity(a.item.rarity).order || a.item.name.localeCompare(b.item.name, 'fr'));
}

function progressBar(done, total, length = 10) {
  const filled = total > 0 ? Math.round((done / total) * length) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

function buildOwnedSelect(customId, owned, placeholder, settings) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(owned.slice(0, 25).map(({ item, count }) => ({
        label: `${item.emoji} ${item.name}${count > 1 ? ` ×${count}` : ''}`.slice(0, 100),
        value: item.id,
        description: `${getRarity(item.rarity).label} • rachat ${formatMoney(getSellValue(item, settings.sellRatio), settings)}`.slice(0, 100),
      })))
  );
}

// Attend qu'un membre accepte/refuse une offre (vente ou échange). Le propriétaire de l'offre peut aussi l'annuler.
function waitForDecision(message, { targetId, ownerId, acceptId, declineId, time = 120000 }) {
  return new Promise(resolve => {
    const collector = message.createMessageComponentCollector({ time });
    collector.on('collect', async i => {
      if (i.customId === declineId && (i.user.id === targetId || i.user.id === ownerId)) {
        collector.stop('done');
        return resolve({ decision: 'decline', i });
      }
      if (i.user.id !== targetId) {
        return i.reply({ content: "❌ Cette offre ne t'est pas destinée.", flags: MessageFlags.Ephemeral }).catch(() => { });
      }
      if (i.customId === acceptId) {
        collector.stop('done');
        return resolve({ decision: 'accept', i });
      }
    });
    collector.on('end', (_, reason) => {
      if (reason !== 'done') resolve({ decision: 'timeout', i: null });
    });
  });
}

function offerButtons(acceptId, declineId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(acceptId).setLabel('Accepter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(declineId).setLabel('Refuser').setStyle(ButtonStyle.Danger)
  );
}

function resultEmbed(title, description, color = 0xFFFFFF) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

// ────────────────────────────────────────────────
// Définition de la commande /economy
// ────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('eco')
  .setDescription('Système d\'économie — argent, jeux et classement')
  // ── Actions joueur ──
  .addSubcommand(sub => sub
    .setName('porte-monnaie')
    .setDescription('Voir votre porte-monnaie (ou celui d\'un membre)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à consulter').setRequired(false)))
  .addSubcommand(sub => sub
    .setName('daily')
    .setDescription('Récupérer votre récompense quotidienne'))
  .addSubcommand(sub => sub
    .setName('travailler')
    .setDescription('Travailler pour gagner de l\'argent'))
  .addSubcommand(sub => sub
    .setName('pecher')
    .setDescription('Aller pêcher pour gagner de l\'argent (ou rien du tout...)'))
  .addSubcommand(sub => sub
    .setName('pile-ou-face')
    .setDescription('Miser sur pile ou face, double ou rien')
    .addIntegerOption(o => o.setName('mise').setDescription('Montant à miser').setRequired(true).setMinValue(10))
    .addStringOption(o => o.setName('choix').setDescription('Ton choix').setRequired(true).addChoices({ name: 'Pile', value: 'pile' }, { name: 'Face', value: 'face' })))
  .addSubcommand(sub => sub
    .setName('machine-a-sous')
    .setDescription('Tenter sa chance à la machine à sous')
    .addIntegerOption(o => o.setName('mise').setDescription('Montant à miser').setRequired(true).setMinValue(10)))
  .addSubcommand(sub => sub
    .setName('blackjack')
    .setDescription('Jouer au blackjack contre le croupier')
    .addIntegerOption(o => o.setName('mise').setDescription('Montant à miser').setRequired(true).setMinValue(10)))
  .addSubcommand(sub => sub
    .setName('donner')
    .setDescription('Donner de l\'argent à un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre à qui donner').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Montant à donner').setRequired(true).setMinValue(1)))
  .addSubcommand(sub => sub
    .setName('deposer')
    .setDescription('Déposer de l\'argent de ton portefeuille vers ta banque')
    .addIntegerOption(o => o.setName('montant').setDescription('Montant à déposer').setRequired(true).setMinValue(1)))
  .addSubcommand(sub => sub
    .setName('retirer')
    .setDescription('Retirer de l\'argent de ta banque vers ton portefeuille')
    .addIntegerOption(o => o.setName('montant').setDescription('Montant à retirer').setRequired(true).setMinValue(1)))
  .addSubcommand(sub => sub
    .setName('classement')
    .setDescription('Voir les membres les plus riches du serveur'))
  // ── Collection (la roue est maintenant la commande /poke-wheel) ──
  .addSubcommand(sub => sub
    .setName('collection')
    .setDescription('Voir votre collection (ou celle d\'un membre)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à consulter').setRequired(false)))
  .addSubcommand(sub => sub
    .setName('vendre')
    .setDescription('Vendre un objet à la boutique ou à un membre')
    .addUserOption(o => o.setName('membre').setDescription('Acheteur (laisse vide pour vendre à la boutique)').setRequired(false))
    .addIntegerOption(o => o.setName('prix').setDescription('Prix demandé au membre').setRequired(false).setMinValue(1).setMaxValue(1000000000)))
  .addSubcommand(sub => sub
    .setName('echanger')
    .setDescription('Échanger un objet avec un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre avec qui échanger').setRequired(true)))
  // ── Administration ──
  .addSubcommand(sub => sub
    .setName('ajouter-argent')
    .setDescription('🔒 Admin • Ajouter de l\'argent à un membre (sans limite)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à créditer').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Montant à ajouter').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('compte').setDescription('Où créditer le montant (par défaut : portefeuille)').setRequired(false).addChoices({ name: 'Portefeuille', value: 'wallet' }, { name: 'Banque', value: 'bank' })))
  .addSubcommand(sub => sub
    .setName('config')
    .setDescription('🔒 Admin • Ouvrir le panneau de configuration de l\'économie'));

// ────────────────────────────────────────────────
// Exécution
// ────────────────────────────────────────────────

async function execute(interaction) {
  return runEco(interaction, interaction.options.getSubcommand());
}

// Corps de /economy <sous-commande>. Aussi appelé par /poke-wheel avec la sous-commande 'roue'.
async function runEco(interaction, sub) {

  // ── porte-monnaie ──
  if (sub === 'porte-monnaie') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const settings = getSettings(interaction.guild.id);
    const target = interaction.options.getUser('membre') || interaction.user;
    const account = getAccount(interaction.guild.id, target.id);
    const total = account.wallet + account.bank;
    const { weekDelta, monthPct } = computeEvolution(account.history, total);

    const cardBuffer = await generateWalletCardImage({
      guildId: interaction.guild?.id,
      username: target.username,
      userId: target.id,
      avatarURL: target.displayAvatarURL({ extension: 'png', size: 256 }),
      wallet: account.wallet,
      bank: account.bank,
      total,
      currencyName: settings.currencyName,
      isFounder: isFounder(target.id),
      isPremium: isPremium(target.id),
      goalAmount: settings.goalAmount,
      weekDelta,
      monthPct,
    });
    const attachment = new AttachmentBuilder(cardBuffer, { name: 'porte-monnaie.png' });

    return interaction.editReply({ files: [attachment] });
  }

  // ── daily ──
  if (sub === 'daily') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const account = getAccount(interaction.guild.id, interaction.user.id);
    const now = Date.now();
    const remaining = account.lastDaily + settings.dailyCooldownMs - now;
    if (remaining > 0) {
      return interaction.reply({
        content: `⏳ Tu as déjà récupéré ta récompense. Reviens dans **${formatDuration(remaining)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const { level, bonus } = getLevelBonus(interaction.guild.id, interaction.user.id);
    const gained = Math.round(settings.dailyAmount * (1 + bonus));
    account.wallet += gained;
    account.lastDaily = now;
    saveEconomy();
    const embed = new EmbedBuilder()
      .setTitle('🎁 Récompense quotidienne')
      .setDescription(`${interaction.user} a récupéré **${formatMoney(gained, settings)}** !${bonus > 0 ? `\n✨ Bonus niveau ${level} : +${Math.round(bonus * 100)}%` : ''}`)
      .setColor(0xFFFFFF);
    return interaction.reply(await gp(interaction, { embeds: [embed] }));
  }

  // ── travailler ──
  if (sub === 'travailler') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const account = getAccount(interaction.guild.id, interaction.user.id);
    const now = Date.now();
    const remaining = account.lastWork + settings.workCooldownMs - now;
    if (remaining > 0) {
      return interaction.reply({
        content: `⏳ Tu es fatigué. Retourne travailler dans **${formatDuration(remaining)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const { level, bonus } = getLevelBonus(interaction.guild.id, interaction.user.id);
    const base = Math.floor(Math.random() * (settings.workMax - settings.workMin + 1)) + settings.workMin;
    const gained = Math.round(base * (1 + bonus));
    const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
    account.wallet += gained;
    account.lastWork = now;
    saveEconomy();
    const embed = new EmbedBuilder()
      .setTitle('💼 Travail terminé')
      .setDescription(`${interaction.user} ${job} et a gagné **${formatMoney(gained, settings)}** !${bonus > 0 ? `\n✨ Bonus niveau ${level} : +${Math.round(bonus * 100)}%` : ''}`)
      .setColor(0xFFFFFF);
    return interaction.reply(await gp(interaction, { embeds: [embed] }));
  }

  // ── pecher ──
  if (sub === 'pecher') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const account = getAccount(interaction.guild.id, interaction.user.id);
    const now = Date.now();
    const remaining = account.lastFish + settings.fishCooldownMs - now;
    if (remaining > 0) {
      return interaction.reply({
        content: `⏳ Ta canne à pêche a besoin de repos. Réessaie dans **${formatDuration(remaining)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const { level, bonus } = getLevelBonus(interaction.guild.id, interaction.user.id);
    const catchResult = pickWeighted(FISH_CATCHES);
    const base = catchResult.max > 0 ? Math.floor(Math.random() * (catchResult.max - catchResult.min + 1)) + catchResult.min : 0;
    const gained = Math.round(base * (1 + bonus));
    account.lastFish = now;
    if (gained > 0) account.wallet += gained;
    saveEconomy();
    const embed = new EmbedBuilder()
      .setTitle('🎣 Partie de pêche')
      .setDescription(
        gained > 0
          ? `${interaction.user} a pêché ${catchResult.emoji} **${catchResult.name}** et l'a revendu **${formatMoney(gained, settings)}** !${bonus > 0 ? `\n✨ Bonus niveau ${level} : +${Math.round(bonus * 100)}%` : ''}`
          : `${interaction.user} a pêché ${catchResult.emoji} **${catchResult.name}**... Bredouille cette fois-ci !`
      )
      .setColor(0xFFFFFF);
    return interaction.reply(await gp(interaction, { embeds: [embed] }, { badge: 'CASINO' }));
  }

  // ── pile-ou-face ──
  if (sub === 'pile-ou-face') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const mise = interaction.options.getInteger('mise');
    const choix = interaction.options.getString('choix');
    const account = getAccount(interaction.guild.id, interaction.user.id);
    if (account.wallet < mise) {
      return interaction.reply({
        content: `❌ Tu n'as pas assez d'argent dans ton portefeuille (solde : ${formatMoney(account.wallet, settings)}).`,
        flags: MessageFlags.Ephemeral
      });
    }
    const resultat = Math.random() < 0.5 ? 'pile' : 'face';
    const gagne = resultat === choix;
    account.wallet += gagne ? mise : -mise;
    saveEconomy();
    const embed = new EmbedBuilder()
      .setTitle('🪙 Pile ou face')
      .setDescription(`La pièce tombe sur... **${resultat.toUpperCase()}** !\n\n${gagne ? `🎉 Gagné ! Tu remportes **${formatMoney(mise, settings)}**.` : `💥 Perdu ! Tu perds **${formatMoney(mise, settings)}**.`}\nNouveau solde : **${formatMoney(account.wallet, settings)}**`)
      .setColor(gagne ? 0x00b050 : 0xb00000);
    return interaction.reply(await gp(interaction, { embeds: [embed] }, { badge: 'CASINO' }));
  }

  // ── machine-a-sous ──
  if (sub === 'machine-a-sous') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const mise = interaction.options.getInteger('mise');
    const account = getAccount(interaction.guild.id, interaction.user.id);
    if (account.wallet < mise) {
      return interaction.reply({
        content: `❌ Tu n'as pas assez d'argent dans ton portefeuille (solde : ${formatMoney(account.wallet, settings)}).`,
        flags: MessageFlags.Ephemeral
      });
    }
    const reels = [pickWeighted(SLOT_SYMBOLS), pickWeighted(SLOT_SYMBOLS), pickWeighted(SLOT_SYMBOLS)];
    const display = reels.map(r => r.emoji).join(' | ');
    let gain = 0;
    let resultLine = 'Aucune combinaison. Perdu.';
    if (reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji) {
      gain = Math.round(mise * reels[0].tripleMult);
      resultLine = `🎉 TRIPLE ${reels[0].emoji} ! Jackpot x${reels[0].tripleMult} !`;
    } else if (reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji || reels[0].emoji === reels[2].emoji) {
      const matchSymbol = reels[0].emoji === reels[1].emoji ? reels[0] : reels[0].emoji === reels[2].emoji ? reels[0] : reels[1];
      gain = Math.round(mise * matchSymbol.pairMult);
      resultLine = `✨ Paire ${matchSymbol.emoji} ! x${matchSymbol.pairMult}`;
    }
    account.wallet += gain > 0 ? gain - mise : -mise;
    saveEconomy();
    const embed = new EmbedBuilder()
      .setTitle('🎰 Machine à sous')
      .setDescription(`**[ ${display} ]**\n\n${resultLine}\n\n${gain > 0 ? `Tu remportes **${formatMoney(gain, settings)}** !` : `Tu perds **${formatMoney(mise, settings)}**.`}\nNouveau solde : **${formatMoney(account.wallet, settings)}**`)
      .setColor(gain > 0 ? 0x00b050 : 0xb00000);
    return interaction.reply(await gp(interaction, { embeds: [embed] }, { badge: 'CASINO' }));
  }

  // ── blackjack ──
  if (sub === 'blackjack') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const mise = interaction.options.getInteger('mise');
    const account = getAccount(interaction.guild.id, interaction.user.id);
    if (account.wallet < mise) {
      return interaction.reply({
        content: `❌ Solde insuffisant (portefeuille : ${formatMoney(account.wallet, settings)}).`,
        flags: MessageFlags.Ephemeral
      });
    }
    account.wallet -= mise;
    saveEconomy();
    const deck = buildShuffledDeck();
    const state = {
      mise,
      playerCards: [deck.pop(), deck.pop()],
      dealerCards: [deck.pop(), deck.pop()],
      dealerCardsRevealed: false,
      finished: false,
      doubled: false,
    };
    const hitId = `bj_hit_${interaction.id}`;
    const standId = `bj_stand_${interaction.id}`;
    const doubleId = `bj_double_${interaction.id}`;

    function buildEmbed({ revealDealer = false, footer = '' } = {}) {
      const pv = handValue(state.playerCards);
      const dv = revealDealer || state.dealerCardsRevealed ? handValue(state.dealerCards) : '?';
      return new EmbedBuilder()
        .setTitle('🃏 Blackjack')
        .addFields(
          { name: `Croupier (${dv})`, value: formatHand(state.dealerCards, { hideSecond: !revealDealer && !state.dealerCardsRevealed }), inline: true },
          { name: `Toi (${pv})`, value: formatHand(state.playerCards), inline: true }
        )
        .setFooter({ text: footer || `Mise : ${formatMoney(state.mise, settings)}` })
        .setColor(0xFFFFFF);
    }

    function buildRows(allowDouble) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(hitId).setLabel('Tirer').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(standId).setLabel('Rester').setStyle(ButtonStyle.Secondary),
        ...(allowDouble && account.wallet >= state.mise ? [new ButtonBuilder().setCustomId(doubleId).setLabel('Doubler').setStyle(ButtonStyle.Danger)] : [])
      );
      return [row];
    }

    async function settle(outcome, i) {
      state.finished = true;
      state.dealerCardsRevealed = true;
      let delta = 0;
      let msg = '';
      if (outcome === 'win') {
        delta = state.mise * 2;
        msg = `🎉 Gagné ! Tu remportes **${formatMoney(state.mise, settings)}** !`;
      } else if (outcome === 'push') {
        delta = state.mise;
        msg = '🤝 Égalité ! Mise remboursée.';
      } else {
        msg = `💥 Perdu ! Tu perds **${formatMoney(state.mise, settings)}**.`;
      }
      account.wallet += delta;
      saveEconomy();
      const embed = buildEmbed({ revealDealer: true, footer: `Nouveau solde : ${formatMoney(account.wallet, settings)}` });
      embed.setDescription(msg);
      const bjPayload = await gp(i, { embeds: [embed], components: [] }, { badge: 'CASINO', update: true });
      if (i.update) return i.update(bjPayload);
      return i.editReply(bjPayload);
    }

    async function dealerPlaysAndSettle(i) {
      state.dealerCardsRevealed = true;
      while (handValue(state.dealerCards) < 17) state.dealerCards.push(deck.pop());
      const pv = handValue(state.playerCards);
      const dv = handValue(state.dealerCards);
      let outcome = 'push';
      if (dv > 21 || pv > dv) outcome = 'win';
      else if (dv > pv) outcome = 'lose';
      return settle(outcome, i);
    }

    const playerValue = handValue(state.playerCards);
    if (playerValue === 21) {
      account.wallet += Math.round(mise * 2.5);
      saveEconomy();
      const embed = buildEmbed({ revealDealer: true, footer: `Nouveau solde : ${formatMoney(account.wallet, settings)}` });
      embed.setDescription('🃏 **Blackjack naturel !** Tu remportes x2.5 !');
      return interaction.reply(await gp(interaction, { embeds: [embed] }));
    }

    await interaction.reply(await gp(interaction, { embeds: [buildEmbed()], components: buildRows(true) }, { badge: 'CASINO' }));
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 120000 });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "❌ Ce n'est pas ta partie.", flags: MessageFlags.Ephemeral });
      }
      if (state.finished) return;
      if (i.customId === hitId) {
        state.playerCards.push(deck.pop());
        const value = handValue(state.playerCards);
        if (value > 21) { collector.stop('finished'); return settle('lose', i); }
        if (value === 21) { collector.stop('finished'); return dealerPlaysAndSettle(i); }
        return i.update(await gp(i, { embeds: [buildEmbed()], components: buildRows(false) }, { badge: 'CASINO', update: true }));
      }
      if (i.customId === doubleId) {
        if (account.wallet < state.mise) {
          return i.reply({ content: '❌ Solde insuffisant pour doubler.', flags: MessageFlags.Ephemeral });
        }
        account.wallet -= state.mise;
        state.mise *= 2;
        state.doubled = true;
        saveEconomy();
        state.playerCards.push(deck.pop());
        collector.stop('finished');
        const value = handValue(state.playerCards);
        if (value > 21) return settle('lose', i);
        return dealerPlaysAndSettle(i);
      }
      if (i.customId === standId) {
        collector.stop('finished');
        return dealerPlaysAndSettle(i);
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'finished' || state.finished) return;
      state.dealerCardsRevealed = true;
      while (handValue(state.dealerCards) < 17) state.dealerCards.push(deck.pop());
      const pv = handValue(state.playerCards);
      const dv = handValue(state.dealerCards);
      let outcome = 'push';
      if (dv > 21 || pv > dv) outcome = 'win';
      else if (dv > pv) outcome = 'lose';
      let delta = outcome === 'win' ? state.mise * 2 : outcome === 'push' ? state.mise : 0;
      account.wallet += delta;
      saveEconomy();
      state.finished = true;
      const embed = buildEmbed({ revealDealer: true, footer: `Nouveau solde : ${formatMoney(account.wallet, settings)}` });
      embed.setDescription('⏱️ Temps écoulé — partie terminée automatiquement.');
      try { await interaction.editReply(await gp(interaction, { embeds: [embed], components: [] }, { badge: 'CASINO', update: true })); } catch { }
    });
    return;
  }

  // ── donner ──
  if (sub === 'donner') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const target = interaction.options.getUser('membre');
    const montant = interaction.options.getInteger('montant');
    if (target.id === interaction.user.id || target.bot) {
      return interaction.reply({ content: '❌ Destinataire invalide.', flags: MessageFlags.Ephemeral });
    }
    const source = getAccount(interaction.guild.id, interaction.user.id);
    if (source.wallet < montant) {
      return interaction.reply({
        content: `❌ Solde insuffisant (portefeuille : ${formatMoney(source.wallet, settings)}).`,
        flags: MessageFlags.Ephemeral
      });
    }
    const dest = getAccount(interaction.guild.id, target.id);
    source.wallet -= montant;
    dest.wallet += montant;
    saveEconomy();
    return interaction.reply({ content: `✅ ${interaction.user} a donné **${formatMoney(montant, settings)}** à ${target} !` });
  }

  // ── deposer ──
  if (sub === 'deposer') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const montant = interaction.options.getInteger('montant');
    const account = getAccount(interaction.guild.id, interaction.user.id);
    if (account.wallet < montant) {
      return interaction.reply({ content: `❌ Solde insuffisant dans ton portefeuille.`, flags: MessageFlags.Ephemeral });
    }
    account.wallet -= montant;
    account.bank += montant;
    saveEconomy();
    return interaction.reply({
      content: `🏦 **${formatMoney(montant, settings)}** déposés en banque. (Portefeuille : ${formatMoney(account.wallet, settings)} • Banque : ${formatMoney(account.bank, settings)})`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── retirer ──
  if (sub === 'retirer') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const montant = interaction.options.getInteger('montant');
    const account = getAccount(interaction.guild.id, interaction.user.id);
    if (account.bank < montant) {
      return interaction.reply({ content: `❌ Solde insuffisant en banque.`, flags: MessageFlags.Ephemeral });
    }
    account.bank -= montant;
    account.wallet += montant;
    saveEconomy();
    return interaction.reply({
      content: `💵 **${formatMoney(montant, settings)}** retirés de la banque. (Portefeuille : ${formatMoney(account.wallet, settings)} • Banque : ${formatMoney(account.bank, settings)})`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── classement ──
  if (sub === 'classement') {
    const bucket = getBucket(interaction.guild.id);
    const entries = Object.entries(bucket.accounts)
      .map(([userId, acc]) => ({ userId, total: acc.wallet + acc.bank }))
      .filter(e => e.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    if (!entries.length) {
      return interaction.reply({ content: "📉 Personne n'a encore d'argent sur ce serveur. Utilise `/economy work` ou `/economy daily` pour commencer !" });
    }
    const settings = bucket.settings;
    await interaction.deferReply();
    try {
      // Pseudos + avatars (REST, mis en cache par discord.js)
      const users = await Promise.all(entries.map(e => interaction.client.users.fetch(e.userId).catch(() => null)));
      const cardBuffer = await generateLeaderboardImage({
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        entries: entries.map((e, i) => ({
          name: users[i]?.globalName || users[i]?.username || 'Membre inconnu',
          avatarURL: users[i]?.displayAvatarURL({ extension: 'png', size: 128 }) || null,
          total: e.total
        }))
      });
      const attachment = new AttachmentBuilder(cardBuffer, { name: 'classement.png' });
      return interaction.editReply({ files: [attachment] });
    } catch (e) {
      // Repli : ancien affichage texte si la génération d'image échoue
      console.error('Erreur image classement :', e.message);
      const medals = ['🥇', '🥈', '🥉'];
      const lines = entries.map((e, i) => `${medals[i] || `**${i + 1}.**`} <@${e.userId}> — ${formatMoney(e.total, settings)}`);
      const embed = new EmbedBuilder()
        .setTitle(`🏆 Classement des plus riches — ${interaction.guild.name}`)
        .setDescription(lines.join('\n'))
        .setColor(0xFFFFFF);
      return interaction.editReply(toCV2Payload({ embeds: [embed] }));
    }
  }

  // ── roue ──
  if (sub === 'roue') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const tours = interaction.options.getInteger('tours') || 1;
    const account = getAccount(interaction.guild.id, interaction.user.id);
    const now = Date.now();
    const remaining = (account.lastSpin || 0) + settings.wheelCooldownMs - now;
    if (remaining > 0) {
      return interaction.reply({
        content: `⏳ La roue est encore en train de tourner. Réessaie dans **${formatDuration(remaining)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const cost = settings.wheelCost * tours;
    if (account.wallet < cost) {
      return interaction.reply({
        content: `❌ Il te faut **${formatMoney(cost, settings)}** pour ${tours > 1 ? `${tours} tours` : 'un tour'} (portefeuille : ${formatMoney(account.wallet, settings)}).`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Le paiement et les tirages sont enregistrés AVANT l'animation : impossible de dépenser deux fois.
    account.wallet -= cost;
    account.lastSpin = now;
    const results = [];
    for (let n = 0; n < tours; n++) {
      const item = rollItem();
      const isNew = countItem(account, item.id) === 0;
      addItem(account, item.id, 1);
      results.push({ item, isNew });
    }
    saveEconomy();

    // Rouleau façon "ouverture de caisse" : la bande défile, ralentit, puis s'arrête sur le meilleur tirage.
    const best = results.reduce((a, b) => (getRarity(b.item.rarity).order > getRarity(a.item.rarity).order ? b : a));
    const bestRarity = getRarity(best.item.rarity);
    // Vraie carte Pokémon : recherchée pendant l'animation de la roue (ne la ralentit pas)
    const cardPromise = getCardImage(best.item);
    const STEPS = [4, 4, 3, 3, 2, 2, 1, 1];                       // cases parcourues à chaque image (de plus en plus lent)
    const DELAYS = [650, 650, 700, 750, 850, 1000, 1200, 1500];   // pause avant chaque image (ms)
    const winnerIndex = 4 + STEPS.reduce((a, b) => a + b, 0);
    const strip = Array.from({ length: winnerIndex + 5 }, () => rollItem());
    strip[winnerIndex] = best.item;
    // Bande façon « ouverture de caisse » : une image par étape de l'animation
    const hex = n => `#${n.toString(16).padStart(6, '0')}`;
    const reelStrip = strip.map(it => ({ name: it.name, emoji: it.emoji, color: hex(getRarity(it.rarity).color) }));
    const userName = interaction.user.displayName ?? interaction.user.username;
    const frame = async (c, title, final = false) => new AttachmentBuilder(
      await generateReelFrame({ strip: reelStrip, center: c, title, user: userName, final, guildId: interaction.guildId }),
      { name: 'roue.png' }
    );
    const startText = `**${userName}** lance la roue${tours > 1 ? ` (${tours} tours)` : ''}...`;

    let center = 4;
    await interaction.reply({ content: startText, files: [await frame(center, '🎡 LA ROUE TOURNE...')] });
    for (let k = 0; k < STEPS.length; k++) {
      await sleep(DELAYS[k]);
      center += STEPS[k];
      const title = k < 4 ? '🎡 LA ROUE TOURNE...' : k < STEPS.length - 1 ? '🎡 LA ROUE RALENTIT...' : "🎡 ELLE S'ARRÊTE...";
      try { await interaction.editReply({ content: startText, files: [await frame(center, title)], attachments: [] }); } catch { }
    }
    await sleep(900);
    const realCard = await cardPromise;
    const finalFrame = await frame(winnerIndex, "🎡 LA ROUE S'ARRÊTE !", true).catch(() => null);

    const band = bestRarity.emoji.repeat(bestRarity.order >= 5 ? 10 : 8);
    const footer = `Coût : ${formatMoney(cost, settings)} • Solde : ${formatMoney(account.wallet, settings)}`;
    let finalEmbed;

    if (tours === 1) {
      const { item, isNew } = results[0];
      const category = CATEGORIES[item.category];
      const hype = bestRarity.order >= 5 ? '🎉 **INCROYABLE !** ' : '';
      finalEmbed = new EmbedBuilder()
        .setTitle("🎡 La roue s'arrête !")
        .setDescription(`${band}\n\n${hype}${interaction.user} a obtenu ${item.emoji} **${item.name}** !\n${isNew ? '🆕 **Nouvel objet dans ta collection !**' : `📦 Tu en possèdes maintenant **${countItem(account, item.id)}**.`}`)
        .addFields(
          { name: 'Rareté', value: `${bestRarity.emoji} ${bestRarity.label}`, inline: true },
          { name: 'Catégorie', value: `${category.emoji} ${category.label}`, inline: true },
          { name: 'Rachat boutique', value: formatMoney(getSellValue(item, settings.sellRatio), settings), inline: true }
        )
        .setColor(bestRarity.color)
        .setFooter({ text: footer });
      if (realCard) {
        finalEmbed.setImage(realCard.url);
        finalEmbed.addFields({ name: 'Édition', value: realCard.set || '—', inline: true });
      }
    } else {
      const lines = [...results]
        .sort((a, b) => getRarity(b.item.rarity).order - getRarity(a.item.rarity).order)
        .map(({ item, isNew }) => `${getRarity(item.rarity).emoji} ${item.emoji} **${item.name}**${isNew ? ' 🆕' : ''}`);
      const hype = bestRarity.order >= 5 ? '🎉 **INCROYABLE !** ' : '';
      finalEmbed = new EmbedBuilder()
        .setTitle(`🎡 ${tours} tours de roue`)
        .setDescription(`${band}\n\n${hype}${interaction.user} a obtenu :\n\n${lines.join('\n')}`)
        .setColor(bestRarity.color)
        .setFooter({ text: footer });
      if (realCard) finalEmbed.setImage(realCard.url);
    }
    try {
      // Plus d'embed : la carte de la roue + un texte simple (+ vraie carte Pokémon en lien d'image)
      const d = finalEmbed.toJSON();
      const parts = [];
      if (d.title) parts.push(`**${d.title}**`);
      if (d.description) parts.push(d.description);
      if (d.fields?.length) parts.push(d.fields.map(f => `**${f.name} :** ${f.value}`).join(' • '));
      if (d.footer?.text) parts.push(`-# ${d.footer.text}`);
      if (realCard?.url) parts.push(realCard.url);
      return await interaction.editReply({ content: parts.join('\n').slice(0, 2000), files: finalFrame ? [finalFrame] : [], attachments: [], embeds: [] });
    } catch (e) {
      console.error('[Eco][Roue] Impossible d\'afficher le résultat :', e.message);
      return;
    }
  }

  // ── collection ──
  if (sub === 'collection') {
    const settings = getSettings(interaction.guild.id);
    const target = interaction.options.getUser('membre') || interaction.user;
    const account = getAccount(interaction.guild.id, target.id);
    const owned = ownedItems(account);
    if (!owned.length) {
      return interaction.reply({
        content: target.id === interaction.user.id
          ? '📭 Ta collection est vide. Tente ta chance avec `/poke-wheel` !'
          : `📭 La collection de **${target.username}** est vide.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const ownedMap = new Map(owned.map(({ item, count }) => [item.id, count]));

    const PAGE_SIZE = 30;
    let page = 0;

    function buildCollectionEmbed(view) {
      if (view === 'all') {
        const totalCopies = owned.reduce((sum, e) => sum + e.count, 0);
        const totalValue = owned.reduce((sum, e) => sum + getSellValue(e.item, settings.sellRatio) * e.count, 0);
        const top = owned[0];
        const embed = new EmbedBuilder()
          .setTitle(`📚 Collection de ${target.username}`)
          .setDescription(`**${owned.length}/${ITEMS.length}** cartes différentes découvertes\n${progressBar(owned.length, ITEMS.length, 14)} ${Math.round((owned.length / ITEMS.length) * 100)}%`)
          .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 128 }))
          .setColor(getRarity(top.item.rarity).color);
        for (const category of Object.values(CATEGORIES)) {
          const total = ITEMS.filter(it => it.category === category.id).length;
          const have = owned.filter(e => e.item.category === category.id).length;
          embed.addFields({ name: `${category.emoji} ${category.label}`, value: `${progressBar(have, total)} ${have}/${total}`, inline: true });
        }
        embed.addFields(
          { name: 'Exemplaires', value: String(totalCopies), inline: true },
          { name: 'Valeur de rachat', value: formatMoney(totalValue, settings), inline: true },
          { name: 'Plus belle pièce', value: formatItem(top.item, { withRarity: true }), inline: false }
        );
        return embed;
      }
      const category = CATEGORIES[view];
      const inCategory = ITEMS.filter(it => it.category === view);
      const have = owned.filter(e => e.item.category === view);
      const missing = inCategory.length - have.length;
      const pages = Math.max(1, Math.ceil(have.length / PAGE_SIZE));
      if (page >= pages) page = pages - 1;
      const lines = have
        .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        .map(({ item, count }) => `${getRarity(item.rarity).emoji} ${item.emoji} **${item.name}**${count > 1 ? ` ×${count}` : ''}`);
      return new EmbedBuilder()
        .setTitle(`${category.emoji} ${category.label} — ${target.username}`)
        .setDescription(
          `${progressBar(have.length, inCategory.length, 14)} **${have.length}/${inCategory.length}**\n\n` +
          (lines.length ? lines.join('\n') : '*Rien dans cette catégorie pour l\'instant.*') +
          (missing > 0 ? `\n\n▫️ *${missing} à découvrir...*` : '\n\n✅ **Catégorie complète !**')
        )
        .setFooter({ text: `Page ${page + 1}/${pages}` })
        .setColor(have.length ? getRarity(have[0].item.rarity).color : 0xFFFFFF);
    }

    // ── Visionneuse : image officielle de la carte (comme sur la roue) ──
    const havePokemon = owned.filter(e => e.item.category === 'pokemon');
    const cardCache = new Map(); // item.id -> carte (même image tant que le menu est ouvert)
    let cardIndex = 0;
    let mode = 'list'; // 'list' | 'viewer'

    async function buildViewerEmbed() {
      const { item, count } = havePokemon[cardIndex];
      const rarity = getRarity(item.rarity);
      if (!cardCache.has(item.id)) cardCache.set(item.id, await getCardImage(item));
      const card = cardCache.get(item.id);
      const embed = new EmbedBuilder()
        .setTitle(`${item.emoji} ${item.name}${count > 1 ? ` ×${count}` : ''}`)
        .setDescription(
          `${rarity.emoji} **${rarity.label}**\n` +
          `💰 Rachat : ${formatMoney(getSellValue(item, settings.sellRatio), settings)}` +
          (card?.set ? `\n📦 ${card.set}${card.rarity ? ` • ${card.rarity}` : ''}` : '')
        )
        .setFooter({ text: `Carte ${cardIndex + 1}/${havePokemon.length} • ${target.username}` })
        .setColor(rarity.color);
      if (card?.url) embed.setImage(card.url);
      else embed.addFields({ name: '🖼️ Image', value: 'Image indisponible pour cette carte.' });
      return embed;
    }

    function buildViewerRows() {
      const pageStart = Math.floor(cardIndex / 25) * 25;
      return [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`eco_coll_card_${interaction.id}`)
            .setPlaceholder('Choisir une carte')
            .addOptions(havePokemon.slice(pageStart, pageStart + 25).map(({ item, count }, k) => ({
              label: `${item.emoji} ${item.name}${count > 1 ? ` ×${count}` : ''}`.slice(0, 100),
              value: String(pageStart + k),
              description: getRarity(item.rarity).label,
              default: pageStart + k === cardIndex
            })))
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`eco_coll_cprev_${interaction.id}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(cardIndex <= 0),
          new ButtonBuilder().setCustomId(`eco_coll_cnext_${interaction.id}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(cardIndex >= havePokemon.length - 1),
          new ButtonBuilder().setCustomId(`eco_coll_back_${interaction.id}`).setLabel('Retour à la liste').setEmoji('📚').setStyle(ButtonStyle.Primary)
        )
      ];
    }

    function buildCollectionRows(view) {
      const rows = [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`eco_coll_${interaction.id}`)
            .setPlaceholder('Choisir une catégorie')
            .addOptions([
              { label: '📚 Vue d\'ensemble', value: 'all', default: view === 'all' },
              ...Object.values(CATEGORIES).map(c => ({ label: `${c.emoji} ${c.label}`, value: c.id, default: view === c.id }))
            ])
        )
      ];
      if (view !== 'all') {
        const haveCount = owned.filter(e => e.item.category === view).length;
        const pages = Math.max(1, Math.ceil(haveCount / PAGE_SIZE));
        const buttons = [];
        if (pages > 1) {
          buttons.push(
            new ButtonBuilder().setCustomId(`eco_coll_prev_${interaction.id}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
            new ButtonBuilder().setCustomId(`eco_coll_next_${interaction.id}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
          );
        }
        if (view === 'pokemon' && havePokemon.length) {
          buttons.push(new ButtonBuilder().setCustomId(`eco_coll_view_${interaction.id}`).setLabel('Voir mes cartes').setEmoji('🃏').setStyle(ButtonStyle.Success));
        }
        if (buttons.length) rows.push(new ActionRowBuilder().addComponents(...buttons));
      }
      if (target.id === interaction.user.id) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`eco_coll_wipe_${interaction.id}`).setLabel('Supprimer ma collection').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
        ));
      }
      return rows;
    }

    function buildWipeConfirm() {
      return {
        embeds: [new EmbedBuilder()
          .setTitle('🗑️ Supprimer ta collection ?')
          .setDescription(`Tu vas perdre **${owned.length}** cartes différentes (${owned.reduce((n, e) => n + e.count, 0)} exemplaires).\n⚠️ **Action définitive**, aucun remboursement.`)
          .setColor(0xea4335)],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`eco_coll_wipeyes_${interaction.id}`).setLabel('Oui, tout supprimer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`eco_coll_wipeno_${interaction.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
        )]
      };
    }

    let currentView = 'all';
    await interaction.reply({ embeds: [buildCollectionEmbed('all')], components: buildCollectionRows('all') });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 120000 });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "❌ Ce menu n'est pas le tien. Lance `/economy collection` pour ouvrir le tien.", flags: MessageFlags.Ephemeral });
      }
      const id = i.customId;
      try {
        // ── suppression de la collection ──
        if (id.startsWith('eco_coll_wipe_')) {
          if (target.id !== interaction.user.id) return;
          return await i.update(buildWipeConfirm());
        }
        if (id.startsWith('eco_coll_wipeno_')) {
          return await i.update({ embeds: [buildCollectionEmbed(currentView)], components: buildCollectionRows(currentView) });
        }
        if (id.startsWith('eco_coll_wipeyes_')) {
          if (target.id !== interaction.user.id) return;
          getAccount(interaction.guild.id, interaction.user.id).inventory = {};
          saveEconomy();
          collector.stop('wiped');
          return await i.update({
            embeds: [new EmbedBuilder().setTitle('🗑️ Collection supprimée').setDescription('Ta collection est maintenant vide. Tente ta chance avec `/poke-wheel` !').setColor(0xea4335)],
            components: []
          });
        }
        // ── visionneuse de cartes ──
        if (id.startsWith('eco_coll_view_') || id.startsWith('eco_coll_cprev_') || id.startsWith('eco_coll_cnext_') || id.startsWith('eco_coll_card_')) {
          if (id.startsWith('eco_coll_view_')) { mode = 'viewer'; cardIndex = 0; }
          else if (id.startsWith('eco_coll_cprev_')) cardIndex = Math.max(0, cardIndex - 1);
          else if (id.startsWith('eco_coll_cnext_')) cardIndex = Math.min(havePokemon.length - 1, cardIndex + 1);
          else cardIndex = Math.min(havePokemon.length - 1, Math.max(0, parseInt(i.values[0], 10) || 0));
          await i.deferUpdate();
          return await interaction.editReply({ embeds: [await buildViewerEmbed()], components: buildViewerRows() });
        }
        if (id.startsWith('eco_coll_back_')) {
          mode = 'list';
          return await i.update({ embeds: [buildCollectionEmbed(currentView)], components: buildCollectionRows(currentView) });
        }
        // ── liste par catégorie ──
        if (i.isButton()) {
          page += id.startsWith('eco_coll_next_') ? 1 : -1;
          page = Math.max(0, page);
        } else {
          currentView = i.values[0];
          page = 0;
        }
        mode = 'list';
        return await i.update({ embeds: [buildCollectionEmbed(currentView)], components: buildCollectionRows(currentView) });
      } catch (e) {
        console.error('[Eco][Collection] Erreur :', e.message);
      }
    });
    collector.on('end', async (_c, reason) => {
      if (reason === 'wiped') return;
      try { await interaction.editReply({ components: [] }); } catch { }
    });
    return;
  }

  // ── vendre ──
  if (sub === 'vendre') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const target = interaction.options.getUser('membre');
    const prix = interaction.options.getInteger('prix');
    if ((target && prix === null) || (!target && prix !== null)) {
      return interaction.reply({
        content: '❌ Pour vendre à un membre, renseigne **membre** et **prix**. Pour vendre à la boutique, ne remplis aucun des deux.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (target && (target.id === interaction.user.id || target.bot)) {
      return interaction.reply({ content: '❌ Acheteur invalide.', flags: MessageFlags.Ephemeral });
    }
    const seller = getAccount(interaction.guild.id, interaction.user.id);
    const owned = ownedItems(seller);
    if (!owned.length) {
      return interaction.reply({ content: "📭 Tu n'as rien à vendre. Tente ta chance avec `/poke-wheel` !", flags: MessageFlags.Ephemeral });
    }

    const selectId = `eco_sell_${interaction.id}`;
    await interaction.reply({
      content: (target
        ? `🏷️ Quel objet veux-tu vendre à ${target} pour **${formatMoney(prix, settings)}** ?`
        : '🏷️ Quel objet veux-tu vendre à la boutique ?') + (owned.length > 25 ? '\n*(les 25 objets les plus rares sont affichés)*' : ''),
      components: [buildOwnedSelect(selectId, owned, 'Choisis un objet', settings)],
      flags: MessageFlags.Ephemeral
    });
    const message = await interaction.fetchReply();

    let picked;
    try {
      picked = await message.awaitMessageComponent({ time: 60000, filter: i => i.user.id === interaction.user.id && i.customId === selectId });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, vente annulée.', components: [] }).catch(() => { });
    }
    const itemId = picked.values[0];
    const item = getItem(itemId);
    if (!item || countItem(seller, itemId) < 1) {
      return picked.update({ content: "❌ Tu ne possèdes plus cet objet.", components: [] });
    }
    const rarity = getRarity(item.rarity);

    // ── Vente à la boutique ──
    if (!target) {
      const unit = getSellValue(item, settings.sellRatio);
      const dupes = countItem(seller, itemId) - 1;
      const oneId = `${selectId}_one`;
      const dupId = `${selectId}_dup`;
      const cancelId = `${selectId}_cancel`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(oneId).setLabel(`Vendre 1 (+${unit})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(dupId).setLabel(`Vendre les doublons ×${dupes} (+${unit * dupes})`).setStyle(ButtonStyle.Primary).setDisabled(dupes < 1),
        new ButtonBuilder().setCustomId(cancelId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );
      await picked.update({
        content: '',
        embeds: [resultEmbed('🏪 Boutique', `${formatItem(item, { withRarity: true })}\nPossédé : **×${countItem(seller, itemId)}**\nRachat : **${formatMoney(unit, settings)}** l'unité`, rarity.color)],
        components: [row]
      });
      let btn;
      try {
        btn = await message.awaitMessageComponent({ time: 60000, filter: i => i.user.id === interaction.user.id && [oneId, dupId, cancelId].includes(i.customId) });
      } catch {
        return interaction.editReply({ content: '⏱️ Temps écoulé, vente annulée.', embeds: [], components: [] }).catch(() => { });
      }
      if (btn.customId === cancelId) {
        return btn.update({ content: '❎ Vente annulée.', embeds: [], components: [] });
      }
      const qty = btn.customId === oneId ? 1 : countItem(seller, itemId) - 1;
      if (qty < 1 || countItem(seller, itemId) < qty) {
        return btn.update({ content: "❌ Rien à vendre : ton inventaire a changé.", embeds: [], components: [] });
      }
      removeItem(seller, itemId, qty);
      const gain = unit * qty;
      seller.wallet += gain;
      saveEconomy();
      return btn.update({
        content: `💰 Tu as vendu **${qty}×** ${item.emoji} **${item.name}** pour **${formatMoney(gain, settings)}**. (Portefeuille : ${formatMoney(seller.wallet, settings)})`,
        embeds: [],
        components: []
      });
    }

    // ── Vente à un membre ──
    const acceptId = `${selectId}_accept`;
    const declineId = `${selectId}_decline`;
    await picked.update({ content: `📨 Offre envoyée à ${target}. Elle reste valable 2 minutes.`, components: [] });
    const offerEmbed = new EmbedBuilder()
      .setTitle('🤝 Offre de vente')
      .setDescription(`${interaction.user} te propose ${formatItem(item, { withRarity: true })} pour **${formatMoney(prix, settings)}**.`)
      .setColor(rarity.color)
      .setFooter({ text: 'Offre valable 2 minutes' });
    const offerMessage = await interaction.followUp({
      content: `${target}`,
      embeds: [offerEmbed],
      components: [offerButtons(acceptId, declineId)],
      allowedMentions: { users: [target.id] }
    });
    const { decision, i } = await waitForDecision(offerMessage, { targetId: target.id, ownerId: interaction.user.id, acceptId, declineId });
    if (decision === 'timeout') {
      return offerMessage.edit({ content: '', embeds: [resultEmbed('⏱️ Offre expirée', `${interaction.user} n'a pas reçu de réponse de ${target}.`)], components: [] }).catch(() => { });
    }
    if (decision === 'decline') {
      return i.update({ content: '', embeds: [resultEmbed('❎ Offre annulée', `L'offre de vente de ${item.emoji} **${item.name}** n'a pas abouti.`)], components: [] });
    }
    const buyer = getAccount(interaction.guild.id, target.id);
    if (countItem(seller, itemId) < 1) {
      return i.update({ content: '', embeds: [resultEmbed('❌ Vente impossible', `${interaction.user} ne possède plus cet objet.`)], components: [] });
    }
    if (buyer.wallet < prix) {
      return i.update({ content: '', embeds: [resultEmbed('❌ Vente impossible', `${target} n'a pas assez dans son portefeuille (${formatMoney(buyer.wallet, settings)}).`)], components: [] });
    }
    removeItem(seller, itemId, 1);
    addItem(buyer, itemId, 1);
    buyer.wallet -= prix;
    seller.wallet += prix;
    saveEconomy();
    return i.update({
      content: '',
      embeds: [resultEmbed('✅ Vente conclue', `${target} a acheté ${formatItem(item, { withRarity: true })} à ${interaction.user} pour **${formatMoney(prix, settings)}**.`, rarity.color)],
      components: []
    });
  }

  // ── echanger ──
  if (sub === 'echanger') {
    const settings = getSettings(interaction.guild.id);
    if (checkDisabled(interaction, settings)) return;
    const target = interaction.options.getUser('membre');
    if (target.id === interaction.user.id || target.bot) {
      return interaction.reply({ content: '❌ Destinataire invalide.', flags: MessageFlags.Ephemeral });
    }
    const mine = getAccount(interaction.guild.id, interaction.user.id);
    const theirs = getAccount(interaction.guild.id, target.id);
    const ownedMine = ownedItems(mine);
    const ownedTheirs = ownedItems(theirs);
    if (!ownedMine.length) {
      return interaction.reply({ content: "📭 Ta collection est vide, tu n'as rien à échanger.", flags: MessageFlags.Ephemeral });
    }
    if (!ownedTheirs.length) {
      return interaction.reply({ content: `📭 La collection de **${target.username}** est vide.`, flags: MessageFlags.Ephemeral });
    }

    const baseId = `eco_trade_${interaction.id}`;
    const giveId = `${baseId}_give`;
    const wantId = `${baseId}_want`;
    await interaction.reply({
      content: `🔄 Quel objet veux-tu **donner** à ${target} ?`,
      components: [buildOwnedSelect(giveId, ownedMine, 'Ton objet', settings)],
      flags: MessageFlags.Ephemeral
    });
    const message = await interaction.fetchReply();

    let pickedGive;
    try {
      pickedGive = await message.awaitMessageComponent({ time: 60000, filter: i => i.user.id === interaction.user.id && i.customId === giveId });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, échange annulé.', components: [] }).catch(() => { });
    }
    const giveItem = getItem(pickedGive.values[0]);
    if (!giveItem || countItem(mine, giveItem.id) < 1) {
      return pickedGive.update({ content: '❌ Tu ne possèdes plus cet objet.', components: [] });
    }

    await pickedGive.update({
      content: `🔄 Tu donnes ${formatItem(giveItem)}. Quel objet de **${target.username}** veux-tu en échange ?`,
      components: [buildOwnedSelect(wantId, ownedTheirs, 'Son objet', settings)]
    });
    let pickedWant;
    try {
      pickedWant = await message.awaitMessageComponent({ time: 60000, filter: i => i.user.id === interaction.user.id && i.customId === wantId });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, échange annulé.', components: [] }).catch(() => { });
    }
    const wantItem = getItem(pickedWant.values[0]);
    if (!wantItem || countItem(theirs, wantItem.id) < 1) {
      return pickedWant.update({ content: `❌ ${target.username} ne possède plus cet objet.`, components: [] });
    }
    if (wantItem.id === giveItem.id) {
      return pickedWant.update({ content: '❌ Échanger deux exemplaires du même objet n\'a aucun intérêt.', components: [] });
    }

    const acceptId = `${baseId}_accept`;
    const declineId = `${baseId}_decline`;
    await pickedWant.update({ content: `📨 Proposition d'échange envoyée à ${target}. Elle reste valable 2 minutes.`, components: [] });
    const offerEmbed = new EmbedBuilder()
      .setTitle("🔄 Proposition d'échange")
      .setDescription(`${interaction.user} te propose un échange :\n\n**Il/Elle donne :** ${formatItem(giveItem, { withRarity: true })}\n**Tu donnes :** ${formatItem(wantItem, { withRarity: true })}`)
      .setColor(0xFFFFFF)
      .setFooter({ text: 'Proposition valable 2 minutes' });
    const offerMessage = await interaction.followUp({
      content: `${target}`,
      embeds: [offerEmbed],
      components: [offerButtons(acceptId, declineId)],
      allowedMentions: { users: [target.id] }
    });
    const { decision, i } = await waitForDecision(offerMessage, { targetId: target.id, ownerId: interaction.user.id, acceptId, declineId });
    if (decision === 'timeout') {
      return offerMessage.edit({ content: '', embeds: [resultEmbed('⏱️ Proposition expirée', `${target} n'a pas répondu à ${interaction.user}.`)], components: [] }).catch(() => { });
    }
    if (decision === 'decline') {
      return i.update({ content: '', embeds: [resultEmbed('❎ Échange annulé', "La proposition d'échange n'a pas abouti.")], components: [] });
    }
    if (countItem(mine, giveItem.id) < 1 || countItem(theirs, wantItem.id) < 1) {
      return i.update({ content: '', embeds: [resultEmbed('❌ Échange impossible', "L'un des deux objets n'est plus disponible.")], components: [] });
    }
    removeItem(mine, giveItem.id, 1);
    removeItem(theirs, wantItem.id, 1);
    addItem(mine, wantItem.id, 1);
    addItem(theirs, giveItem.id, 1);
    saveEconomy();
    return i.update({
      content: '',
      embeds: [resultEmbed('✅ Échange conclu', `${interaction.user} reçoit ${formatItem(wantItem, { withRarity: true })}\n${target} reçoit ${formatItem(giveItem, { withRarity: true })}`)],
      components: []
    });
  }

  // ── ajouter-argent (admin) ──
  if (sub === 'ajouter-argent') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Permission insuffisante (Administrateur requis).', flags: MessageFlags.Ephemeral });
    }
    const settings = getSettings(interaction.guild.id);
    const target = interaction.options.getUser('membre');
    const montant = interaction.options.getInteger('montant');
    const compte = interaction.options.getString('compte') || 'wallet';
    const account = getAccount(interaction.guild.id, target.id);
    if (compte === 'bank') account.bank += montant;
    else account.wallet += montant;
    saveEconomy();
    // Réponse visible uniquement par l'admin qui exécute la commande — invisible pour les autres membres.
    return interaction.reply({
      content: `✅ **${formatMoney(montant, settings)}** ajoutés ${compte === 'bank' ? 'à la banque' : 'au portefeuille'} de <@${target.id}>. ` +
        `(Portefeuille : ${formatMoney(account.wallet, settings)} • Banque : ${formatMoney(account.bank, settings)})`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── config (admin) ──
  if (sub === 'config') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Permission insuffisante (Gérer le serveur requis).', flags: MessageFlags.Ephemeral });
    }
    const settings = getSettings(interaction.guild.id);

    function buildDashboardEmbed() {
      return new EmbedBuilder()
        .setTitle("⚙️ Paramètres de l'économie")
        .setDescription("Utilise les boutons ci-dessous pour tout configurer.")
        .addFields(
          { name: 'Statut', value: settings.enabled ? '🟢 Activée' : '🔴 Désactivée', inline: true },
          { name: 'Monnaie', value: `${settings.currencyName} ${settings.currencyEmoji}`, inline: true },
          { name: 'Pêche', value: `Cooldown ${formatDuration(settings.fishCooldownMs)}`, inline: true },
          { name: 'Daily', value: `${formatMoney(settings.dailyAmount, settings)} / ${formatDuration(settings.dailyCooldownMs)}`, inline: true },
          { name: 'Travail', value: `${formatMoney(settings.workMin, settings)} → ${formatMoney(settings.workMax, settings)} / ${formatDuration(settings.workCooldownMs)}`, inline: true },
          { name: 'Roue', value: `${formatMoney(settings.wheelCost, settings)} / tour • cooldown ${formatDuration(settings.wheelCooldownMs)} • rachat ${Math.round(settings.sellRatio * 100)}%`, inline: true }
        )
        .setColor(0xFFFFFF);
    }

    // Panneau complet = carte image (comme /protect-settings) + boutons, en Components V2.
    function buildDashboardPayload(rows = buildDashboardRows()) {
      return buildSettingsPayload({
        guild: interaction.guild,
        embed: buildDashboardEmbed(),
        rows,
        file: 'economie.png',
        scale: 1.7,
        width: 1240,
        cols: 2
      });
    }

    function buildDashboardRows() {
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('eco_toggle').setLabel(settings.enabled ? '⛔ Désactiver' : '✅ Activer').setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('eco_monnaie').setLabel('💠 Monnaie').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('eco_refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('eco_daily').setLabel('🎁 Daily').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('eco_travail').setLabel('💼 Travail').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('eco_peche').setLabel('🎣 Pêche').setStyle(ButtonStyle.Primary)
      );
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('eco_roue').setLabel('🎡 Roue').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('eco_reset').setLabel('🗑️ Réinitialiser un membre').setStyle(ButtonStyle.Danger)
      );
      return [row1, row2, row3];
    }

    async function refreshDashboard() {
      try {
        await interaction.editReply(buildDashboardPayload());
      } catch { }
    }

    const _dash = buildDashboardPayload();
    await interaction.reply({
      ..._dash,
      flags: _dash.flags | MessageFlags.Ephemeral
    });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 300000 });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "❌ Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
      }
      if (i.customId === 'eco_refresh') {
        return i.update(buildDashboardPayload());
      }
      if (i.customId === 'eco_toggle') {
        settings.enabled = !settings.enabled;
        saveEconomy();
        return i.update(buildDashboardPayload());
      }
      if (i.customId === 'eco_monnaie') {
        const modal = new ModalBuilder().setCustomId('eco_monnaie_modal').setTitle('💠 Monnaie du serveur');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nom').setLabel('Nom de la monnaie').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setValue(settings.currencyName)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji de la monnaie').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64).setValue(settings.currencyEmoji))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_monnaie_modal' && mi.user.id === interaction.user.id });
          settings.currencyName = ms.fields.getTextInputValue('nom').trim();
          settings.currencyEmoji = ms.fields.getTextInputValue('emoji').trim();
          saveEconomy();
          await ms.reply({ content: '✅ Monnaie mise à jour.', flags: MessageFlags.Ephemeral });
          await refreshDashboard();
        } catch { }
        return;
      }
      if (i.customId === 'eco_daily') {
        const modal = new ModalBuilder().setCustomId('eco_daily_modal').setTitle('🎁 Récompense quotidienne');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('montant').setLabel('Montant de /economy daily').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue(String(settings.dailyAmount))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (en heures)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(Math.round(settings.dailyCooldownMs / 3600000))))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_daily_modal' && mi.user.id === interaction.user.id });
          const montant = parseInt(ms.fields.getTextInputValue('montant').trim(), 10);
          const heures = parseInt(ms.fields.getTextInputValue('cooldown').trim(), 10);
          if (isNaN(montant) || montant < 0 || isNaN(heures) || heures < 1) {
            return ms.reply({ content: '❌ Valeurs invalides.', flags: MessageFlags.Ephemeral });
          }
          settings.dailyAmount = montant;
          settings.dailyCooldownMs = heures * 3600000;
          saveEconomy();
          await ms.reply({ content: '✅ Récompense quotidienne mise à jour.', flags: MessageFlags.Ephemeral });
          await refreshDashboard();
        } catch { }
        return;
      }
      if (i.customId === 'eco_travail') {
        const modal = new ModalBuilder().setCustomId('eco_travail_modal').setTitle('💼 Gains de /economy work');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Gain minimum').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue(String(settings.workMin))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Gain maximum').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue(String(settings.workMax))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (en minutes)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(String(Math.round(settings.workCooldownMs / 60000))))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_travail_modal' && mi.user.id === interaction.user.id });
          const min = parseInt(ms.fields.getTextInputValue('min').trim(), 10);
          const max = parseInt(ms.fields.getTextInputValue('max').trim(), 10);
          const minutes = parseInt(ms.fields.getTextInputValue('cooldown').trim(), 10);
          if (isNaN(min) || isNaN(max) || min < 0 || max < min || isNaN(minutes) || minutes < 1) {
            return ms.reply({ content: '❌ Valeurs invalides (vérifie que min ≤ max).', flags: MessageFlags.Ephemeral });
          }
          settings.workMin = min;
          settings.workMax = max;
          settings.workCooldownMs = minutes * 60000;
          saveEconomy();
          await ms.reply({ content: '✅ Gains de /economy work mis à jour.', flags: MessageFlags.Ephemeral });
          await refreshDashboard();
        } catch { }
        return;
      }
      if (i.customId === 'eco_peche') {
        const modal = new ModalBuilder().setCustomId('eco_peche_modal').setTitle('🎣 Cooldown de /economy fish');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (en minutes)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(String(Math.round(settings.fishCooldownMs / 60000))))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_peche_modal' && mi.user.id === interaction.user.id });
          const minutes = parseInt(ms.fields.getTextInputValue('cooldown').trim(), 10);
          if (isNaN(minutes) || minutes < 1) {
            return ms.reply({ content: '❌ Valeur invalide.', flags: MessageFlags.Ephemeral });
          }
          settings.fishCooldownMs = minutes * 60000;
          saveEconomy();
          await ms.reply({ content: '✅ Cooldown de /economy fish mis à jour.', flags: MessageFlags.Ephemeral });
          await refreshDashboard();
        } catch { }
        return;
      }
      if (i.customId === 'eco_roue') {
        const modal = new ModalBuilder().setCustomId('eco_roue_modal').setTitle('🎡 Réglages de /poke-wheel');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cout').setLabel('Prix d\'un tour').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue(String(settings.wheelCost))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (en secondes)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(String(Math.round(settings.wheelCooldownMs / 1000)))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ratio').setLabel('Rachat boutique (% de la valeur, 1-100)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(Math.round(settings.sellRatio * 100))))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_roue_modal' && mi.user.id === interaction.user.id });
          const cout = parseInt(ms.fields.getTextInputValue('cout').trim(), 10);
          const secondes = parseInt(ms.fields.getTextInputValue('cooldown').trim(), 10);
          const pct = parseInt(ms.fields.getTextInputValue('ratio').trim(), 10);
          if (isNaN(cout) || cout < 1 || isNaN(secondes) || secondes < 0 || isNaN(pct) || pct < 1 || pct > 100) {
            return ms.reply({ content: '❌ Valeurs invalides (prix ≥ 1, cooldown ≥ 0, rachat entre 1 et 100).', flags: MessageFlags.Ephemeral });
          }
          settings.wheelCost = cout;
          settings.wheelCooldownMs = secondes * 1000;
          settings.sellRatio = pct / 100;
          saveEconomy();
          const expected = expectedSellValue(settings.sellRatio);
          const warning = expected >= cout
            ? `\n⚠️ À ce réglage, revendre ses tirages à la boutique rapporte en moyenne **${Math.round(expected)}** ${settings.currencyEmoji} pour un tour à ${cout} : la roue crée de l'argent. Baisse le rachat ou monte le prix du tour.`
            : '';
          await ms.reply({ content: `✅ Réglages de la roue mis à jour.${warning}`, flags: MessageFlags.Ephemeral });
          await refreshDashboard();
        } catch { }
        return;
      }
      if (i.customId === 'eco_reset') {
        const modal = new ModalBuilder().setCustomId('eco_reset_modal').setTitle('🗑️ Réinitialiser un membre');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('ID du membre').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32))
        );
        await i.showModal(modal);
        try {
          const ms = await i.awaitModalSubmit({ time: 120000, filter: mi => mi.customId === 'eco_reset_modal' && mi.user.id === interaction.user.id });
          const userId = ms.fields.getTextInputValue('user_id').trim();
          if (!/^\d{15,25}$/.test(userId)) {
            return ms.reply({ content: "❌ ID invalide.", flags: MessageFlags.Ephemeral });
          }
          const bucket = getBucket(interaction.guild.id);
          bucket.accounts[userId] = { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0, lastFish: 0, lastSpin: 0, inventory: {} };
          saveEconomy();
          await ms.reply({ content: `✅ Compte économie de <@${userId}> réinitialisé.`, flags: MessageFlags.Ephemeral });
        } catch { }
        return;
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply(buildDashboardPayload([]));
      } catch { }
    });
    return;
  }
}

module.exports = { data, execute, runEco, recordAllEconomySnapshots };