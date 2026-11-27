'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Stockage SQLite du bot (remplace les fichiers JSON de données).
//
//  • Un seul fichier : corelab.db (dans DATA_DIR si défini, sinon à la racine du dépôt).
//    Variable facultative SQLITE_PATH pour choisir un autre emplacement.
//  • Chaque ancien fichier JSON devient une ligne de la table `kv` (nom → JSON).
//    Les noms gardent le chemin d'origine : 'bot_config.json', 'data/counters.json'…
//  • Import automatique : la première fois qu'un nom est demandé et n'existe pas
//    encore en base, l'ancien fichier JSON (DATA_DIR puis dépôt) est lu et importé.
//    Les fichiers d'origine ne sont jamais supprimés (ils servent de filet de sécurité).
//  • Pilote : better-sqlite3 si installé, sinon le module intégré node:sqlite (Node ≥ 22.5).
//  • Écritures : transactionnelles (WAL) → plus de fichier JSON tronqué en cas de coupure.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { DATA_DIR, RACINE_DEPOT } = require('./persistentPath');

const RACINE = DATA_DIR || RACINE_DEPOT;
const CHEMIN_DB = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(RACINE, 'corelab.db');
const DELAI_ECRITURE_MS = 50; // regroupe les écritures rapprochées d'un même nom

let base = null;
let pilote = null;

function ouvrir() {
    if (base) return base;
    fs.mkdirSync(path.dirname(CHEMIN_DB), { recursive: true });

    let brut = null;
    let erreurBetter = null;
    try {
        const Better = require('better-sqlite3');
        brut = new Better(CHEMIN_DB);
        pilote = 'better-sqlite3';
    } catch (e) {
        erreurBetter = e;
        try {
            const { DatabaseSync } = require('node:sqlite');
            brut = new DatabaseSync(CHEMIN_DB);
            pilote = 'node:sqlite';
        } catch (e2) {
            throw new Error(
                'Aucun pilote SQLite disponible. Lance « npm install » (better-sqlite3) ou utilise Node ≥ 22.5. '
                + `(better-sqlite3 : ${erreurBetter.message} ; node:sqlite : ${e2.message})`
            );
        }
    }

    brut.exec('PRAGMA journal_mode = WAL;');
    brut.exec('PRAGMA synchronous = NORMAL;');
    brut.exec('PRAGMA busy_timeout = 5000;');
    brut.exec(`CREATE TABLE IF NOT EXISTS kv (
        name       TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )`);
    brut.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, done_at INTEGER NOT NULL)');

    base = {
        brut,
        lire: brut.prepare('SELECT value FROM kv WHERE name = ?'),
        ecrire: brut.prepare(
            'INSERT INTO kv (name, value, updated_at) VALUES (?, ?, ?) '
            + 'ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ),
        supprimer: brut.prepare('DELETE FROM kv WHERE name = ?'),
        lister: brut.prepare('SELECT name FROM kv ORDER BY name'),
    };
    console.log(`[DB] SQLite prêt (${pilote}) : ${CHEMIN_DB}`);
    return base;
}

function transaction(fn) {
    const { brut } = ouvrir();
    brut.exec('BEGIN');
    try {
        fn();
        brut.exec('COMMIT');
    } catch (e) {
        try { brut.exec('ROLLBACK'); } catch { /* ignoré */ }
        throw e;
    }
}

// ── Écritures différées (regroupées) ────────────────────────────────────
const enAttente = new Map(); // nom → texte JSON
let resolveurs = [];
let minuteur = null;

function planifier(delai) {
    if (minuteur) return;
    minuteur = setTimeout(vider, delai);
    if (minuteur.unref) minuteur.unref();
}

/** Écrit immédiatement tout ce qui est en attente. Sans danger à appeler n'importe quand. */
function vider() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (!enAttente.size) { const r = resolveurs; resolveurs = []; r.forEach(f => f()); return; }
    const lot = [...enAttente];
    enAttente.clear();
    const attente = resolveurs;
    resolveurs = [];
    try {
        const d = ouvrir();
        const maintenant = Date.now();
        transaction(() => { for (const [nom, texte] of lot) d.ecrire.run(nom, texte, maintenant); });
    } catch (e) {
        console.error('[DB] écriture impossible, nouvel essai dans 2 s :', e.message);
        for (const [nom, texte] of lot) if (!enAttente.has(nom)) enAttente.set(nom, texte);
        planifier(2000);
    }
    attente.forEach(f => f());
}

// ── API texte brut ──────────────────────────────────────────────────────
function lireBrut(nom) {
    if (enAttente.has(nom)) return enAttente.get(nom);
    const ligne = ouvrir().lire.get(nom);
    return ligne ? ligne.value : null;
}

