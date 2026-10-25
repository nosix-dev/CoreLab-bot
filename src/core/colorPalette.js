const {
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

// ────────────────────────────────────────────────
// Palette de couleurs "carrés" pour les modals de personnalisation
// (remplace la saisie hexadécimale manuelle par un choix visuel)
// Utilisée par : bienvenue/au revoir (commands/extended.js),
// ticket (handlers/interactions.js), règlement (core/reglement.js)
// ────────────────────────────────────────────────
const PALETTE_COULEURS_APPARENCE = [
    { emoji: '⬜', label: 'Blanc (Défaut)', value: 'FFFFFF' },
    { emoji: '🔷', label: 'Turquoise', value: '8FC3C8' },
    { emoji: '🟥', label: 'Rouge', value: 'FF0000' },
    { emoji: '🟨', label: 'Jaune', value: 'FFFF00' },
    { emoji: '🟦', label: 'Bleu', value: '0000FF' },
    { emoji: '🟪', label: 'Violet', value: '800080' },
    { emoji: '🟫', label: 'Marron', value: '8B4513' },
    { emoji: '⬛', label: 'Noir', value: '000000' },
    { emoji: '💗', label: 'Rose', value: 'FF69B4' },
    { emoji: '🩵', label: 'Cyan', value: '00FFFF' },
    { emoji: '🔶', label: 'Corail', value: 'FF7F50' },
    { emoji: '💛', label: 'Or', value: 'FFD700' },
    { emoji: '🩶', label: 'Gris', value: '808080' },
    { emoji: '🟣', label: 'Indigo', value: '4B0082' },
];

function hexToColorInt(hex) {
    if (!hex) return null;
    const clean = String(hex).replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return parseInt(clean, 16);
}

// ────────────────────────────────────────────────
// Construit les deux LabelBuilder (select carrés + input hex) à ajouter
// à un modal via modal.addLabelComponents(...). couleurActuelleInt est
// la couleur actuelle en entier (ex: 0xFFFFFF), ou undefined pour le défaut.
// ────────────────────────────────────────────────
function buildCouleurLabelComponents(couleurActuelleInt) {
    const couleurActuelle = couleurActuelleInt !== undefined && couleurActuelleInt !== null
        ? couleurActuelleInt.toString(16).padStart(6, '0').toUpperCase()
        : 'FFFFFF';

    const couleurSelect = new StringSelectMenuBuilder()
        .setCustomId('couleur')
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)
        .addOptions(
            PALETTE_COULEURS_APPARENCE.map(c => new StringSelectMenuOptionBuilder()
                .setEmoji(c.emoji)
                .setLabel(c.label)
                .setValue(c.value)
                .setDefault(c.value === couleurActuelle)
            )
        );
    const couleurLabel = new LabelBuilder()
        .setLabel('Couleur')
        .setDescription('Choisis un carré, ou précise un hex ci-dessous')
        .setStringSelectMenuComponent(couleurSelect);

    const couleurHexInput = new TextInputBuilder()
        .setCustomId('couleur_hex')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7)
        .setPlaceholder('Ex: 000000 (laisse vide pour utiliser le carré ci-dessus)');
    const couleurHexLabel = new LabelBuilder()
        .setLabel('Couleur personnalisée (hex, prioritaire)')
        .setTextInputComponent(couleurHexInput);

    return { couleurLabel, couleurHexLabel };
}

// ────────────────────────────────────────────────
// À utiliser dans le handler de soumission du modal (modalSubmit.fields).
// Retourne :
//   - undefined si rien n'a été choisi (ne pas changer la couleur existante)
//   - null si une valeur hex a été saisie mais invalide
//   - un entier (0x......) si une couleur valide a été choisie
// ────────────────────────────────────────────────
function resoudreCouleurDepuisModal(modalSubmit) {
    let couleurHexSaisie = '';
    try { couleurHexSaisie = modalSubmit.fields.getTextInputValue('couleur_hex').trim(); } catch (_) { /* champ absent */ }
    let couleurSwatch;
    try { couleurSwatch = modalSubmit.fields.getStringSelectValues('couleur')[0]; } catch (_) { couleurSwatch = undefined; }
    const couleurHex = couleurHexSaisie || couleurSwatch;
    if (!couleurHex) return undefined;
    return hexToColorInt(couleurHex);
}

module.exports = {
    PALETTE_COULEURS_APPARENCE,
    hexToColorInt,
    buildCouleurLabelComponents,
    resoudreCouleurDepuisModal,
};