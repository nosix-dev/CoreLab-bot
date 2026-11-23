'use strict';
// ─────────────────────────────────────────────────────────────────────────
// supporter.js — badge Supporter (votes top.gg) : paliers, avantages, rôle, remerciements.
//
// Paliers (nombre de votes) : 💎 Supporter (5) · 🌟 Fidèle (25) · 👑 Légende (100)
// Avantages Supporter (tous paliers) :
//   • +10 % d'XP sur les messages et cooldown d'XP réduit de 25 %
//   • +100 XP par vote récupéré (en plus du bonus de série)
//   • /eco travailler : +15 % de salaire
//   • 1 tour de roue offert par jour (/poke-wheel)
//   • badge affiché sur les cartes (niveau, classement, porte-monnaie, /niveau, /vote-bot) + carte de niveau dorée
//   • rôle Supporter sur le serveur de support + message de remerciement
//
// Variables d'environnement (toutes facultatives) :
//   SUPPORT_GUILD_ID, SUPPORTER_ROLE_ID, SUPPORTER_ROLE_ID_FIDELE, SUPPORTER_ROLE_ID_LEGENDE,
//   SUPPORTER_THANKS_CHANNEL_ID
// ─────────────────────────────────────────────────────────────────────────

const PALIERS = [
    { id: 'legende',   min: 100, nom: 'Légende',   emoji: '👑', env: 'SUPPORTER_ROLE_ID_LEGENDE' },
    { id: 'fidele',    min: 25,  nom: 'Fidèle',    emoji: '🌟', env: 'SUPPORTER_ROLE_ID_FIDELE' },
    { id: 'supporter', min: 5,   nom: 'Supporter', emoji: '💎', env: 'SUPPORTER_ROLE_ID' },
];

const XP_MULTIPLICATEUR = 1.10;
const COOLDOWN_XP_FACTEUR = 0.75;
const XP_BONUS_PAR_VOTE = 100;
const SALAIRE_BONUS = 0.15;
const ROUE_OFFERTE_MS = 24 * 3600 * 1000;

const votes = () => require('./topggVotes');

function palierPour(totalVotes) {
    return PALIERS.find(p => totalVotes >= p.min) || null;
}

// Infos Supporter d'un membre (null si pas Supporter). Ne crée jamais d'entrée dans topgg_votes.json.
function info(userId) {
    const u = votes().lire(userId);
    if (!u || !u.badge) return null;
    const p = palierPour(u.totalVotes) || PALIERS[PALIERS.length - 1];
    return { ...p, votes: u.totalVotes, label: `${p.emoji} ${p.nom}`, texte: p.nom };
}

const estSupporter = id => !!info(id);
const xpMultiplicateur = id => (estSupporter(id) ? XP_MULTIPLICATEUR : 1);
const cooldownFacteur = id => (estSupporter(id) ? COOLDOWN_XP_FACTEUR : 1);
const salaireBonus = id => (estSupporter(id) ? SALAIRE_BONUS : 0);

// Tour de roue offert dispo ? (account.freeSpinAt = dernier tour offert utilisé)
function roueOfferteDispo(userId, account, now = Date.now()) {
    return estSupporter(userId) && now - (account.freeSpinAt || 0) >= ROUE_OFFERTE_MS;
}

// ── Rôle sur le serveur de support ───────────────────────────────────────
async function syncRole(client, userId) {
    try {
        const guildId = process.env.SUPPORT_GUILD_ID;
        const sup = info(userId);
        if (!client || !guildId || !sup) return;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const membre = await guild.members.fetch(userId).catch(() => null);
        if (!membre) return;
        const ids = new Set();
        const base = process.env.SUPPORTER_ROLE_ID;
        if (base) ids.add(base);
        for (const p of PALIERS) if (sup.votes >= p.min && process.env[p.env]) ids.add(process.env[p.env]);
        for (const id of ids) {
            if (!membre.roles.cache.has(id)) await membre.roles.add(id, 'Supporter CoreLab (votes top.gg)').catch(e => console.error('[Supporter] rôle :', e.message));
        }
    } catch (e) {
        console.error('[Supporter] syncRole :', e.message);
    }
}

// Appelé quand un membre atteint un nouveau palier.
async function onPalier(client, userId, palier) {
    try {
        const sup = info(userId);
        await syncRole(client, userId);
        const salonId = process.env.SUPPORTER_THANKS_CHANNEL_ID;
        if (!client || !salonId || !sup) return;
        const salon = await client.channels.fetch(salonId).catch(() => null);
        if (!salon?.isTextBased?.()) return;
        await salon.send({
            content: `${palier.emoji} Merci <@${userId}> ! Il devient **${palier.nom}** de ${client.user?.username || 'CoreLab'} avec **${sup.votes}** votes.`,
            allowedMentions: { users: [userId] },
        });
    } catch (e) {
        console.error('[Supporter] onPalier :', e.message);
    }
}

module.exports = {
    PALIERS, XP_MULTIPLICATEUR, COOLDOWN_XP_FACTEUR, XP_BONUS_PAR_VOTE, SALAIRE_BONUS, ROUE_OFFERTE_MS,
    palierPour, info, estSupporter, xpMultiplicateur, cooldownFacteur, salaireBonus,
    roueOfferteDispo, syncRole, onPalier,
};
