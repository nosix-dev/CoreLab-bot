// ─────────────────────────────────────────────────────────────────────────
// topggVotes.js — suivi des votes top.gg (webhook), série, récompenses, badge, rappel.
//
// • top.gg appelle POST /topgg (voir index.js) avec l'en-tête Authorization = TOPGG_WEBHOOK_AUTH.
// • Chaque vote : +1 vote (+2 le weekend), série mise à jour,
//   et 1 récompense XP « à récupérer » avec le bouton Récupérer de /vote-bot.
// • Les données sont dans topgg_votes.json (racine) : couvert par la sauvegarde Discord automatique.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { chargerDonnees, sauvegarderDonnees } = require('./data');

const FICHIER = 'topgg_votes.json';
const COOLDOWN_VOTE_MS = 12 * 3600 * 1000;      // un vote toutes les 12 h
const GRACE_SERIE_MS = 36 * 3600 * 1000;        // revoter en moins de 36 h garde la série
const XP_PAR_VOTE = 350;
const XP_BONUS_PAR_JOUR_DE_SERIE = 25;          // « plus d'XP chaque jour »
const XP_BONUS_SERIE_MAX = 10;                  // plafond : 10 jours de bonus
const VOTES_BADGE = 5;                          // badge Supporter

const donnees = chargerDonnees(FICHIER, { users: {} });
if (!donnees.users) donnees.users = {};

function sauver() {
    return sauvegarderDonnees(FICHIER, donnees);
}

function utilisateur(id) {
    const cle = String(id);
    if (!donnees.users[cle]) {
        donnees.users[cle] = {
            lastVoteAt: 0, totalVotes: 0, streak: 0, bestStreak: 0,
            pending: 0, reminder: false, reminderSent: true, badge: false,
        };
    }
    return donnees.users[cle];
}

// Lecture seule : ne crée jamais d'entrée (utilisé pour afficher le badge Supporter partout).
function lire(id) {
    return donnees.users[String(id)] || null;
}

let clientRef = null;

