'use strict';
/**
 * Historique des mises à jour affiché sur le site (docs#changelog).
 *
 * - À chaque démarrage et à chaque requête GET /changelog, update.json est lu.
 * - Si sa version n'est pas encore dans l'historique, elle y est ajoutée en tête.
 *   Si la version existe déjà mais que le contenu a changé, l'entrée est mise à jour.
 * - L'historique est stocké dans changelog.json (DATA_DIR si défini, sinon racine du projet).
 *   Comme tous les JSON de la racine, il est inclus dans la sauvegarde Discord et restauré au démarrage.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..');
const UPDATE_FILE = path.join(REPO_ROOT, 'update.json');
const DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : REPO_ROOT;
const FILE = path.join(DIR, 'changelog.json');
const MAX_ENTRIES = 100;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error(`[Changelog] lecture de ${path.basename(file)} :`, e.message); return null; }
}

const TYPES = { '+': 'add', '~': 'change', '!': 'warn', 'i': 'info' };

/** { "📨 Section": ["[+] texte", ...] } (ou simple liste) -> [{ title, items: [{ type, text }] }] */
function normalize(modifs) {
  const items = list => (Array.isArray(list) ? list : [list])
    .map(x => String(x ?? '').trim()).filter(Boolean)
    .map(x => {
      const m = x.match(/^\[(.)\]\s*/);
      return { type: (m && TYPES[m[1]]) || 'change', text: m ? x.slice(m[0].length) : x };
    });
  if (Array.isArray(modifs)) return [{ title: null, items: items(modifs) }];
  if (modifs && typeof modifs === 'object') {
    return Object.entries(modifs).map(([title, list]) => ({ title, items: items(list) })).filter(s => s.items.length);
  }
  return [];
}

function entryFrom(data) {
  const version = data.version !== undefined ? String(data.version).trim() : '';
  if (!version) return null;
  const sections = normalize(data.modifications ?? data.changes);
  const entry = {
    version,
    date: String(data.date || new Date().toISOString().slice(0, 10)),
    title: data.titre ? String(data.titre) : null,
    intro: data.intro ? String(data.intro) : null,
    sections,
  };
  entry.hash = crypto.createHash('sha256').update(JSON.stringify({ ...entry })).digest('hex').slice(0, 16);
  return entry;
}

function load() {
  const d = readJson(FILE);
  return Array.isArray(d?.entries) ? d.entries : [];
}

/** Ajoute / met à jour l'entrée de update.json dans l'historique. Ne plante jamais. */
function sync() {
  try {
    const data = readJson(UPDATE_FILE);
    if (!data) { console.warn(`[Changelog] update.json introuvable ou illisible (${UPDATE_FILE}).`); return load(); }
    const entry = entryFrom(data);
    if (!entry) return load();
    const entries = load();
    const i = entries.findIndex(e => e.version === entry.version);
    if (i >= 0) {
      if (entries[i].hash === entry.hash) return entries;
      entries[i] = entry; // même version modifiée : on met à jour en place
    } else {
      entries.unshift(entry); // nouvelle version : en tête
    }
    const out = entries.slice(0, MAX_ENTRIES);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ entries: out }, null, 2), 'utf8');
      console.log(`[Changelog] version ${entry.version} enregistrée (${out.length} entrée(s)).`);
    } catch (e) {
      // Écriture impossible : on renvoie quand même l'historique en mémoire pour que le site l'affiche
      console.error(`[Changelog] écriture de ${FILE} impossible :`, e.message);
    }
    return out;
  } catch (e) {
    console.error('[Changelog] sync impossible :', e.message);
    return load();
  }
}

/** Réponse JSON de GET /changelog */
function getChangelog() {
  const entries = sync();
  return { updatedAt: new Date().toISOString(), entries: entries.map(({ hash, ...e }) => e) };
}

module.exports = { sync, getChangelog };