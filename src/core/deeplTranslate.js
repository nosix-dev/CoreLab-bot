const deepl = require('deepl-node');

// Nécessite une clé API DeepL gratuite (500 000 caractères/mois) :
// https://www.deepl.com/pro-api → ajouter DEEPL_API_KEY dans le .env
const CLE_API = process.env.DEEPL_API_KEY;
const traducteur = CLE_API ? new deepl.Translator(CLE_API) : null;

// ────────────────────────────────────────────────
// Correspondance entre nos codes internes (ceux utilisés dans les
// préférences stockées, cf. src/core/languages.js) et les codes de
// langue CIBLE attendus par l'API DeepL. EN et PT exigent une variante
// régionale en tant que langue cible (mais pas en tant que source).
// ────────────────────────────────────────────────
const CODE_CIBLE_DEEPL = {
    fr: 'fr', en: 'en-US', es: 'es', it: 'it', de: 'de', pt: 'pt-PT', ru: 'ru', pl: 'pl', nl: 'nl', ar: 'ar',
    'zh-CN': 'zh', ja: 'ja', ko: 'ko', tr: 'tr', uk: 'uk', ro: 'ro', sv: 'sv', el: 'el', cs: 'cs', hu: 'hu',
    da: 'da', vi: 'vi', th: 'th', id: 'id',
};

// Mêmes langues, sans variante régionale : utilisé comme code SOURCE.
const CODE_SOURCE_DEEPL = { ...CODE_CIBLE_DEEPL, en: 'en', pt: 'pt' };

function codeCibleDeepL(codeInterne) {
    return CODE_CIBLE_DEEPL[codeInterne] || codeInterne;
}

function codeSourceDeepL(codeInterne) {
    if (!codeInterne || codeInterne === 'auto') return null; // laisse DeepL auto-détecter
    return CODE_SOURCE_DEEPL[codeInterne] || codeInterne;
}

// Compare deux codes de langue en ne regardant que les 2 premières lettres
// (fr === fr-FR, zh === zh-CN, etc.)
function memeLangue(codeA, codeB) {
    if (!codeA || !codeB) return false;
    return String(codeA).toLowerCase().slice(0, 2) === String(codeB).toLowerCase().slice(0, 2);
}

// ────────────────────────────────────────────────
// Traduit un texte via DeepL.
// codeCibleInterne / codeSourceInterne utilisent nos codes internes (ex: 'fr', 'zh-CN').
// Si codeSourceInterne est omis, DeepL auto-détecte la langue source.
// Retourne { text, detectedSourceLang } (detectedSourceLang en minuscules, 2 lettres).
// ────────────────────────────────────────────────
async function traduireDeepL(texte, codeCibleInterne, codeSourceInterne = null) {
    if (!traducteur) {
        throw new Error('DEEPL_API_KEY manquante : ajoute-la dans ton fichier .env pour activer la traduction DeepL.');
    }

    const cible = codeCibleDeepL(codeCibleInterne);
    const source = codeSourceDeepL(codeSourceInterne);

    const resultat = await traducteur.translateText(texte, source, cible);

    return {
        text: resultat.text,
        detectedSourceLang: (resultat.detectedSourceLang || '').toLowerCase(),
    };
}

module.exports = { traduireDeepL, codeCibleDeepL, codeSourceDeepL, memeLangue };
