// Construction / restauration des paquets de sauvegarde (fichiers JSON et images du bot).
// Utilisé par restore.js (au démarrage) et par discordBackup.js (sauvegardes régulières).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dossierPersistant, DATA_DIR, RACINE_DEPOT } = require('./persistentPath');

const RACINE = DATA_DIR || RACINE_DEPOT;
if (DATA_DIR) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignoré */ } }
// clé du dossier -> [chemin relatif dans le dépôt, nom dans DATA_DIR]
const DOSSIERS = {
    data: ['data'],
    welcome_images: ['welcome_images'],
    goodbye_images: ['goodbye_images'],
    xp_images: ['xp_images'],
    card_backgrounds: ['card_backgrounds'],
    form_images: ['src/data/form_images', 'form_images'],
    ticket_images: ['src/data/ticket_images', 'ticket_images'],
    protect_images: ['src/data/protect_images', 'protect_images'],
    scheduled_images: ['src/data/scheduled_images', 'scheduled_images'],
};
const EXCLUS_RACINE = new Set(['package.json', 'package-lock.json', 'update.json']); // gérés par le dépôt
const EXT_OK = /\.(json|png|jpe?g|gif|webp|mp4)$/i;
const MAX_FICHIER = 4 * 1024 * 1024;
const MAX_PARTIE = 6 * 1024 * 1024; // taille max (avant compression) d'un fichier de sauvegarde envoyé sur Discord

const cacheDossiers = {};
function dossier(nom) {
    if (!DOSSIERS[nom]) return null;
    if (!cacheDossiers[nom]) cacheDossiers[nom] = dossierPersistant(...DOSSIERS[nom]);
    return cacheDossiers[nom];
}

function parcourir(base, relatif = '', sortie = []) {
    let entrees = [];
    try { entrees = fs.readdirSync(path.join(base, relatif), { withFileTypes: true }); } catch { return sortie; }
    for (const e of entrees) {
        const rel = relatif ? `${relatif}/${e.name}` : e.name;
        if (e.isDirectory()) parcourir(base, rel, sortie);
        else if (e.isFile() && EXT_OK.test(e.name)) sortie.push(rel);
    }
    return sortie;
}

// kind 'data' : JSON de la racine + dossier data/ ; kind 'images' : tous les dossiers d'images
function lister(kind) {
    const out = [];
    if (kind === 'data') {
        let noms = [];
        try { noms = fs.readdirSync(RACINE); } catch { /* dossier absent */ }
        for (const nom of noms) {
            if (!nom.endsWith('.json') || EXCLUS_RACINE.has(nom)) continue;
            const abs = path.join(RACINE, nom);
            try { if (fs.statSync(abs).isFile()) out.push({ key: `root/${nom}`, abs }); } catch { /* ignoré */ }
        }
        const d = dossier('data');
        if (d) for (const rel of parcourir(d)) out.push({ key: `data/${rel}`, abs: path.join(d, rel) });
    } else {
        for (const nom of Object.keys(DOSSIERS)) {
            if (nom === 'data') continue;
            const d = dossier(nom);
            if (d) for (const rel of parcourir(d)) out.push({ key: `${nom}/${rel}`, abs: path.join(d, rel) });
        }
    }
    return out;
}

// Retourne { hash, parties: [ {files:{key:{e,d}}} ... ] } (plusieurs parties si trop volumineux)
function construire(kind) {
    const hash = crypto.createHash('sha1');
    const parties = [];
    let courante = { files: {}, taille: 0 };
    for (const f of lister(kind)) {
        let buf;
        try { buf = fs.readFileSync(f.abs); } catch { continue; }
        if (buf.length > MAX_FICHIER) { console.warn(`[Backup] ${f.key} ignoré (trop lourd : ${(buf.length / 1048576).toFixed(1)} Mo)`); continue; }
        hash.update(f.key).update(buf);
        const texte = f.key.endsWith('.json');
        const entree = texte ? { e: 'u', d: buf.toString('utf8') } : { e: 'b', d: buf.toString('base64') };
        const poids = entree.d.length;
        if (courante.taille + poids > MAX_PARTIE && Object.keys(courante.files).length) {
            parties.push(courante);
            courante = { files: {}, taille: 0 };
        }
        courante.files[f.key] = entree;
        courante.taille += poids;
    }
    if (Object.keys(courante.files).length || !parties.length) parties.push(courante);
    return { hash: hash.digest('hex'), parties };
}

// Écrit les fichiers d'un paquet au bon endroit (avec contrôles de chemin). Retourne le nombre de fichiers écrits.
function appliquer(files) {
    let n = 0;
    for (const [key, entree] of Object.entries(files || {})) {
        try {
            const i = key.indexOf('/');
            if (i < 1) continue;
            const racineCle = key.slice(0, i);
            const rel = key.slice(i + 1);
            if (!rel || rel.split('/').some(s => s === '..' || s === '' || s === '.') || !EXT_OK.test(rel)) continue;
            const base = racineCle === 'root' ? RACINE : dossier(racineCle);
            if (!base) continue;
            if (racineCle === 'root' && (rel.includes('/') || !rel.endsWith('.json') || EXCLUS_RACINE.has(rel))) continue;
            const abs = path.resolve(base, rel);
            if (!abs.startsWith(path.resolve(base) + path.sep)) continue;
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, entree.e === 'u' ? Buffer.from(entree.d, 'utf8') : Buffer.from(entree.d, 'base64'));
            n++;
        } catch (e) { console.error(`[Restore] ${key} :`, e.message); }
    }
    return n;
}

module.exports = { construire, appliquer, lister, RACINE, DATA_DIR };