function jourParis(ts) {
    return new Date(ts).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

// Weekend (samedi/dimanche, heure de Paris) : les votes comptent double.
function estWeekend(now = Date.now()) {
    const j = new Date(now).toLocaleDateString('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
    return j === 'Sat' || j === 'Sun';
}

// Série encore valide ? (dernier vote il y a moins de 36 h)
function serieActive(u, now = Date.now()) {
    return !!u.lastVoteAt && now - u.lastVoteAt < GRACE_SERIE_MS;
}

function bonusSerie(u) {
    const jours = Math.max(0, Math.min(u.streak - 1, XP_BONUS_SERIE_MAX));
    return jours * XP_BONUS_PAR_JOUR_DE_SERIE;
}

// Enregistre un vote reçu du webhook.
function enregistrerVote(userId, isWeekend = false, now = Date.now()) {
    const u = utilisateur(userId);
    const palierAvant = require('./supporter').palierPour(u.totalVotes);
    if (serieActive(u, now)) {
        if (jourParis(now) !== jourParis(u.lastVoteAt)) u.streak += 1;
    } else {
        u.streak = 1;
    }
    u.bestStreak = Math.max(u.bestStreak, u.streak);
    u.lastVoteAt = now;
    u.totalVotes += isWeekend ? 2 : 1;
    u.pending += 1;
    u.reminderSent = false;
    if (u.totalVotes >= VOTES_BADGE) u.badge = true;
    sauver();
    const palierApres = require('./supporter').palierPour(u.totalVotes);
    if (palierApres && palierApres.id !== palierAvant?.id) {
        require('./supporter').onPalier(clientRef, String(userId), palierApres).catch(() => {});
    }
    return u;
}

// Récompense en attente → montant d'XP à créditer (sans rien modifier).
function xpAPayer(u) {
    const bonusSupporter = u.badge ? require('./supporter').XP_BONUS_PAR_VOTE : 0;
    return u.pending * (XP_PAR_VOTE + bonusSerie(u) + bonusSupporter);
}

function marquerRecupere(userId) {
    const u = utilisateur(userId);
    const payes = u.pending;
    u.pending = 0;
    sauver();
    return payes;
}

// Meilleurs voteurs (total de votes).
function topVoteurs(n = 5) {
    return Object.entries(donnees.users)
        .filter(([, u]) => u.totalVotes > 0)
        .sort((a, b) => b[1].totalVotes - a[1].totalVotes)
        .slice(0, n)
        .map(([id, u]) => ({ id, votes: u.totalVotes }));
}

function basculerRappel(userId) {
    const u = utilisateur(userId);
    u.reminder = !u.reminder;
    // Si le vote est déjà de nouveau possible, inutile d'envoyer un rappel pour l'ancien vote.
    if (u.reminder && Date.now() - u.lastVoteAt >= COOLDOWN_VOTE_MS) u.reminderSent = true;
    sauver();
    return u.reminder;
}

function peutRevoterA(u) {
    return u.lastVoteAt ? u.lastVoteAt + COOLDOWN_VOTE_MS : 0;
}

// ── Webhook HTTP ──────────────────────────────────────────────────────────
function egal(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Nouveau format top.gg (webhooks v1) : en-tête x-topgg-signature = "t=<timestamp>,v1=<hmac sha256 hex>"
// calculé sur "<timestamp>.<corps brut>" avec le secret du webhook (whs_...).
function signatureValide(entete, corps, secret) {
    const parts = {};
    String(entete || '').split(',').forEach(x => {
        const i = x.indexOf('=');
        if (i > 0) parts[x.slice(0, i).trim()] = x.slice(i + 1).trim();
    });
    if (!parts.t || !parts.v1) return false;
    const attendu = crypto.createHmac('sha256', secret).update(`${parts.t}.${corps}`).digest('hex');
    return egal(parts.v1, attendu);
}

function handleWebhook(req, res) {
    const secret = process.env.TOPGG_WEBHOOK_AUTH;
    console.log(`[TopGG] Requête webhook reçue (${req.method} ${req.url}).`);
    if (!secret) {
        console.error('[TopGG] TOPGG_WEBHOOK_AUTH absent : webhook refusé.');
        res.writeHead(503); return res.end();
    }
    let corps = '';
    req.on('data', c => {
        corps += c;
        if (corps.length > 20000) { res.writeHead(413); res.end(); req.destroy(); }
    });
    req.on('end', () => {
        // Authentification : ancien format (Authorization) OU nouveau format (signature HMAC)
        const recu = req.headers.authorization || '';
        const signature = req.headers['x-topgg-signature'] || '';
        const okAuth = !!recu && egal(recu, secret);
        const okSignature = !!signature && signatureValide(signature, corps, secret);
        if (!okAuth && !okSignature) {
            console.error(`[TopGG] Authentification refusée (Authorization ${recu ? 'présent mais différent' : 'absent'}, signature ${signature ? 'invalide' : 'absente'}). Vérifie que TOPGG_WEBHOOK_AUTH = le secret du webhook top.gg. En-têtes reçus : ${Object.keys(req.headers).join(', ')}`);
            res.writeHead(401); return res.end();
        }
        let p;
        try { p = JSON.parse(corps); } catch { console.error('[TopGG] JSON invalide :', corps.slice(0, 300)); res.writeHead(400); return res.end(); }
        console.log('[TopGG] Payload :', corps.slice(0, 500));

        // Ancien format : { type, user, isWeekend } — nouveau format : { type, data: { user: { platform_id }, weight } }
        const userId = String(p?.user || p?.data?.user?.platform_id || p?.data?.user?.id || '');
        const type = String(p?.type || '');
        if (type === 'webhook.test' && !/^\d{5,25}$/.test(userId)) {
            console.log('[TopGG] Test reçu : webhook OK.');
            res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('OK');
        }
        if (!/^\d{5,25}$/.test(userId)) {
            console.error('[TopGG] Utilisateur introuvable dans le payload.');
            res.writeHead(400); return res.end();
        }
        if (type === 'test' || type === 'webhook.test') {
            console.log(`[TopGG] Test reçu (utilisateur ${userId}) : webhook OK.`);
        } else if (type === 'upvote' || type === 'vote.create') {
            const u = enregistrerVote(userId, !!(p.isWeekend ?? p.data?.weight === 2));
            console.log(`[TopGG] Vote de ${userId} (total ${u.totalVotes}, série ${u.streak}).`);
        } else {
            console.log(`[TopGG] Type ignoré : ${type}`);
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    });
}

// ── Rappels (MP quand le vote est de nouveau possible) ────────────────────
function demarrer(client) {
    clientRef = client;
    const LIEN = `https://top.gg/bot/${client.user?.id || process.env.CLIENT_ID || ''}/vote`;
    setInterval(async () => {
        if (!client.isReady()) return;
        const maintenant = Date.now();
        let change = false;
        for (const [id, u] of Object.entries(donnees.users)) {
            if (!u.reminder || u.reminderSent || !u.lastVoteAt) continue;
            if (maintenant < u.lastVoteAt + COOLDOWN_VOTE_MS) continue;
            u.reminderSent = true;
            change = true;
            try {
                const user = await client.users.fetch(id);
                await user.send({
                    content: `🗳️ Tu peux de nouveau voter pour **${client.user.username}** !` +
                        (serieActive(u, maintenant) ? `\n🔥 Série en cours : **${u.streak}** jour(s) — revote avant la fin des 36 h pour la garder.` : ''),
                    components: [{
                        type: 1,
                        components: [{ type: 2, style: 5, label: 'Voter', emoji: { name: '🗳️' }, url: LIEN }],
                    }],
                });
            } catch { /* MP fermés : on ne réessaie pas */ }
        }
        if (change) sauver();
    }, 60 * 1000).unref();
    console.log('[TopGG] Suivi des votes actif.');
}

module.exports = {
    utilisateur, lire, topVoteurs, enregistrerVote, xpAPayer, marquerRecupere, basculerRappel, peutRevoterA,
    estWeekend, serieActive, bonusSerie, handleWebhook, demarrer,
    XP_PAR_VOTE, VOTES_BADGE, COOLDOWN_VOTE_MS, GRACE_SERIE_MS,
};