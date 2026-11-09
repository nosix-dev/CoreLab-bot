'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Quêtes quotidiennes et hebdomadaires
//   /quests                      → tes quêtes du jour et de la semaine + bouton « Tout récupérer »
//   /quests-config toggle        → active / désactive les quêtes sur le serveur
//   /quests-config multiplier    → multiplicateur de récompenses (0.5 à 5)
//   /quests-config reset         → remet à zéro la progression d'un membre
//   /quests-config status        → état de la configuration
//
// Quêtes suivies : messages, minutes en vocal (≥ 2 humains, non sourd), commandes, réactions.
// Reset : minuit, heure de Paris (jour) et lundi minuit (semaine).
// Récompenses : pièces de l'économie du serveur + XP (si le système d'XP est actif).
// Données : quests_data.json  { [guildId]: { enabled, multiplier, users: { [userId]: {...} } } }
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');
const { getGuildBucket, persist, getGuildConfig } = require('../core/config');

const FICHIER = 'quests_data.json';
const COULEUR = 0xE8510D;
const TIMEZONE = 'Europe/Paris';

const DAILY_COUNT = 3;
const WEEKLY_COUNT = 3;
const BONUS_DAY_COINS = 200;
const BONUS_WEEK_COINS = 1000;

const THROTTLE_MESSAGE_MS = 4000;
const THROTTLE_COMMAND_MS = 5000;
const THROTTLE_REACTION_MS = 3000;
const VOICE_TICK_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 10 * 1000;

// ── Catalogue ───────────────────────────────────────────────
// type : messages | voice (minutes) | commands | reactions
const DAILY_POOL = [
  { id: 'd_msg_20',   type: 'messages',  target: 20, coins: 150, xp: 30,  label: 'Envoyer 20 messages' },
  { id: 'd_msg_50',   type: 'messages',  target: 50, coins: 300, xp: 60,  label: 'Envoyer 50 messages' },
  { id: 'd_voice_15', type: 'voice',     target: 15, coins: 150, xp: 30,  label: 'Passer 15 minutes en vocal' },
  { id: 'd_voice_45', type: 'voice',     target: 45, coins: 350, xp: 70,  label: 'Passer 45 minutes en vocal' },
  { id: 'd_cmd_3',    type: 'commands',  target: 3,  coins: 100, xp: 20,  label: 'Utiliser 3 commandes' },
  { id: 'd_react_5',  type: 'reactions', target: 5,  coins: 100, xp: 20,  label: 'Ajouter 5 réactions' }
];
const WEEKLY_POOL = [
  { id: 'w_msg_300',   type: 'messages',  target: 300, coins: 1500, xp: 300, label: 'Envoyer 300 messages' },
  { id: 'w_msg_600',   type: 'messages',  target: 600, coins: 2500, xp: 500, label: 'Envoyer 600 messages' },
  { id: 'w_voice_180', type: 'voice',     target: 180, coins: 1800, xp: 350, label: 'Passer 3 heures en vocal' },
  { id: 'w_voice_420', type: 'voice',     target: 420, coins: 3000, xp: 600, label: 'Passer 7 heures en vocal' },
  { id: 'w_cmd_25',    type: 'commands',  target: 25,  coins: 800,  xp: 150, label: 'Utiliser 25 commandes' },
  { id: 'w_react_40',  type: 'reactions', target: 40,  coins: 700,  xp: 120, label: 'Ajouter 40 réactions' }
];
const TYPE_ICON = { messages: '💬', voice: '🎙️', commands: '⌨️', reactions: '😀' };

// ── Stockage ────────────────────────────────────────────────
const donnees = chargerDonnees(FICHIER, {});
let saveTimer = null;
function sauver() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { sauvegarderDonnees(FICHIER, donnees); } catch (e) { console.error('[Quêtes] sauvegarde :', e.message); }
  }, SAVE_DEBOUNCE_MS);
}
function sauverTout() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { sauvegarderDonnees(FICHIER, donnees); } catch (e) { console.error('[Quêtes] sauvegarde :', e.message); }
}

