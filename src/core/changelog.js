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
const kv = require('./db');
const NOM = 'changelog.json';
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
  const d = kv.lireJson(NOM, null);
  return Array.isArray(d?.entries) ? d.entries : [];
}

/** Versions supprimées depuis le blog (elles ne sont plus jamais ré-ajoutées depuis update.json). */
function loadDeleted() {
  const d = kv.lireJson(NOM, null);
  return Array.isArray(d?.deleted) ? d.deleted.map(String) : [];
}

function save(entries, deleted) {
  kv.ecrireJson(NOM, { entries, deleted });
}

/** Ajoute / met à jour l'entrée de update.json dans l'historique. Ne plante jamais. */
function sync() {
  try {
    const data = readJson(UPDATE_FILE);
    if (!data) { console.warn(`[Changelog] update.json introuvable ou illisible (${UPDATE_FILE}).`); return load(); }
    const entry = entryFrom(data);
    if (!entry) return load();
    if (loadDeleted().includes(entry.version)) return load(); // article supprimé : on ne le recrée pas
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
      save(out, loadDeleted());
      console.log(`[Changelog] version ${entry.version} enregistrée (${out.length} entrée(s)).`);
    } catch (e) {
      // Écriture impossible : on renvoie quand même l'historique en mémoire pour que le site l'affiche
      console.error(`[Changelog] écriture de ${NOM} impossible :`, e.message);
    }
    return out;
  } catch (e) {
    console.error('[Changelog] sync impossible :', e.message);
    return load();
  }
}

/** Supprime un article (version) du blog. @returns {boolean} true si l'article existait ou vient d'être masqué */
function supprimer(version) {
  const v = String(version ?? '').trim();
  if (!v || v.length > 40) return false;
  const entries = load();
  const deleted = loadDeleted();
  const reste = entries.filter(e => e.version !== v);
  if (!deleted.includes(v)) deleted.push(v);
  save(reste, deleted.slice(-500));
  console.log(`[Changelog] version ${v} supprimée du blog.`);
  return true;
}

/** Réponse JSON de GET /changelog */
function getChangelog() {
  const entries = sync();
  return { updatedAt: new Date().toISOString(), entries: entries.map(({ hash, ...e }) => e), deleted: loadDeleted() };
}

module.exports = { sync, getChangelog, supprimer };