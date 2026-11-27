'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Stats d'activité en vraies tables SQLite (messages / vocal / arrivées-départs).
//
//  activity_day           (guild, day)                  messages, joins, leaves, voice
//  activity_hour          (guild, day, hour)            messages
//  activity_channel       (guild, day, channel)         messages
//  activity_user          (guild, day, user)            messages, voice
//  activity_user_channel  (guild, day, user, channel)   messages
//  activity_user_hour     (guild, day, user, hour)      messages
//
// • Les compteurs sont cumulés en mémoire puis écrits toutes les ~10 s en une seule transaction
//   (et à l'arrêt du processus). Toute lecture écrit d'abord ce qui est en attente → chiffres exacts.
// • Migration : l'ancien « activity_stats.json » est importé une seule fois (copie gardée sous old/…).
// • Sauvegarde Discord : exposé comme fichier virtuel « activity_stats.json » (même format qu'avant).
// ─────────────────────────────────────────────────────────────────────────

const kv = require('./db');

const NOM_VIRTUEL = 'activity_stats.json';
const MIGRATION = 'activity_stats_json_vers_tables';
const DELAI_FLUSH_MS = 10 * 1000;

let S = null; // requêtes préparées

function init() {
    if (S) return S;
    const bd = kv.bd();
    bd.exec(`
        CREATE TABLE IF NOT EXISTS activity_day (
            guild_id TEXT NOT NULL, day TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0, joins INTEGER NOT NULL DEFAULT 0,
            leaves INTEGER NOT NULL DEFAULT 0, voice REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS activity_hour (
            guild_id TEXT NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, hour)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS activity_channel (
            guild_id TEXT NOT NULL, day TEXT NOT NULL, channel_id TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, channel_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS activity_user (
            guild_id TEXT NOT NULL, day TEXT NOT NULL, user_id TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0, voice REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, user_id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_activity_user_membre ON activity_user (guild_id, user_id, day);
        CREATE TABLE IF NOT EXISTS activity_user_channel (
            guild_id TEXT NOT NULL, day TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, user_id, channel_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS activity_user_hour (
            guild_id TEXT NOT NULL, day TEXT NOT NULL, user_id TEXT NOT NULL, hour INTEGER NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, user_id, hour)
        ) WITHOUT ROWID;
    `);
    S = {
        day: bd.prepare(`INSERT INTO activity_day (guild_id, day, messages, joins, leaves, voice) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, day) DO UPDATE SET messages = messages + excluded.messages, joins = joins + excluded.joins,
            leaves = leaves + excluded.leaves, voice = voice + excluded.voice`),
        hour: bd.prepare(`INSERT INTO activity_hour (guild_id, day, hour, messages) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, day, hour) DO UPDATE SET messages = messages + excluded.messages`),
        channel: bd.prepare(`INSERT INTO activity_channel (guild_id, day, channel_id, messages) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, day, channel_id) DO UPDATE SET messages = messages + excluded.messages`),
        user: bd.prepare(`INSERT INTO activity_user (guild_id, day, user_id, messages, voice) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, day, user_id) DO UPDATE SET messages = messages + excluded.messages, voice = voice + excluded.voice`),
        userChannel: bd.prepare(`INSERT INTO activity_user_channel (guild_id, day, user_id, channel_id, messages) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, day, user_id, channel_id) DO UPDATE SET messages = messages + excluded.messages`),
        userHour: bd.prepare(`INSERT INTO activity_user_hour (guild_id, day, user_id, hour, messages) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, day, user_id, hour) DO UPDATE SET messages = messages + excluded.messages`),
    };
    migrerAncienFichier();
    return S;
}

// ── Cumul en mémoire (écrit par lots) ───────────────────────────────────
let pDay = new Map();      // 'g|day'            → [messages, joins, leaves, voice]
let pHour = new Map();     // 'g|day|hour'       → n
let pChannel = new Map();  // 'g|day|channel'    → n
let pUser = new Map();     // 'g|day|user'       → [messages, voice]
let pUserCh = new Map();   // 'g|day|user|ch'    → n
let pUserHour = new Map(); // 'g|day|user|hour'  → n
let minuteur = null;

