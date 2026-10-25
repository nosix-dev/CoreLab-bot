'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Alertes de cours crypto — rapport de prix envoyé à intervalle régulier
// • Config : economyData[guildId].crypto.alerts (réglée via /crypto-panel → 🔔 Alertes)
// • Source : API publique CoinGecko (sans clé) — 1 seul appel pour toutes les guildes
// ─────────────────────────────────────────────────────────────────────────

const { EmbedBuilder } = require('discord.js');
const { stockage } = require('./data');
const { getGuildBucket, persist } = require('./config');

const COINS = {
  BTC: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', emoji: '🟠' },
  ETH: { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', emoji: '🔷' },
  USDT: { id: 'tether', symbol: 'USDT', name: 'Tether', emoji: '💵' },
  SOL: { id: 'solana', symbol: 'SOL', name: 'Solana', emoji: '🟣' },
  LTC: { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', emoji: '⚪' },
  BNB: { id: 'binancecoin', symbol: 'BNB', name: 'BNB', emoji: '🟡' },
  XRP: { id: 'ripple', symbol: 'XRP', name: 'XRP', emoji: '⚫' },
  DOGE: { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', emoji: '🐕' },
  TON: { id: 'the-open-network', symbol: 'TON', name: 'Toncoin', emoji: '💎' }
};

const INTERVALS = [
  { min: 5, label: '5 minutes' },
  { min: 15, label: '15 minutes' },
  { min: 30, label: '30 minutes' },
  { min: 60, label: '1 heure' },
  { min: 180, label: '3 heures' },
  { min: 360, label: '6 heures' },
  { min: 720, label: '12 heures' },
  { min: 1440, label: '24 heures' }
];

const CURRENCIES = { eur: { symbol: '€', label: 'EUR' }, usd: { symbol: '$', label: 'USD' } };
const MAX_CUSTOM = 5;
const CHECK_EVERY_MS = 60 * 1000;
const API = 'https://api.coingecko.com/api/v3/simple/price';

let backoffUntil = 0; // pause après un 429 (trop de requêtes)

// ── Config ──

function getAlerts(guildId) {
  const bucket = getGuildBucket(guildId, 'economyData', { settings: {}, accounts: {} });
  if (!bucket.crypto || typeof bucket.crypto !== 'object') bucket.crypto = {};
  if (!bucket.crypto.alerts || typeof bucket.crypto.alerts !== 'object') bucket.crypto.alerts = {};
  const a = bucket.crypto.alerts;
  if (a.enabled === undefined) a.enabled = false;
  if (a.channelId === undefined) a.channelId = null;
  if (!INTERVALS.some(i => i.min === a.intervalMin)) a.intervalMin = 60;
  if (!CURRENCIES[a.currency]) a.currency = 'eur';
  if (!Array.isArray(a.coins)) a.coins = [];
  if (!Array.isArray(a.custom)) a.custom = [];
  if (!a.last || typeof a.last !== 'object') a.last = {};
  if (a.lastSent === undefined) a.lastSent = 0;
  return a;
}

// Lecture seule (la tâche de fond ne doit pas créer de données pour les guildes sans alertes)
function peekAlerts(guildId) {
  return stockage.economyData?.[String(guildId)]?.crypto?.alerts || null;
}

function coinMeta(alerts, key) {
  if (COINS[key]) return COINS[key];
  const c = alerts.custom.find(x => `cg:${x.id}` === key);
  return c ? { id: c.id, symbol: c.symbol, name: c.symbol, emoji: '🪙' } : null;
}

function allCoinOptions(alerts) {
  return [
    ...Object.entries(COINS).map(([key, m]) => ({ key, ...m })),
    ...alerts.custom.map(c => ({ key: `cg:${c.id}`, id: c.id, symbol: c.symbol, name: c.symbol, emoji: '🪙' }))
  ];
}

// ── API ──

async function fetchPrices(ids) {
  if (Date.now() < backoffUntil) throw new Error('CoinGecko : trop de requêtes, nouvelle tentative plus tard');
  const url = `${API}?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=eur,usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (res.status === 429) {
    backoffUntil = Date.now() + 5 * 60 * 1000;
    throw new Error('CoinGecko : trop de requêtes (429)');
  }
  if (!res.ok) throw new Error(`CoinGecko : erreur HTTP ${res.status}`);
  return res.json();
}

// ── Mise en forme ──

function formatPrice(n, cur) {
  const digits = n >= 1000 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  const txt = n.toLocaleString('fr-FR', { minimumFractionDigits: n >= 1 ? 2 : 0, maximumFractionDigits: digits });
  return `${txt} ${CURRENCIES[cur].symbol}`;
}

function formatPct(p) {
  const arrow = p > 0.005 ? '🟢 ▲' : p < -0.005 ? '🔴 ▼' : '⚪ ▬';
  return `${arrow} ${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function buildAlertEmbed(alerts, prices) {
  const cur = alerts.currency;
  const lines = [];
  for (const key of alerts.coins) {
    const m = coinMeta(alerts, key);
    if (!m) continue;
    const p = prices?.[m.id];
    const price = p?.[cur];
    if (typeof price !== 'number') {
      lines.push(`${m.emoji} **${m.symbol}** — *cours indisponible*`);
      continue;
    }
    const change24 = p[`${cur}_24h_change`];
    const prev = alerts.last?.[key]?.[cur];
    let line = `${m.emoji} **${m.symbol}** — **${formatPrice(price, cur)}**\n└ 24 h : ${typeof change24 === 'number' ? formatPct(change24) : '—'}`;
    if (typeof prev === 'number' && prev > 0) line += ` • depuis la dernière alerte : ${formatPct(((price - prev) / prev) * 100)}`;
    lines.push(line);
  }
  const label = INTERVALS.find(i => i.min === alerts.intervalMin)?.label || `${alerts.intervalMin} min`;
  return new EmbedBuilder()
    .setTitle('📈 Cours crypto')
    .setDescription(lines.join('\n\n') || '*Aucune crypto suivie.*')
    .setColor(0xFFFFFF)
    .setFooter({ text: `Mise à jour toutes les ${label} • Source : CoinGecko` })
    .setTimestamp();
}

function snapshot(alerts, prices) {
  const last = {};
  for (const key of alerts.coins) {
    const m = coinMeta(alerts, key);
    const p = m && prices?.[m.id];
    if (p && typeof p.eur === 'number') last[key] = { eur: p.eur, usd: p.usd };
  }
  return last;
}

function idsFor(alerts) {
  return [...new Set(alerts.coins.map(k => coinMeta(alerts, k)?.id).filter(Boolean))];
}

// ── Envoi ──

// Aperçu (bouton 🧪) : renvoie l'embed sans toucher aux compteurs d'envoi
async function buildPreview(guildId) {
  const a = getAlerts(guildId);
  const ids = idsFor(a);
  if (!ids.length) throw new Error('Aucune crypto sélectionnée.');
  return buildAlertEmbed(a, await fetchPrices(ids));
}

async function postAlert(guild, alerts, prices) {
  const channel = guild.channels.cache.get(alerts.channelId) || await guild.channels.fetch(alerts.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({ embeds: [buildAlertEmbed(alerts, prices)] });
  alerts.last = snapshot(alerts, prices);
  alerts.lastSent = Date.now();
  persist('economyData');
  return true;
}

async function checkDue(client) {
  const now = Date.now();
  const due = [];
  for (const guild of client.guilds.cache.values()) {
    const a = peekAlerts(guild.id);
    if (!a?.enabled || !a.channelId || !Array.isArray(a.coins) || !a.coins.length) continue;
    if (now - (a.lastSent || 0) < (a.intervalMin || 60) * 60 * 1000 - 5000) continue;
    due.push({ guild, alerts: getAlerts(guild.id) });
  }
  if (!due.length) return;

  const ids = [...new Set(due.flatMap(d => idsFor(d.alerts)))];
  if (!ids.length) return;
  let prices;
  try {
    prices = await fetchPrices(ids);
  } catch (e) {
    console.error('[CryptoAlerts]', e.message);
    return;
  }
  for (const { guild, alerts } of due) {
    try {
      await postAlert(guild, alerts, prices);
    } catch (e) {
      console.error(`[CryptoAlerts] Envoi impossible (guilde ${guild.id}) :`, e.message);
    }
  }
}

function startCryptoAlerts(client) {
  const tick = () => {
    if (!client.isReady()) return;
    checkDue(client).catch(e => console.error('[CryptoAlerts] Erreur boucle :', e.message));
  };
  setInterval(tick, CHECK_EVERY_MS);
  setTimeout(tick, 30 * 1000);
}

module.exports = {
  COINS, INTERVALS, CURRENCIES, MAX_CUSTOM,
  getAlerts, coinMeta, allCoinOptions, idsFor,
  fetchPrices, buildPreview, buildAlertEmbed, startCryptoAlerts, checkDue
};