function guildData(guildId) {
  const g = String(guildId);
  if (!donnees[g]) donnees[g] = { enabled: true, multiplier: 1, users: {} };
  const d = donnees[g];
  if (typeof d.enabled !== 'boolean') d.enabled = true;
  if (typeof d.multiplier !== 'number' || !(d.multiplier > 0)) d.multiplier = 1;
  if (!d.users) d.users = {};
  return d;
}

// ── Temps (heure de Paris) ──────────────────────────────────
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(date = new Date()) {
  return dayFormatter.format(date); // YYYY-MM-DD
}
function weekKey(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // lundi = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

// ── Tirage déterministe (même quêtes pour tout le serveur) ──
function seeded(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function draw(pool, count, seed) {
  const rng = seeded(seed);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const picked = [];
  const types = new Set();
  for (const q of arr) {
    if (picked.length >= count) break;
    if (!types.has(q.type)) { picked.push(q); types.add(q.type); }
  }
  for (const q of arr) {
    if (picked.length >= count) break;
    if (!picked.includes(q)) picked.push(q);
  }
  return picked;
}
const activeCache = new Map();
function activeQuests(guildId, day = dayKey()) {
  const week = weekKey(day);
  const key = `${guildId}|${day}`;
  let hit = activeCache.get(key);
  if (!hit) {
    if (activeCache.size > 50) activeCache.clear();
    hit = {
      day, week,
      daily: draw(DAILY_POOL, DAILY_COUNT, `d|${guildId}|${day}`),
      weekly: draw(WEEKLY_POOL, WEEKLY_COUNT, `w|${guildId}|${week}`)
    };
    activeCache.set(key, hit);
  }
  return hit;
}

// ── Données utilisateur ─────────────────────────────────────
function userData(guildId, userId) {
  const gd = guildData(guildId);
  const uid = String(userId);
  const { day, week } = activeQuests(guildId);
  let u = gd.users[uid];
  if (!u) u = gd.users[uid] = { day, week, d: {}, w: {}, dc: [], wc: [], bonusDay: false, bonusWeek: false, total: 0 };
  if (u.day !== day) { u.day = day; u.d = {}; u.dc = []; u.bonusDay = false; }
  if (u.week !== week) { u.week = week; u.w = {}; u.wc = []; u.bonusWeek = false; }
  return u;
}

function addProgress(guildId, userId, type, amount = 1) {
  const gd = guildData(guildId);
  if (!gd.enabled) return;
  const act = activeQuests(guildId);
  const relevantD = act.daily.filter(q => q.type === type);
  const relevantW = act.weekly.filter(q => q.type === type);
  if (!relevantD.length && !relevantW.length) return;
  const u = userData(guildId, userId);
  for (const q of relevantD) u.d[q.id] = Math.min(q.target, (u.d[q.id] || 0) + amount);
  for (const q of relevantW) u.w[q.id] = Math.min(q.target, (u.w[q.id] || 0) + amount);
  sauver();
}

// ── Récompenses ─────────────────────────────────────────────
function creditCoins(guildId, userId, amount) {
  const bucket = getGuildBucket(guildId, 'economyData', { settings: {}, accounts: {} });
  if (!bucket.accounts) bucket.accounts = {};
  if (!bucket.settings) bucket.settings = {};
  const uid = String(userId);
  if (!bucket.accounts[uid]) bucket.accounts[uid] = { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0, lastFish: 0, lastSpin: 0, inventory: {} };
  bucket.accounts[uid].wallet = (bucket.accounts[uid].wallet || 0) + amount;
  persist('economyData');
  return bucket.settings.currencyEmoji || '🪙';
}
function money(n, emoji) {
  return `${Math.floor(n).toLocaleString('fr-FR')} ${emoji}`;
}

async function creditXp(member, xp) {
  if (!member || xp <= 0) return 0;
  try {
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.xp_enabled) return 0;
    const { grantXp } = require('../handlers/xpHandler');
    await grantXp(member, cfg, Math.floor(xp));
    return Math.floor(xp);
  } catch (e) {
    console.error('[Quêtes] XP :', e.message);
    return 0;
  }
}

function claimable(guildId, u) {
  const act = activeQuests(guildId);
  const out = [];
  for (const q of act.daily) if ((u.d[q.id] || 0) >= q.target && !u.dc.includes(q.id)) out.push({ scope: 'd', q });
  for (const q of act.weekly) if ((u.w[q.id] || 0) >= q.target && !u.wc.includes(q.id)) out.push({ scope: 'w', q });
  return out;
}

async function claimAll(member) {
  const guildId = member.guild.id;
  const gd = guildData(guildId);
  const u = userData(guildId, member.id);
  const list = claimable(guildId, u);
  if (!list.length) return null;
  const act = activeQuests(guildId);
  const mult = gd.multiplier || 1;
  let coins = 0;
  let xp = 0;
  for (const { scope, q } of list) {
    (scope === 'd' ? u.dc : u.wc).push(q.id);
    coins += q.coins * mult;
    xp += q.xp * mult;
    u.total = (u.total || 0) + 1;
  }
  let bonus = 0;
  if (!u.bonusDay && act.daily.every(q => u.dc.includes(q.id))) { u.bonusDay = true; bonus += BONUS_DAY_COINS * mult; }
  if (!u.bonusWeek && act.weekly.every(q => u.wc.includes(q.id))) { u.bonusWeek = true; bonus += BONUS_WEEK_COINS * mult; }
  coins += bonus;
  const emoji = creditCoins(guildId, member.id, coins);
  const gainedXp = await creditXp(member, xp);
  sauverTout();
  return { count: list.length, coins, xp: gainedXp, bonus, emoji };
}

// ── Affichage ───────────────────────────────────────────────
function bar(p, t) {
  const n = 10;
  const filled = Math.round(Math.min(1, p / t) * n);
  return '▰'.repeat(filled) + '▱'.repeat(n - filled);
}

function questLine(q, progress, claimed, mult, emoji) {
  const reward = `${money(q.coins * mult, emoji)} · ${Math.floor(q.xp * mult)} XP`;
  const done = progress >= q.target;
  const state = claimed ? '✅ récupérée' : (done ? '🎁 à récupérer' : `${progress}/${q.target}`);
  return `${TYPE_ICON[q.type] || '🎯'} **${q.label}**\n${bar(progress, q.target)} ${state} — ${reward}`;
}

function buildPanel(guild, userId) {
  const gd = guildData(guild.id);
  const u = userData(guild.id, userId);
  const act = activeQuests(guild.id);
  const mult = gd.multiplier || 1;
  const bucket = getGuildBucket(guild.id, 'economyData', { settings: {}, accounts: {} });
  const emoji = bucket.settings?.currencyEmoji || '🪙';

  const dailyLines = act.daily.map(q => questLine(q, u.d[q.id] || 0, u.dc.includes(q.id), mult, emoji));
  const weeklyLines = act.weekly.map(q => questLine(q, u.w[q.id] || 0, u.wc.includes(q.id), mult, emoji));
  const dayDone = act.daily.filter(q => u.dc.includes(q.id)).length;
  const weekDone = act.weekly.filter(q => u.wc.includes(q.id)).length;

  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle('🎯 Tes quêtes')
    .setDescription('Réinitialisation des quêtes du jour à minuit (heure de Paris), celles de la semaine le lundi à minuit.')
    .addFields(
      { name: `☀️ Quêtes du jour (${dayDone}/${act.daily.length})`, value: dailyLines.join('\n\n').slice(0, 1024) },
      { name: `📅 Quêtes de la semaine (${weekDone}/${act.weekly.length})`, value: weeklyLines.join('\n\n').slice(0, 1024) },
      {
        name: '🏆 Bonus',
        value: `Toutes les quêtes du jour récupérées : **+${money(BONUS_DAY_COINS * mult, emoji)}** ${u.bonusDay ? '✅' : ''}\nToutes les quêtes de la semaine récupérées : **+${money(BONUS_WEEK_COINS * mult, emoji)}** ${u.bonusWeek ? '✅' : ''}`
      }
    )
    .setFooter({ text: `Quêtes terminées au total : ${u.total || 0}${mult !== 1 ? ` • Récompenses ×${mult}` : ''}` });

  const nbClaimable = claimable(guild.id, u).length;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`quest:claimall:${userId}`)
      .setLabel(nbClaimable ? `Tout récupérer (${nbClaimable})` : 'Tout récupérer')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!nbClaimable),
    new ButtonBuilder()
      .setCustomId(`quest:refresh:${userId}`)
      .setLabel('Actualiser')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