const add = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
function addArr(map, key, i, n, taille) {
    let a = map.get(key);
    if (!a) { a = new Array(taille).fill(0); map.set(key, a); }
    a[i] += n;
}
function planifier() {
    if (minuteur) return;
    minuteur = setTimeout(() => { minuteur = null; flush(); }, DELAI_FLUSH_MS);
    if (minuteur.unref) minuteur.unref();
}

function ajouterMessage(g, day, hour, channelId, userId) {
    addArr(pDay, `${g}|${day}`, 0, 1, 4);
    add(pHour, `${g}|${day}|${hour}`);
    add(pChannel, `${g}|${day}|${channelId}`);
    addArr(pUser, `${g}|${day}|${userId}`, 0, 1, 2);
    add(pUserCh, `${g}|${day}|${userId}|${channelId}`);
    add(pUserHour, `${g}|${day}|${userId}|${hour}`);
    planifier();
}
function ajouterArrivee(g, day) { addArr(pDay, `${g}|${day}`, 1, 1, 4); planifier(); }
function ajouterDepart(g, day) { addArr(pDay, `${g}|${day}`, 2, 1, 4); planifier(); }
function ajouterVocal(g, day, userId, minutes) {
    addArr(pDay, `${g}|${day}`, 3, minutes, 4);
    addArr(pUser, `${g}|${day}|${userId}`, 1, minutes, 2);
    planifier();
}

/** Écrit en base tout ce qui est en attente (une transaction). */
function flush() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (!pDay.size && !pUser.size && !pHour.size) return;
    const lots = { pDay, pHour, pChannel, pUser, pUserCh, pUserHour };
    pDay = new Map(); pHour = new Map(); pChannel = new Map(); pUser = new Map(); pUserCh = new Map(); pUserHour = new Map();
    try {
        init();
        kv.transaction(() => {
            for (const [k, v] of lots.pDay) { const [g, d] = k.split('|'); S.day.run(g, d, v[0], v[1], v[2], v[3]); }
            for (const [k, n] of lots.pHour) { const [g, d, h] = k.split('|'); S.hour.run(g, d, Number(h), n); }
            for (const [k, n] of lots.pChannel) { const [g, d, c] = k.split('|'); S.channel.run(g, d, c, n); }
            for (const [k, v] of lots.pUser) { const [g, d, u] = k.split('|'); S.user.run(g, d, u, v[0], v[1]); }
            for (const [k, n] of lots.pUserCh) { const [g, d, u, c] = k.split('|'); S.userChannel.run(g, d, u, c, n); }
            for (const [k, n] of lots.pUserHour) { const [g, d, u, h] = k.split('|'); S.userHour.run(g, d, u, Number(h), n); }
        });
    } catch (e) {
        console.error('[ActivityStats] écriture en base impossible, nouvel essai plus tard :', e.message);
        // on remet les compteurs en attente pour ne rien perdre
        const fusionner = (cible, source, tableau) => {
            for (const [k, v] of source) {
                if (!tableau) cible.set(k, (cible.get(k) || 0) + v);
                else { const a = cible.get(k) || new Array(v.length).fill(0); v.forEach((x, i) => { a[i] += x; }); cible.set(k, a); }
            }
        };
        fusionner(pDay, lots.pDay, true); fusionner(pUser, lots.pUser, true);
        fusionner(pHour, lots.pHour); fusionner(pChannel, lots.pChannel);
        fusionner(pUserCh, lots.pUserCh); fusionner(pUserHour, lots.pUserHour);
        planifier();
    }
}

/** Supprime tout ce qui est plus ancien que `jourMin` (AAAA-MM-JJ). */
function purger(jourMin) {
    init();
    flush();
    try {
        kv.transaction(() => {
            for (const t of ['activity_day', 'activity_hour', 'activity_channel', 'activity_user', 'activity_user_channel', 'activity_user_hour']) {
                kv.bd().prepare(`DELETE FROM ${t} WHERE day < ?`).run(jourMin);
            }
        });
    } catch (e) { console.error('[ActivityStats] purge impossible :', e.message); }
}

