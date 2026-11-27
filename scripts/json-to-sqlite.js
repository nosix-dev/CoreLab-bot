'use strict';
// Importe d'un coup tous les fichiers JSON de données dans la base SQLite (corelab.db).
// Facultatif : le bot importe de toute façon chaque fichier automatiquement à la première lecture.
// Usage : npm run db:import          (n'écrase jamais une entrée déjà présente en base)
//         npm run db:import -- --force   (écrase les entrées existantes par le contenu des fichiers)
const fs = require('fs');
const path = require('path');
const kv = require('../src/core/db');
const { DATA_DIR, RACINE_DEPOT } = require('../src/core/persistentPath');

const RACINE = DATA_DIR || RACINE_DEPOT;
const EXCLUS = new Set(['package.json', 'package-lock.json', 'update.json']);
const force = process.argv.includes('--force');

const candidats = [];
for (const base of new Set([RACINE_DEPOT, RACINE])) {
    for (const nom of fs.readdirSync(base)) {
        if (nom.endsWith('.json') && !EXCLUS.has(nom)) candidats.push({ nom, abs: path.join(base, nom) });
    }
    const d = path.join(base, 'data');
    if (fs.existsSync(d)) for (const nom of fs.readdirSync(d)) {
        if (nom.endsWith('.json')) candidats.push({ nom: `data/${nom}`, abs: path.join(d, nom) });
    }
}

const deja = new Set(kv.noms());
let importes = 0, ignores = 0, invalides = 0;
const vus = new Set();
// DATA_DIR est prioritaire sur le dépôt : on lit les candidats dans l'ordre inverse
for (const { nom, abs } of candidats.reverse()) {
    if (vus.has(nom)) continue;
    vus.add(nom);
    if (deja.has(nom) && !force) { ignores++; continue; }
    try {
        const texte = fs.readFileSync(abs, 'utf8');
        JSON.parse(texte);
        kv.ecrireBrut(nom, texte);
        importes++;
        console.log(`  + ${nom} (${(Buffer.byteLength(texte) / 1024).toFixed(1)} Ko)`);
    } catch (e) {
        invalides++;
        console.error(`  ! ${nom} ignoré : ${e.message}`);
    }
}
const i = kv.info();
console.log(`\nTerminé : ${importes} importé(s), ${ignores} déjà en base, ${invalides} invalide(s).`);
console.log(`Base : ${i.chemin} (${(i.taille / 1024).toFixed(0)} Ko, pilote ${i.pilote})`);
kv.fermer();
