// src/core/threatCounter.js
// Compteur persistant des « menaces bloquées » affiché sur le site (via /statut -> counters.threats_blocked).
// Stocké dans le dossier data/ persistant (comme l'historique d'uptime).
const fs = require('fs');
const path = require('path');

const kv = require('./db');
const NOM = 'data/counters.json';

let counters = kv.lireJson(NOM, {}) || {};
let dirty = false;

const save = () => {
  if (!dirty) return;
  dirty = false;
  try {
    kv.ecrireJson(NOM, counters);
  } catch (e) { console.error('[threatCounter] sauvegarde :', e.message); }
};
setInterval(save, 30 * 1000).unref();
process.on('beforeExit', save);
process.on('exit', save);

module.exports = {
  inc(key = 'threats_blocked', n = 1) { counters[key] = (counters[key] || 0) + n; dirty = true; },
  get(key = 'threats_blocked') { return counters[key] || 0; },
  // threats_blocked est toujours présent (0 au départ) pour que le site affiche « 0 » et non « — »
  all() { return { threats_blocked: 0, ...counters }; },
};