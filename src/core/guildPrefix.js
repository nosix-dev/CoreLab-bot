// ─────────────────────────────────────────────────────────────────────────
// guildPrefix.js — préfixe des commandes texte, personnalisable par serveur.
//
// • Stocké dans la config du serveur (bot_config.json → clé « prefix »).
// • Modifiable avec /prefix (bot) et dans le dashboard web (Général → Préfixe).
// • Défaut : « ! » (client.prefix).
// ─────────────────────────────────────────────────────────────────────────

const { getGuildConfig, persister } = require('./config');

const DEFAUT = '!';
const LONGUEUR_MAX = 5;
const INTERDITS = /[\/`<>@\\]/;

// Renvoie un message d'erreur (string) si le préfixe est invalide, sinon null.
function valider(brut) {
    const p = String(brut ?? '');
    if (!p) return 'Le préfixe ne peut pas être vide.';
    if (p.length > LONGUEUR_MAX) return `Le préfixe fait ${LONGUEUR_MAX} caractères maximum.`;
    if (/\s/.test(p)) return 'Le préfixe ne peut pas contenir d\'espace.';
    if (INTERDITS.test(p)) return 'Caractères interdits : / ` < > @ \\';
    return null;
}

// Préfixe actuel d'un serveur (défaut si absent ou invalide).
function get(guildId) {
    if (!guildId) return DEFAUT;
    try {
        const p = getGuildConfig(guildId).prefix;
        return typeof p === 'string' && !valider(p) ? p : DEFAUT;
    } catch {
        return DEFAUT;
    }
}

// Change le préfixe d'un serveur. Renvoie { ok: true, prefix } ou { ok: false, error }.
function set(guildId, brut) {
    const erreur = valider(brut);
    if (erreur) return { ok: false, error: erreur };
    getGuildConfig(guildId).prefix = String(brut);
    persister('configuration');
    return { ok: true, prefix: String(brut) };
}

function reinitialiser(guildId) {
    return set(guildId, DEFAUT);
}

// Le message commence-t-il par le préfixe ? (insensible à la casse pour les préfixes à lettres, ex. « cl! »)
function startsWith(contenu, prefix) {
    return String(contenu || '').slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

module.exports = { DEFAUT, LONGUEUR_MAX, valider, get, set, reinitialiser, startsWith };