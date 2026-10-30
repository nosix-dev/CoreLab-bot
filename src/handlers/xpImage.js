const fs = require('fs');
const path = require('path');
const { dossierPersistant, fichierPersistant } = require('../core/persistentPath');

const XP_IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp'];

// Cherche le fichier d'image personnalisée du système d'XP (annonce de montée de niveau),
// quelle que soit son extension (le gif garde son extension pour rester animé).
function findXpImageFile(guildId) {
    const dir = dossierPersistant('xp_images');
    for (const ext of XP_IMAGE_EXTENSIONS) {
        const filePath = path.join(dir, `${guildId}.${ext}`);
        if (fs.existsSync(filePath)) return { filePath, ext };
    }
    return null;
}

module.exports = { findXpImageFile, XP_IMAGE_EXTENSIONS };