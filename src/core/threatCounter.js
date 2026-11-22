// src/core/threatCounter.js
// Compteur persistant des « menaces bloquées » affiché sur le site (via /statut -> counters.threats_blocked).
// Stocké dans le dossier data/ persistant (comme l'historique d'uptime).
const fs = require('fs');
const path = require('path');

let FILE;
try { FILE = path.join(require('./persistentPath').dossierPersistant('data'), 'counters.json'); }
catch { FILE = path.join(__dirname, '..', '..', 'data', 'counters.json'); }
try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch {}

let counters = {};
try { counters = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch {}
let dirty = false;

const save = () => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(counters));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[threatCounter] sauvegarde :', e.message); }
};
setInterval(save, 30 * 1000).unref();
process.on('beforeExit', save);

module.exports = {
  inc(key = 'threats_blocked', n = 1) { counters[key] = (counters[key] || 0) + n; dirty = true; },
  get(key = 'threats_blocked') { return counters[key] || 0; },
  all() { return { ...counters }; },
};
