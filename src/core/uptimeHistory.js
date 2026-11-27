// src/core/uptimeHistory.js
// Historique pour la page de statut : 1 échantillon / minute, agrégé par jour (UTC), 90 jours.
// Composants suivis : bot (connecté à Discord), service (processus + API + dashboard), storage (écriture des données).
// Les minutes où le bot était éteint (redéploiement, crash, veille Render) comptent comme « indisponibles ».
// Garde aussi la latence Discord sur 24 h (1 point / 5 min) et la liste des incidents (coupures d'au moins 1 min).
const fs = require('fs');
const path = require('path');

const HIST_DAYS = 90;
const TICK = 60 * 1000;
const LAT_TICK = 5 * 60 * 1000;
const LAT_KEEP = 24 * 3600 * 1000;
const COMPS = ['bot', 'service', 'storage'];

// Stocké en base SQLite (src/core/db.js) ; la sauvegarde Discord l'inclut sous « data/uptime_history.json ».
const kv = require('./db');
const NOM = 'data/uptime_history.json';

let hist = { last: 0, since: 0, days: {}, lat: [], inc: [] };
try {
  const raw = kv.lireJson(NOM, null);
  if (raw && typeof raw.days === 'object') {
    hist = {
      last: Number(raw.last) || 0,
      since: Number(raw.since) || 0,
      days: raw.days,
      lat: Array.isArray(raw.lat) ? raw.lat : [],
      inc: Array.isArray(raw.inc) ? raw.inc : [],
    };
  }
} catch {}

let storageOk = true;

// up = { bot, service, storage } (storage : undefined = non mesuré)
const record = (ms, up) => {
  const k = new Date(ms).toISOString().slice(0, 10);
  const d = hist.days[k] || (hist.days[k] = { u: 0, t: 0 });
  d.t++; if (up.bot) d.u++;
  for (const [key, f] of [['service', 's'], ['storage', 'd']]) {
    if (up[key] === undefined) continue;
    const c = d[f] || (d[f] = [0, 0]);
    c[1]++; if (up[key]) c[0]++;
  }
};

const keys = () => Object.keys(hist.days).sort().slice(-HIST_DAYS);
const save = () => {
  const keep = {}; keys().forEach((k) => { keep[k] = hist.days[k]; });
  hist.days = keep;
  const minInc = Date.now() - HIST_DAYS * 864e5;
  hist.inc = hist.inc.filter((i) => (i.b || i.a) >= minInc).slice(-100);
  const minLat = Date.now() - LAT_KEEP;
  hist.lat = hist.lat.filter((p) => p[0] >= minLat);
  try {
    kv.ecrireJson(NOM, hist);
    storageOk = true;
  } catch (e) { storageOk = false; console.error('[Uptime] sauvegarde :', e.message); }
};

// Ouvre / ferme les incidents selon l'état de chaque composant.
const track = (t, up) => {
  for (const c of COMPS) {
    if (up[c] === undefined) continue;
    const open = hist.inc.find((i) => i.c === c && !i.b);
    if (!up[c] && !open) hist.inc.push({ c, a: t, b: null });
    else if (up[c] && open) open.b = t;
  }
};

function start(client) {
  const boot = Date.now();
  if (!hist.since) {
    const first = Object.keys(hist.days).sort()[0];
    hist.since = first ? Date.parse(first + 'T00:00:00Z') : boot;
  }
  // Incidents restés ouverts quand le processus s'est arrêté : on les clôt au redémarrage.
  hist.inc.forEach((i) => { if (!i.b) i.b = boot; });
  if (hist.last) {
    for (let t = Math.max(hist.last + TICK, boot - HIST_DAYS * 864e5); t <= boot; t += TICK) record(t, { bot: false, service: false });
    if (boot - hist.last > TICK * 1.5) {
      ['bot', 'service'].forEach((c) => hist.inc.push({ c, a: hist.last + TICK, b: boot }));
    }
  }
  hist.last = boot; save();

  setInterval(() => {
    const t = Date.now();
    const up = { bot: client.isReady() && client.ws.status === 0, service: true, storage: storageOk };
    record(t, up); track(t, up);
    hist.last = t; save();
  }, TICK).unref();

  const sampleLat = () => {
    const p = Math.round(client.ws.ping);
    if (client.isReady() && p >= 0) hist.lat.push([Date.now(), p]);
  };
  setTimeout(sampleLat, 30 * 1000).unref();
  setInterval(sampleLat, LAT_TICK).unref();
}

const getHistory = () => keys().map((k) => ({ d: k, u: hist.days[k].u, t: hist.days[k].t }));

// Composants : { bot:[{d,u,t}], service:[...], storage:[...] }
const getComponents = () => {
  const out = { bot: [], service: [], storage: [] };
  keys().forEach((k) => {
    const d = hist.days[k];
    out.bot.push({ d: k, u: d.u, t: d.t });
    if (d.s) out.service.push({ d: k, u: d.s[0], t: d.s[1] });
    if (d.d) out.storage.push({ d: k, u: d.d[0], t: d.d[1] });
  });
  return out;
};

// Incidents des 30 derniers jours (≥ 1 min), plus récents d'abord ; les composants touchés en même temps sont regroupés.
const getIncidents = () => {
  const now = Date.now(), min = now - 30 * 864e5, groups = [];
  hist.inc.filter((i) => (i.b || now) >= min && (i.b || now) - i.a >= 60 * 1000)
    .sort((x, y) => y.a - x.a)
    .forEach((i) => {
      const g = groups.find((x) => Math.abs(x.a - i.a) <= 90 * 1000 && ((!x.b && !i.b) || (x.b && i.b && Math.abs(x.b - i.b) <= 90 * 1000)));
      if (g) { if (!g.c.includes(i.c)) g.c.push(i.c); }
      else groups.push({ c: [i.c], a: i.a, b: i.b || null });
    });
  return groups.slice(0, 20);
};

const getLatency = () => hist.lat.slice();
const getSince = () => hist.since || 0;

module.exports = { start, getHistory, getComponents, getIncidents, getLatency, getSince };