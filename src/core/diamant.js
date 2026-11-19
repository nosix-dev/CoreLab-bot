'use strict';

const { stockage, persister } = require('./data');
const { DIAMANT_CONSTANTES: C } = require('./diamantConstants');

if (!stockage.diamants || typeof stockage.diamants !== 'object') stockage.diamants = {};

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getDiamant(userId) {
    const id = String(userId);
    return stockage.diamants[id] || null;
}

function createDiamant(userId, temperament, name) {
    const id = String(userId);
    if (getDiamant(id)) return { ok: false, reason: 'exists' };
    const safeName = String(name || '').trim().slice(0, C.NOM_MAX);
    if (!C.TEMPERAMENTS.includes(temperament) || !safeName) return { ok: false, reason: 'invalid' };
    stockage.diamants[id] = {
        name: safeName,
        temperament,
        xp: 0,
        level: 1,
        stage: 1,
        mood: 80,
        gems: 50,
        carbon: 10,
        jokers: 0,
        streak: 0,
        lastDaily: null,
        lastCare: null,
        lastNourrir: null,
        lastPolir: null,
        lastMessageAt: null,
        daily: { date: todayKey(), nourish: 0, polish: 0, messageGems: 0, voiceGems: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    persister('diamants');
    return { ok: true, diamant: stockage.diamants[id] };
}

function ensureDaily(d) {
    if (!d.daily || d.daily.date !== todayKey()) {
        d.daily = { date: todayKey(), nourish: 0, polish: 0, messageGems: 0, voiceGems: 0 };
    }
}

function getLevelAndStage(xp) {
    let stage = 1;
    for (const item of C.STADES) {
        if (xp >= item.xp) stage = item.niveau;
    }
    const level = 1 + Math.floor(Math.max(0, xp) / 100);
    return { level, stage };
}

function addXp(d, amount) {
    d.xp = Math.max(0, d.xp + amount);
    const info = getLevelAndStage(d.xp);
    d.level = info.level;
    d.stage = info.stage;
}

function applyMoodDecay(d) {
    if (!d.lastCare) return;
    const elapsed = Date.now() - new Date(d.lastCare).getTime();
    if (elapsed >= C.MOOD_DECAY_MS) {
        const periods = Math.floor(elapsed / C.MOOD_DECAY_MS);
        d.mood = Math.max(0, d.mood - periods * C.MOOD_DECAY);
        d.lastCare = new Date(Date.now() - (elapsed % C.MOOD_DECAY_MS)).toISOString();
    }
}

function nourishDiamant(userId) {
    const d = getDiamant(userId);
    if (!d) return { ok: false, reason: 'missing' };
    ensureDaily(d);
    applyMoodDecay(d);
    const now = Date.now();
    if (d.lastNourrir && now - new Date(d.lastNourrir).getTime() < C.NOURRIR.COOLDOWN_MS) {
        return { ok: false, reason: 'cooldown', remaining: C.NOURRIR.COOLDOWN_MS - (now - new Date(d.lastNourrir).getTime()) };
    }
    if (d.daily.nourish >= C.NOURRIR.PLAFOND_JOURNALIER) return { ok: false, reason: 'daily_limit' };
    if (d.carbon < 1) return { ok: false, reason: 'carbon' };

    d.carbon -= 1;
    d.daily.nourish++;
    d.lastNourrir = new Date(now).toISOString();
    d.lastCare = d.lastNourrir;

    let xp = C.NOURRIR.XP;
    let event = null;
    if (Math.random() < C.NOURRIR.XP_SCINTILLE_CHANCE) {
        xp *= C.NOURRIR.XP_SCINTILLE_MULTIPLICATEUR;
        event = 'sparkle';
    }
    if (Math.random() < C.NOURRIR.FACETTE_DORE_CHANCE) {
        d.gems += C.NOURRIR.GEMMES_FACETTE;
        event = event ? 'sparkle_gold' : 'gold';
    }
    addXp(d, xp);
    d.mood = Math.min(100, d.mood + C.NOURRIR.MOOD);
    d.updatedAt = new Date().toISOString();
    persister('diamants');
    return { ok: true, diamant: d, xp, event };
}

function polishDiamant(userId) {
    const d = getDiamant(userId);
    if (!d) return { ok: false, reason: 'missing' };
    ensureDaily(d);
    applyMoodDecay(d);
    const now = Date.now();
    if (d.lastPolir && now - new Date(d.lastPolir).getTime() < C.POLIR.COOLDOWN_MS) {
        return { ok: false, reason: 'cooldown', remaining: C.POLIR.COOLDOWN_MS - (now - new Date(d.lastPolir).getTime()) };
    }
    if (d.daily.polish >= C.POLIR.PLAFOND_JOURNALIER) return { ok: false, reason: 'daily_limit' };

    d.daily.polish++;
    d.lastPolir = new Date(now).toISOString();
    d.lastCare = d.lastPolir;
    d.mood = Math.min(100, d.mood + C.POLIR.MOOD);
    d.gems += C.POLIR.GEMMES;
    d.updatedAt = new Date(now).toISOString();
    persister('diamants');
    return { ok: true, diamant: d };
}

function claimDaily(userId) {
    const d = getDiamant(userId);
    if (!d) return { ok: false, reason: 'missing' };
    const now = new Date();
    if (d.lastDaily) {
        const elapsed = now.getTime() - new Date(d.lastDaily).getTime();
        if (elapsed < C.DAILY.COOLDOWN_MS) return { ok: false, reason: 'cooldown', remaining: C.DAILY.COOLDOWN_MS - elapsed };
    }

    const previous = d.lastDaily ? new Date(d.lastDaily) : null;
    const missedDay = previous ? (now.getTime() - previous.getTime() > 48 * 60 * 60 * 1000) : true;
    d.streak = missedDay ? 1 : d.streak + 1;
    d.lastDaily = now.toISOString();
    const gems = Math.min(C.DAILY.GEMMES_BASE + d.streak * C.DAILY.GEMMES_SERIE, C.DAILY.GEMMES_BASE + C.DAILY.GEMMES_MAX_SERIE);
    d.gems += gems;
    d.carbon = Math.min(100, d.carbon + 5);
    if (d.streak > 0 && d.streak % C.DAILY.JOKER_TOUTES_SERIES === 0) d.jokers++;
    d.updatedAt = now.toISOString();
    persister('diamants');
    return { ok: true, diamant: d, gems };
}

function getStage(d) {
    return C.STADES.find(stage => stage.niveau === d.stage) || C.STADES[0];
}

function addMessageGems(userId, guildId, channelId) {
    const d = getDiamant(userId);
    if (!d) return null;
    ensureDaily(d);
    if (d.daily.messageGems >= C.GAINS.MESSAGE_PLAFOND_JOUR) return null;
    if (d.lastMessageAt && Date.now() - new Date(d.lastMessageAt).getTime() < C.GAINS.MESSAGE_COOLDOWN_MS) return null;
    d.lastMessageAt = new Date().toISOString();
    d.daily.messageGems += C.GAINS.MESSAGE_GEMMES;
    d.gems += C.GAINS.MESSAGE_GEMMES;
    d.updatedAt = new Date().toISOString();
    persister('diamants');
    return C.GAINS.MESSAGE_GEMMES;
}

function addVoiceGems(userId) {
    const d = getDiamant(userId);
    if (!d) return null;
    ensureDaily(d);
    if (d.daily.voiceGems >= C.GAINS.VOCAL_PLAFOND_JOUR) return null;
    d.daily.voiceGems += C.GAINS.VOCAL_GEMMES;
    d.gems += C.GAINS.VOCAL_GEMMES;
    d.updatedAt = new Date().toISOString();
    persister('diamants');
    return C.GAINS.VOCAL_GEMMES;
}

module.exports = {
    getDiamant,
    createDiamant,
    nourishDiamant,
    polishDiamant,
    claimDaily,
    addXp,
    getLevelAndStage,
    getStage,
    addMessageGems,
    addVoiceGems,
};