// ── Lecture / agrégation ────────────────────────────────────────────────
/**
 * @param {string} guildId
 * @param {string[]} keys   jours AAAA-MM-JJ consécutifs (du plus ancien au plus récent)
 * @param {string|null} userId  si fourni : messages / salons / heures / vocal de ce membre
 */
function resume(guildId, keys, userId = null) {
    init();
    flush();
    const bd = kv.bd();
    const g = String(guildId);
    const a = keys[0], b = keys[keys.length - 1];
    const idx = new Map(keys.map((k, i) => [k, i]));

    const perDay = Array(keys.length).fill(0);
    const hours = Array(24).fill(0);
    const channels = {};
    let voice = 0, joins = 0, leaves = 0;

    const jours = bd.prepare('SELECT day, messages, joins, leaves, voice FROM activity_day WHERE guild_id = ? AND day BETWEEN ? AND ?').all(g, a, b);
    for (const r of jours) { joins += r.joins; leaves += r.leaves; }

    if (userId) {
        const u = String(userId);
        for (const r of bd.prepare('SELECT day, messages, voice FROM activity_user WHERE guild_id = ? AND user_id = ? AND day BETWEEN ? AND ?').all(g, u, a, b)) {
            perDay[idx.get(r.day)] = r.messages; voice += r.voice;
        }
        for (const r of bd.prepare('SELECT hour, SUM(messages) AS n FROM activity_user_hour WHERE guild_id = ? AND user_id = ? AND day BETWEEN ? AND ? GROUP BY hour').all(g, u, a, b)) hours[r.hour] += r.n;
        for (const r of bd.prepare('SELECT channel_id, SUM(messages) AS n FROM activity_user_channel WHERE guild_id = ? AND user_id = ? AND day BETWEEN ? AND ? GROUP BY channel_id').all(g, u, a, b)) channels[r.channel_id] = r.n;
    } else {
        for (const r of jours) { perDay[idx.get(r.day)] = r.messages; voice += r.voice; }
        for (const r of bd.prepare('SELECT hour, SUM(messages) AS n FROM activity_hour WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY hour').all(g, a, b)) hours[r.hour] += r.n;
        for (const r of bd.prepare('SELECT channel_id, SUM(messages) AS n FROM activity_channel WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY channel_id').all(g, a, b)) channels[r.channel_id] = r.n;
    }

    const topUsers = bd.prepare(
        'SELECT user_id, SUM(messages) AS n FROM activity_user WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY user_id HAVING SUM(messages) > 0 ORDER BY n DESC, user_id'
    ).all(g, a, b).map(r => [r.user_id, r.n]);

    return {
        perDay, hours, joins, leaves, voice, topUsers,
        topChannels: Object.entries(channels).sort((x, y) => y[1] - x[1]),
    };
}

/** Séries jour par jour du serveur (graphiques du dashboard). */
function serie(guildId, keys) {
    init();
    flush();
    const idx = new Map(keys.map((k, i) => [k, i]));
    const out = { messages: Array(keys.length).fill(0), voice: Array(keys.length).fill(0), joins: Array(keys.length).fill(0), leaves: Array(keys.length).fill(0) };
    for (const r of kv.bd().prepare('SELECT day, messages, joins, leaves, voice FROM activity_day WHERE guild_id = ? AND day BETWEEN ? AND ?')
        .all(String(guildId), keys[0], keys[keys.length - 1])) {
        const i = idx.get(r.day);
        out.messages[i] = r.messages; out.joins[i] = r.joins; out.leaves[i] = r.leaves; out.voice[i] = Math.round(r.voice);
    }
    return out;
}