// ── Commandes ───────────────────────────────────────────────
const quests = {
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('🎯 Voir tes quêtes quotidiennes et hebdomadaires et récupérer tes récompenses')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Cette commande fonctionne uniquement dans un serveur.', flags: MessageFlags.Ephemeral });
    }
    if (!guildData(interaction.guild.id).enabled) {
      return interaction.reply({ content: '❌ Les quêtes sont désactivées sur ce serveur.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...buildPanel(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
  }
};

const questsConfig = {
  data: new SlashCommandBuilder()
    .setName('quests-config')
    .setDescription('⚙️ Configurer les quêtes du serveur')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('toggle').setDescription('Activer ou désactiver les quêtes')
      .addBooleanOption(o => o.setName('actif').setDescription('Quêtes actives ?').setRequired(true)))
    .addSubcommand(s => s.setName('multiplier').setDescription('Multiplicateur des récompenses (pièces et XP)')
      .addNumberOption(o => o.setName('valeur').setDescription('Entre 0.5 et 5 (1 = normal)').setRequired(true).setMinValue(0.5).setMaxValue(5)))
    .addSubcommand(s => s.setName('reset').setDescription('Remettre à zéro la progression d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s => s.setName('status').setDescription('Voir la configuration des quêtes')),
  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return reply('❌ Cette commande fonctionne uniquement dans un serveur.');
    const p = interaction.memberPermissions;
    if (!p?.has(PermissionFlagsBits.ManageGuild) && !p?.has(PermissionFlagsBits.Administrator)) {
      return reply('❌ Réservé aux administrateurs.');
    }
    const gd = guildData(interaction.guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'toggle') {
      gd.enabled = interaction.options.getBoolean('actif');
      sauverTout();
      return reply(gd.enabled ? '✅ Quêtes **activées**.' : '⏸️ Quêtes **désactivées** (la progression est conservée).');
    }
    if (sub === 'multiplier') {
      gd.multiplier = Math.round(interaction.options.getNumber('valeur') * 100) / 100;
      sauverTout();
      return reply(`✅ Les récompenses sont maintenant multipliées par **${gd.multiplier}**.`);
    }
    if (sub === 'reset') {
      const user = interaction.options.getUser('membre');
      delete gd.users[user.id];
      sauverTout();
      return reply(`✅ Progression des quêtes de ${user} remise à zéro.`);
    }
    const act = activeQuests(interaction.guild.id);
    return reply([
      `**Quêtes :** ${gd.enabled ? '🟢 activées' : '🔴 désactivées'}`,
      `**Multiplicateur :** ×${gd.multiplier}`,
      `**Membres suivis :** ${Object.keys(gd.users).length}`,
      `**Quêtes du jour :** ${act.daily.map(q => q.label).join(' • ')}`,
      `**Quêtes de la semaine :** ${act.weekly.map(q => q.label).join(' • ')}`
    ].join('\n'));
  }
};

// ── Écouteurs ───────────────────────────────────────────────
const lastHit = new Map();
function throttled(key, ms) {
  const now = Date.now();
  if (now - (lastHit.get(key) || 0) < ms) return true;
  lastHit.set(key, now);
  if (lastHit.size > 5000) {
    for (const [k, t] of lastHit) if (now - t > 60000) lastHit.delete(k);
  }
  return false;
}

async function handleButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  if (!interaction.guild) return;
  if (ownerId && ownerId !== interaction.user.id) {
    return interaction.reply({ content: '❌ Ce panneau n\'est pas le tien : fais /quests.', flags: MessageFlags.Ephemeral });
  }
  if (!guildData(interaction.guild.id).enabled) {
    return interaction.update({ content: '❌ Les quêtes sont désactivées sur ce serveur.', embeds: [], components: [] });
  }
  if (action === 'claimall') {
    await interaction.deferUpdate();
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const res = member ? await claimAll(member) : null;
    await interaction.editReply(buildPanel(interaction.guild, interaction.user.id));
    if (res) {
      const parts = [`🎁 **${res.count}** quête(s) récupérée(s) : **+${money(res.coins, res.emoji)}**`];
      if (res.xp) parts.push(`**+${res.xp} XP**`);
      if (res.bonus) parts.push(`dont bonus **${money(res.bonus, res.emoji)}**`);
      return interaction.followUp({ content: parts.join(' • '), flags: MessageFlags.Ephemeral });
    }
    return interaction.followUp({ content: '❌ Aucune quête à récupérer pour le moment.', flags: MessageFlags.Ephemeral });
  }
  return interaction.update(buildPanel(interaction.guild, interaction.user.id));
}

