'use strict';

// ───────────────────────────────────────────────────────────
// Vraies cartes Pokémon (images officielles du JCC, en français) pour la roue /economy
//  - source : API TCGdex (api.tcgdex.net) — gratuite, SANS clé, SANS inscription
//  - recherche par nom français (celui du catalogue, sans « Carte ») : « Bulbizarre », « Pikachu »…
//  - 1 liste par Pokémon + quelques détails de cartes (rareté) mis en cache sur disque
//    (src/data/tcgdex_cards_cache.json) : les tirages suivants n'ont plus besoin du réseau
//  - une carte est choisie au hasard, de préférence d'une rareté proche de celle du tirage
//
// const card = await getCardImage(item);   // item = objet du catalogue (collectionItems)
// -> { url, name, set, rarity } ou null (pas de carte trouvée / API indisponible)
// ───────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const API = 'https://api.tcgdex.net/v2';
const CACHE_FILE = path.join(__dirname, '..', 'data', 'tcgdex_cards_cache.json');
const TIMEOUT_MS = 8000;
const SAMPLE = 6; // nombre de cartes comparées pour trouver la bonne rareté

// Noms du catalogue différents de ceux de TCGdex
const NAME_FIX = {
  'Nidoran femelle': 'Nidoran♀',
  'Nidoran mâle': 'Nidoran♂'
};

// Cartes spéciales du catalogue (nom exact de l'objet -> carte précise ou recherche)
const SPECIALS = {
  'Carte Dracaufeu holo 1re édition': { id: 'base1-4' },
  'Carte Pikachu Illustrateur': { name: 'Pikachu Illustrateur', fallback: 'Pikachu' }
};

// Rareté visée selon la rareté du tirage (0 = commune … 5 = ultra rare)
const TARGET_RANK = { commun: 0, peu_commun: 1, rare: 2, epique: 3, legendaire: 4, mythique: 5 };

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function rankOf(rarity) {
  const r = norm(rarity);
  if (!r) return 2;
  if (/secret|hyper|rainbow|arc-en-ciel|gold|doree|special illustration|illustration speciale|couronne|crown/.test(r)) return 5;
  if (/ultra|illustration|amazing|vmax|vstar|\bex\b|\bgx\b|legend|prime|radiant|chromatique|shiny/.test(r)) return 4;
  if (/holo|double rare/.test(r)) return 3;
  if (/peu commun|uncommon/.test(r)) return 1;
  if (/commun|common/.test(r)) return 0;
  if (/rare/.test(r)) return 2;
  return 2;
}

// ── cache ──
let cache = {};
try {
  if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
} catch { cache = {}; }

let saveTimer = null;
function saveCache() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    } catch (e) {
      console.error('[PokemonCards] Cache non enregistré :', e.message);
    }
  }, 2000);
  saveTimer.unref?.();
}

// ── API TCGdex ──
async function getJson(url) {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('[PokemonCards] API indisponible :', e.message);
    return null; // rien n'est mis en cache : nouvel essai au prochain tirage
  }
}

const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Liste des cartes d'un Pokémon : [{ id, image }]
function listByName(name, lang = 'fr') {
  const BASE = `${API}/${lang}`;
  const key = lang === 'fr' ? `n:${name}` : `n:${lang}:${name}`;
  if (cache[key]) return Promise.resolve(cache[key]);
  return once(key, async () => {
    const enc = encodeURIComponent(name);
    let found = await getJson(`${BASE}/cards?name=eq:${enc}`);
    if (found === null) return null;
    if (!Array.isArray(found) || !found.length) {
      // recherche large, puis on ne garde que les noms qui commencent pareil
      const lax = await getJson(`${BASE}/cards?name=${enc}`);
      if (lax === null) return null;
      found = (Array.isArray(lax) ? lax : []).filter(c => norm(c.name).startsWith(norm(name)));
    }
    const list = found.filter(c => c?.id && c?.image).map(c => ({ id: c.id, image: c.image }));
    cache[key] = list;
    saveCache();
    return list;
  });
}

// Liste des cartes d'un Pokémon par numéro de Pokédex (indépendant de la langue / de l'orthographe du nom)
function listByDex(dex, lang) {
  const key = `x:${lang}:${dex}`;
  if (cache[key]) return Promise.resolve(cache[key]);
  return once(key, async () => {
    const found = await getJson(`${API}/${lang}/cards?dexId=eq:${dex}`);
    if (found === null) return null;
    const list = (Array.isArray(found) ? found : []).filter(c => c?.id && c?.image).map(c => ({ id: c.id, image: c.image }));
    cache[key] = list;
    saveCache();
    return list;
  });
}

