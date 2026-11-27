'use strict';
// Exporte toute la base SQLite vers des fichiers JSON lisibles (retour arrière, inspection, copie manuelle).
// Usage : npm run db:export [-- dossier-de-sortie]     (défaut : ./export-json)
const fs = require('fs');
const path = require('path');
const kv = require('../src/core/db');

const sortie = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'export-json');
let n = 0;
for (const nom of kv.noms()) {
    const abs = path.resolve(sortie, nom);
    if (!abs.startsWith(sortie + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let texte = kv.lireBrut(nom);
    try { texte = JSON.stringify(JSON.parse(texte), null, 2); } catch { /* on garde tel quel */ }
    fs.writeFileSync(abs, texte, 'utf8');
    n++;
}
console.log(`${n} fichier(s) exporté(s) dans ${sortie}`);
kv.fermer();
