const translate = require('google-translate-api-x');

// ────────────────────────────────────────────────
// Normalise une chaîne pour la comparaison : minuscules,
// sans accents, sans espaces superflus.
// ────────────────────────────────────────────────
function normaliser(texte) {
    return String(texte)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// ────────────────────────────────────────────────
// Alias français les plus courants → code ISO Google Translate.
// Couvre les langues les plus probables pour un serveur francophone ;
// tout ce qui n'est pas ici retombe sur le nom anglais ou le code ISO
// (ex: "russian", "ru", "korean"...).
// ────────────────────────────────────────────────
const ALIAS_FR = {
    'francais': 'fr', 'anglais': 'en', 'espagnol': 'es', 'italien': 'it', 'allemand': 'de',
    'portugais': 'pt', 'russe': 'ru', 'polonais': 'pl', 'neerlandais': 'nl', 'hollandais': 'nl',
    'arabe': 'ar', 'chinois': 'zh-CN', 'chinois simplifie': 'zh-CN', 'chinois traditionnel': 'zh-TW',
    'japonais': 'ja', 'coreen': 'ko', 'turc': 'tr', 'ukrainien': 'uk', 'roumain': 'ro',
    'suedois': 'sv', 'norvegien': 'no', 'danois': 'da', 'finnois': 'fi', 'finlandais': 'fi',
    'grec': 'el', 'tcheque': 'cs', 'slovaque': 'sk', 'hongrois': 'hu', 'hebreu': 'he',
    'hindi': 'hi', 'vietnamien': 'vi', 'thai': 'th', 'thailandais': 'th', 'indonesien': 'id',
    'malais': 'ms', 'bulgare': 'bg', 'croate': 'hr', 'serbe': 'sr', 'slovene': 'sl',
    'lituanien': 'lt', 'letton': 'lv', 'estonien': 'et', 'georgien': 'ka', 'armenien': 'hy',
    'azeri': 'az', 'azerbaidjanais': 'az', 'kazakh': 'kk', 'ouzbek': 'uz', 'persan': 'fa', 'farsi': 'fa',
    'pachto': 'ps', 'ourdou': 'ur', 'bengali': 'bn', 'tamoul': 'ta', 'telougou': 'te',
    'marathi': 'mr', 'goujrati': 'gu', 'gujarati': 'gu', 'pendjabi': 'pa', 'malayalam': 'ml',
    'kannada': 'kn', 'birman': 'my', 'khmer': 'km', 'laotien': 'lo', 'mongol': 'mn',
    'nepalais': 'ne', 'cingalais': 'si', 'somali': 'so', 'swahili': 'sw', 'afrikaans': 'af',
    'amharique': 'am', 'zoulou': 'zu', 'xhosa': 'xh', 'yoruba': 'yo', 'igbo': 'ig', 'haoussa': 'ha',
    'gallois': 'cy', 'irlandais': 'ga', 'islandais': 'is', 'maltais': 'mt', 'basque': 'eu',
    'catalan': 'ca', 'galicien': 'gl', 'albanais': 'sq', 'bosniaque': 'bs', 'macedonien': 'mk',
    'bielorusse': 'be',
};

// Libellés français pour l'affichage (confirmation, embeds de traduction)
const LIBELLE_FR = {
    fr: 'Français', en: 'Anglais', es: 'Espagnol', it: 'Italien', de: 'Allemand',
    pt: 'Portugais', ru: 'Russe', pl: 'Polonais', nl: 'Néerlandais', ar: 'Arabe',
    'zh-CN': 'Chinois (simplifié)', 'zh-TW': 'Chinois (traditionnel)', ja: 'Japonais', ko: 'Coréen',
    tr: 'Turc', uk: 'Ukrainien', ro: 'Roumain', sv: 'Suédois', no: 'Norvégien', da: 'Danois',
    fi: 'Finnois', el: 'Grec', cs: 'Tchèque', sk: 'Slovaque', hu: 'Hongrois', he: 'Hébreu',
    hi: 'Hindi', vi: 'Vietnamien', th: 'Thaï', id: 'Indonésien', ms: 'Malais', bg: 'Bulgare',
    hr: 'Croate', sr: 'Serbe', sl: 'Slovène', lt: 'Lituanien', lv: 'Letton', et: 'Estonien',
    ka: 'Géorgien', hy: 'Arménien', az: 'Azéri', kk: 'Kazakh', uz: 'Ouzbek', fa: 'Persan',
    ps: 'Pachto', ur: 'Ourdou', bn: 'Bengali', ta: 'Tamoul', te: 'Télougou', mr: 'Marathi',
    gu: 'Gujarati', pa: 'Pendjabi', ml: 'Malayalam', kn: 'Kannada', my: 'Birman', km: 'Khmer',
    lo: 'Laotien', mn: 'Mongol', ne: 'Népalais', si: 'Cingalais', so: 'Somali', sw: 'Swahili',
    af: 'Afrikaans', am: 'Amharique', zu: 'Zoulou', xh: 'Xhosa', yo: 'Yoruba', ig: 'Igbo',
    ha: 'Haoussa', cy: 'Gallois', ga: 'Irlandais', is: 'Islandais', mt: 'Maltais', eu: 'Basque',
    ca: 'Catalan', gl: 'Galicien', sq: 'Albanais', bs: 'Bosniaque', mk: 'Macédonien', be: 'Biélorusse',
};

// Valeurs qui signifient "désactive ma traduction personnelle"
const VALEURS_DESACTIVATION = ['off', 'aucun', 'aucune', 'desactiver', 'désactiver', 'non', 'stop', 'none'];

function estDemandeDesactivation(saisie) {
    return VALEURS_DESACTIVATION.includes(normaliser(saisie));
}

// Libellé affichable pour un code (français si connu, sinon nom anglais de la lib, sinon le code brut)
function libelleLangue(code) {
    return LIBELLE_FR[code] || translate.languages?.[code] || String(code).toUpperCase();
}

// ────────────────────────────────────────────────
// Résout une saisie libre ("français", "Russian", "fr", "ZH-CN"...)
// vers un code ISO valide reconnu par google-translate-api-x.
// Retourne null si rien ne correspond.
// ────────────────────────────────────────────────
function resoudreLangue(saisieBrute) {
    if (!saisieBrute) return null;
    const brut = String(saisieBrute).trim();
    if (!brut) return null;
    const normalise = normaliser(brut);

    if (ALIAS_FR[normalise]) return ALIAS_FR[normalise];

    const langues = translate.languages || {};

    const codeExact = Object.keys(langues).find(code => code.toLowerCase() === normalise);
    if (codeExact) return codeExact;

    const parNomAnglais = Object.entries(langues).find(([, nom]) => normaliser(nom) === normalise);
    if (parNomAnglais) return parNomAnglais[0];

    return null;
}

module.exports = {
    resoudreLangue,
    libelleLangue,
    estDemandeDesactivation,
    ALIAS_FR,
    LIBELLE_FR,
};