// ── Import / export au format JSON d'origine (migration + sauvegarde Discord) ──
/** { guilds: { [guildId]: { days: { [AAAA-MM-JJ]: { t, h, c, u: { [user]: { n, c, h, v } }, j, l, v } } } } } */
function exporterJson() {
    init();
    flush();
    const bd = kv.bd();
    const guilds = {};
    const jour = (g, d) => {
        const G = guilds[g] || (guilds[g] = { days: {} });
        return G.days[d] || (G.days[d] = { t: 0, h: {}, c: {}, u: {}, j: 0, l: 0, v: 0 });
    };
    const util = (g, d, u) => { const J = jour(g, d); return J.u[u] || (J.u[u] = { n: 0, c: {}, h: {}, v: 0 }); };
    for (const r of bd.prepare('SELECT * FROM activity_day').all()) { const J = jour(r.guild_id, r.day); J.t = r.messages; J.j = r.joins; J.l = r.leaves; J.v = r.voice; }
    for (const r of bd.prepare('SELECT * FROM activity_hour').all()) jour(r.guild_id, r.day).h[r.hour] = r.messages;
    for (const r of bd.prepare('SELECT * FROM activity_channel').all()) jour(r.guild_id, r.day).c[r.channel_id] = r.messages;
    for (const r of bd.prepare('SELECT * FROM activity_user').all()) { const U = util(r.guild_id, r.day, r.user_id); U.n = r.messages; U.v = r.voice; }
    for (const r of bd.prepare('SELECT * FROM activity_user_channel').all()) util(r.guild_id, r.day, r.user_id).c[r.channel_id] = r.messages;
    for (const r of bd.prepare('SELECT * FROM activity_user_hour').all()) util(r.guild_id, r.day, r.user_id).h[r.hour] = r.messages;
    return JSON.stringify({ guilds });
}

/** Remplace le contenu des tables par celui d'un JSON au format d'origine. */
function importerObjet(obj) {
    const bd = kv.bd();
    kv.transaction(() => {
        for (const t of ['activity_day', 'activity_hour', 'activity_channel', 'activity_user', 'activity_user_channel', 'activity_user_hour']) bd.exec(`DELETE FROM ${t}`);
        for (const [g, G] of Object.entries(obj?.guilds || {})) {
            for (const [d, J] of Object.entries(G?.days || {})) {
                S.day.run(g, d, J.t || 0, J.j || 0, J.l || 0, J.v || 0);
                for (const [h, n] of Object.entries(J.h || {})) S.hour.run(g, d, Number(h), n);
                for (const [c, n] of Object.entries(J.c || {})) S.channel.run(g, d, c, n);
                for (const [u, U] of Object.entries(J.u || {})) {
                    S.user.run(g, d, u, U.n || 0, U.v || 0);
                    for (const [c, n] of Object.entries(U.c || {})) S.userChannel.run(g, d, u, c, n);
                    for (const [h, n] of Object.entries(U.h || {})) S.userHour.run(g, d, u, Number(h), n);
                }
            }
        }
    });
}

function migrerAncienFichier() {
    if (kv.migrationFaite(MIGRATION)) return;
    try {
        // lireJson reprend aussi l'ancien fichier activity_stats.json du disque s'il n'est pas encore en base
        const ancien = kv.lireJson(NOM_VIRTUEL, null);
        if (ancien && typeof ancien === 'object' && ancien.guilds) {
            kv.ecrireBrut(`old/${NOM_VIRTUEL}`, JSON.stringify(ancien)); // copie de secours (non incluse dans la sauvegarde Discord)
            importerObjet(ancien);
            const n = Object.values(ancien.guilds).reduce((t, G) => t + Object.keys(G?.days || {}).length, 0);
            console.log(`[ActivityStats] migration : ${n} jour(s) d'activité importés dans les tables SQLite.`);
        }
        kv.supprimer(NOM_VIRTUEL);
        kv.marquerMigration(MIGRATION);
    } catch (e) {
        console.error('[ActivityStats] migration impossible (nouvel essai au prochain démarrage) :', e.message);
    }
}

// Sauvegarde / restauration Discord : fichier virtuel « activity_stats.json »
kv.enregistrerVirtuel(NOM_VIRTUEL, {
    exporter: exporterJson,
    importer(texte) {
        init();
        pDay = new Map(); pHour = new Map(); pChannel = new Map(); pUser = new Map(); pUserCh = new Map(); pUserHour = new Map();
        importerObjet(JSON.parse(texte));
        kv.marquerMigration(MIGRATION);
    },
});

process.on('exit', () => { try { flush(); } catch { /* ignoré */ } });

module.exports = {
    init, ajouterMessage, ajouterArrivee, ajouterDepart, ajouterVocal,
    flush, purger, resume, serie, exporterJson,
};