function registerQuests(client) {
  client.on('messageCreate', message => {
    try {
      if (!message.guild || message.author?.bot || message.webhookId) return;
      if ((message.content || '').trim().length < 4 && !message.attachments?.size) return;
      if (throttled(`m:${message.guild.id}:${message.author.id}`, THROTTLE_MESSAGE_MS)) return;
      addProgress(message.guild.id, message.author.id, 'messages', 1);
    } catch (e) { console.error('[Quêtes] message :', e.message); }
  });

  client.on('messageReactionAdd', (reaction, user) => {
    try {
      const guildId = reaction.message?.guildId;
      if (!guildId || user.bot) return;
      if (throttled(`r:${guildId}:${user.id}`, THROTTLE_REACTION_MS)) return;
      addProgress(guildId, user.id, 'reactions', 1);
    } catch (e) { console.error('[Quêtes] réaction :', e.message); }
  });

  client.on('interactionCreate', interaction => {
    try {
      if (interaction.isChatInputCommand() && interaction.guildId) {
        const name = interaction.commandName;
        if (name === 'quests' || name === 'quests-config') return;
        if (throttled(`c:${interaction.guildId}:${interaction.user.id}`, THROTTLE_COMMAND_MS)) return;
        addProgress(interaction.guildId, interaction.user.id, 'commands', 1);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('quest:')) {
        handleButton(interaction).catch(e => {
          if (e?.code !== 10062) console.error('[Quêtes] bouton :', e.message);
        });
      }
    } catch (e) { console.error('[Quêtes] interaction :', e.message); }
  });

  // Vocal : +1 minute par minute passée dans un salon avec au moins 2 humains (hors AFK, hors sourd)
  setInterval(() => {
    try {
      for (const guild of client.guilds.cache.values()) {
        const states = guild.voiceStates?.cache;
        if (!states?.size || !guildData(guild.id).enabled) continue;
        const byChannel = new Map();
        for (const vs of states.values()) {
          if (!vs.channelId || vs.member?.user?.bot || vs.channelId === guild.afkChannelId) continue;
          if (!byChannel.has(vs.channelId)) byChannel.set(vs.channelId, []);
          byChannel.get(vs.channelId).push(vs);
        }
        for (const group of byChannel.values()) {
          if (group.length < 2) continue;
          for (const vs of group) {
            if (vs.selfDeaf || vs.serverDeaf) continue;
            addProgress(guild.id, vs.id, 'voice', 1);
          }
        }
      }
    } catch (e) { console.error('[Quêtes] tick vocal :', e.message); }
  }, VOICE_TICK_MS);

  console.log('✅ Quêtes quotidiennes et hebdomadaires initialisées.');
}

module.exports = { commands: [quests, questsConfig], registerQuests, _test: { draw, weekKey, dayKey, DAILY_POOL, WEEKLY_POOL } };
