'use strict';

const DIAMANT_CONSTANTES = {
    FICHIER: 'diamants.json',
    TEMPERAMENTS: ['Vif', 'Calme', 'Sauvage', 'Curieux'],
    STADES: [
        { niveau: 1, nom: 'Éclat', xp: 0, svg: 'assets/diamant/1-eclat.svg' },
        { niveau: 2, nom: 'Cristal', xp: 250, svg: 'assets/diamant/2-cristal.svg' },
        { niveau: 3, nom: 'Gemme', xp: 900, svg: 'assets/diamant/3-gemme.svg' },
        { niveau: 4, nom: 'Joyau', xp: 2200, svg: 'assets/diamant/4-joyau.svg' },
        { niveau: 5, nom: 'Diamant pur', xp: 5000, svg: 'assets/diamant/5-diamant-pur.svg' },
    ],
    NOURRIR: {
        COOLDOWN_MS: 60 * 1000,
        PLAFOND_JOURNALIER: 30,
        XP: 18,
        MOOD: 4,
        XP_SCINTILLE_CHANCE: 0.10,
        XP_SCINTILLE_MULTIPLICATEUR: 4,
        FACETTE_DORE_CHANCE: 0.03,
        GEMMES_FACETTE: 10,
    },
    POLIR: {
        COOLDOWN_MS: 2 * 60 * 1000,
        PLAFOND_JOURNALIER: 20,
        MOOD: 10,
        GEMMES: 2,
    },
    GAINS: {
        MESSAGE_COOLDOWN_MS: 60 * 1000,
        MESSAGE_GEMMES: 2,
        MESSAGE_PLAFOND_JOUR: 40,
        VOCAL_INTERVALLE_MS: 5 * 60 * 1000,
        VOCAL_GEMMES: 5,
        VOCAL_PLAFOND_JOUR: 50,
    },
    DAILY: {
        COOLDOWN_MS: 20 * 60 * 60 * 1000,
        GEMMES_BASE: 25,
        GEMMES_SERIE: 5,
        GEMMES_MAX_SERIE: 50,
        JOKER_TOUTES_SERIES: 7,
    },
    MOOD_DECAY_MS: 24 * 60 * 60 * 1000,
    MOOD_DECAY: 8,
    NOM_MAX: 24,
};

module.exports = { DIAMANT_CONSTANTES };