/** Écriture synchrone immédiate. */
function ecrireBrut(nom, texte) {
    enAttente.delete(nom); // une écriture différée plus ancienne ne doit pas écraser celle-ci
    ouvrir().ecrire.run(nom, String(texte), Date.now());
}

/** Écriture différée (≈ 50 ms) ; la promesse se résout une fois écrit en base. */
function ecrireDiffere(nom, texte) {
    enAttente.set(nom, String(texte));
    const p = new Promise(resolve => resolveurs.push(resolve));
    planifier(DELAI_ECRITURE_MS);
    return p;
}

function supprimer(nom) {
    enAttente.delete(nom);
    ouvrir().supprimer.run(nom);
}

function noms() {
    vider();
    return ouvrir().lister.all().map(l => l.name);
}

// ── Import des anciens fichiers JSON ────────────────────────────────────
function lireAncienFichier(nom) {
    const candidats = [path.join(RACINE, nom)];
    if (RACINE !== RACINE_DEPOT) candidats.push(path.join(RACINE_DEPOT, nom));
    for (const chemin of candidats) {
        try {
            if (!fs.existsSync(chemin)) continue;
            const texte = fs.readFileSync(chemin, 'utf8');
            JSON.parse(texte); // on n'importe que du JSON valide
            return { texte, chemin };
        } catch (e) {
            console.error(`[DB] ancien fichier ${nom} illisible, ignoré :`, e.message);
        }
    }
    return null;
}

// ── API JSON ────────────────────────────────────────────────────────────
function lireJson(nom, defaut = {}) {
    let texte = lireBrut(nom);
    if (texte == null) {
        const ancien = lireAncienFichier(nom);
        if (ancien) {
            ecrireBrut(nom, ancien.texte);
            texte = ancien.texte;
            console.log(`[DB] ${nom} importé depuis ${path.relative(RACINE_DEPOT, ancien.chemin) || ancien.chemin} (${(Buffer.byteLength(texte) / 1024).toFixed(1)} Ko).`);
        }
    }
    if (texte == null) return structuredClone(defaut);
    try {
        return JSON.parse(texte);
    } catch (e) {
        console.error(`[DB] ${nom} : JSON invalide en base :`, e.message);
        return structuredClone(defaut);
    }
}

/** Écriture synchrone d'une valeur JSON. */
function ecrireJson(nom, valeur) {
    ecrireBrut(nom, JSON.stringify(valeur));
}

// ── Accès SQL direct (modules qui ont leurs propres tables) ─────────────
/** Connexion SQLite brute : exec(), prepare()… (compatible better-sqlite3 et node:sqlite). */
function bd() { return ouvrir().brut; }

function migrationFaite(nom) {
    return !!ouvrir().brut.prepare('SELECT 1 AS ok FROM migrations WHERE name = ?').get(nom);
}
function marquerMigration(nom) {
    ouvrir().brut.prepare('INSERT OR REPLACE INTO migrations (name, done_at) VALUES (?, ?)').run(nom, Date.now());
}

// ── « Fichiers » JSON virtuels ──────────────────────────────────────────
// Les données qui vivent dans de vraies tables (stats d'activité, XP…) restent incluses dans la sauvegarde
// Discord sous leur ancien nom de fichier : exporter() produit le JSON, importer(texte) le recharge dans les tables.
const virtuels = new Map();
function enregistrerVirtuel(nom, definition) { virtuels.set(nom, definition); }
function virtuelsListe() { return virtuels; }

function info() {
    ouvrir();
    let taille = 0;
    try { taille = fs.statSync(CHEMIN_DB).size; } catch { /* ignoré */ }
    return { pilote, chemin: CHEMIN_DB, taille };
}

function fermer() {
    try { vider(); } catch { /* ignoré */ }
    if (!base) return;
    try { base.brut.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignoré */ }
    try { base.brut.close(); } catch { /* ignoré */ }
    base = null;
}

// Dernier filet de sécurité : tout ce qui est en attente est écrit à l'arrêt du processus
// (process.exit, SIGTERM/SIGINT déjà gérés ailleurs dans le bot, fin normale).
process.on('exit', () => { try { vider(); } catch { /* ignoré */ } });

module.exports = {
    lireJson, ecrireJson, lireBrut, ecrireBrut, ecrireDiffere,
    supprimer, noms, vider, fermer, info, CHEMIN_DB,
    bd, transaction, migrationFaite, marquerMigration, enregistrerVirtuel, virtuelsListe,
};
