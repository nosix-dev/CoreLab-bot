// Chemins persistants : si DATA_DIR est défini (ex. /var/data avec un Render Disk), les dossiers et fichiers
// listés ici y sont lus/écrits au lieu du dépôt, donc ils survivent aux redéploiements.
// Au premier démarrage, le contenu existant du dépôt est copié une seule fois (marqueur .seeded).
const fs = require('fs');
const path = require('path');

const RACINE_DEPOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

// nomRelatif : chemin relatif à la racine du dépôt (ex. 'welcome_images' ou 'src/data/form_images')
// nomPersistant : nom utilisé dans DATA_DIR (par défaut le même)
function dossierPersistant(nomRelatif, nomPersistant = nomRelatif) {
    const source = path.join(RACINE_DEPOT, nomRelatif);
    if (!DATA_DIR) {
        try { fs.mkdirSync(source, { recursive: true }); } catch { /* ignoré */ }
        return source;
    }
    const dest = path.join(DATA_DIR, nomPersistant);
    try {
        fs.mkdirSync(dest, { recursive: true });
        const marqueur = path.join(dest, '.seeded');
        if (!fs.existsSync(marqueur)) {
            if (fs.existsSync(source)) fs.cpSync(source, dest, { recursive: true, force: false, errorOnExist: false });
            fs.writeFileSync(marqueur, new Date().toISOString());
        }
    } catch (e) {
        console.error(`[persistentPath] dossier ${nomPersistant} :`, e.message);
    }
    return dest;
}

function fichierPersistant(nomRelatif) {
    const source = path.join(RACINE_DEPOT, nomRelatif);
    if (!DATA_DIR) return source;
    const dest = path.join(DATA_DIR, nomRelatif);
    try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest) && fs.existsSync(source)) fs.copyFileSync(source, dest);
    } catch (e) {
        console.error(`[persistentPath] fichier ${nomRelatif} :`, e.message);
    }
    return dest;
}

module.exports = { dossierPersistant, fichierPersistant, DATA_DIR, RACINE_DEPOT };