// Détails d'une carte : { name, rarity, set, image }
function cardDetails(id, lang = 'fr') {
  const key = lang === 'fr' ? `d:${id}` : `d:${lang}:${id}`;
  if (cache[key]) return Promise.resolve(cache[key]);
  return once(key, async () => {
    const c = await getJson(`${API}/${lang}/cards/${encodeURIComponent(id)}`);
    if (!c || !c.image) return null;
    const d = { name: c.name || '', rarity: c.rarity || '', set: c.set?.name || '', image: c.image };
    cache[key] = d;
    saveCache();
    return d;
  });
}

// Certaines cartes n'ont pas de « high.png » sur le CDN (404) : l'embed s'affichait alors
// sans image. On teste donc plusieurs variantes et on garde la première qui répond.
const VARIANTS = ['high.png', 'high.webp', 'low.png', 'low.webp'];
const okImages = new Map(); // base -> url valide | null

async function urlExists(url) {
  if (typeof fetch !== 'function') return true;
  try {
    let res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveImage(image) {
  if (!image) return null;
  if (okImages.has(image)) return okImages.get(image);
  for (const v of VARIANTS) {
    const url = `${image}/${v}`;
    if (await urlExists(url)) {
      okImages.set(image, url);
      return url;
    }
  }
  okImages.set(image, null);
  return null;
}

async function pick(list, rarityId, lang = 'fr') {
  const target = TARGET_RANK[rarityId] ?? 0;
  const sample = [...list].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  const details = (await Promise.all(sample.map(c => cardDetails(c.id, lang)))).filter(Boolean);

  // Candidats classés : écart de rareté croissant (au hasard à égalité), puis le reste de la liste
  const ranked = details
    .map(d => ({ d, gap: Math.abs(rankOf(d.rarity) - target), r: Math.random() }))
    .sort((x, y) => x.gap - y.gap || x.r - y.r)
    .map(x => ({ url: null, image: x.d.image, name: x.d.name, set: x.d.set, rarity: x.d.rarity }));
  const seen = new Set(ranked.map(c => c.image));
  for (const c of list) {
    if (!seen.has(c.image)) ranked.push({ image: c.image, name: '', set: '', rarity: '' });
  }

  for (const c of ranked.slice(0, 12)) {
    const url = await resolveImage(c.image);
    if (url) return { url, name: c.name, set: c.set, rarity: c.rarity };
  }
  return null;
}

// N° de Pokédex = position dans le catalogue (les 1025 Pokémon sont dans l'ordre, les 2 cartes spéciales à la fin)
let dexMap = null;
function dexOf(item) {
  if (!dexMap) {
    dexMap = new Map();
    try {
      const { ITEMS } = require('./collectionItems');
      ITEMS.filter(i => i.category === 'pokemon' && !SPECIALS[i.name]).forEach((i, k) => dexMap.set(i.id, k + 1));
    } catch { /* sans n° de Pokédex : seule la recherche par nom est utilisée */ }
  }
  return dexMap.get(item.id) || null;
}

async function getCardImage(item) {
  try {
    if (!item || item.category !== 'pokemon') return null;

    const special = SPECIALS[item.name];
    if (special?.id) {
      const d = await cardDetails(special.id);
      const url = d ? await resolveImage(d.image) : null;
      return url ? { url, name: d.name, set: d.set, rarity: d.rarity } : null;
    }

    let name = String(item.name).replace(/^Carte\s+/i, '');
    if (special?.name) {
      const list = await listByName(special.name);
      if (list && list.length) return await pick(list, item.rarity);
      name = special.fallback;
    }
    name = NAME_FIX[name] || name;

    // 1) nom français, 2) n° de Pokédex en français, 3) n° de Pokédex en anglais
    // (le catalogue anglais est plus complet). On passe à l'étape suivante si rien ne donne d'image valide.
    const dex = dexOf(item);
    const essais = [() => listByName(name, 'fr').then(l => [l, 'fr'])];
    if (dex) {
      essais.push(() => listByDex(dex, 'fr').then(l => [l, 'fr']));
      essais.push(() => listByDex(dex, 'en').then(l => [l, 'en']));
    }
    for (const essai of essais) {
      const [list, lang] = await essai();
      if (!list || !list.length) continue;
      const res = await pick(list, item.rarity, lang);
      if (res) return res;
    }
    console.warn(`[PokemonCards] Aucune image trouvée pour « ${item.name} » (n°${dex ?? '?'})`);
    return null;
  } catch (e) {
    console.error('[PokemonCards] Erreur :', e.message);
    return null;
  }
}

module.exports = { getCardImage };