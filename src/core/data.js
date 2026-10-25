const fs = require('fs');
const path = require('path');
const { FICHIERS } = require('./constants');

const RACINE = path.join(__dirname, '..', '..');

function chargerDonnees(cheminFichier, valeurParDefaut = {}) {
    const cheminComplet = path.isAbsolute(cheminFichier) ? cheminFichier : path.join(RACINE, cheminFichier);
    if (!fs.existsSync(cheminComplet)) return structuredClone(valeurParDefaut);
    try {
        return JSON.parse(fs.readFileSync(cheminComplet, 'utf8'));
    } catch (erreur) {
        console.error(`Erreur lecture ${cheminFichier}:`, erreur.message);
        return structuredClone(valeurParDefaut);
    }
}

// Écritures en attente, par chemin de fichier, pour sérialiser les sauvegardes
// successives d'un même fichier sans jamais bloquer la boucle d'événements
// (fs.writeFileSync gèle tout Node.js pendant l'écriture — problématique sur
// un disque lent/hébergement mutualisé, ça peut faire timeout les interactions
// Discord en cours ailleurs dans le bot).
const ecrituresEnCours = new Map();

function sauvegarderDonnees(cheminFichier, donnees) {
    const cheminComplet = path.isAbsolute(cheminFichier) ? cheminFichier : path.join(RACINE, cheminFichier);
    // Sérialisé immédiatement pour figer l'état actuel de `donnees`
    // (au cas où l'objet serait remuté juste après cet appel).
    let json;
    try {
        json = JSON.stringify(donnees, null, 4);
    } catch (erreur) {
        console.error(`Erreur sérialisation ${cheminFichier}:`, erreur.message);
        return Promise.resolve();
    }

    const precedente = ecrituresEnCours.get(cheminComplet) || Promise.resolve();
    const tache = precedente
        .catch(() => {}) // une écriture précédente en échec ne doit pas bloquer les suivantes
        .then(() => fs.promises.writeFile(cheminComplet, json, 'utf8'))
        .catch(erreur => {
            console.error(`Erreur sauvegarde ${cheminFichier}:`, erreur.message);
        });

    ecrituresEnCours.set(cheminComplet, tache);
    return tache;
}

const stockage = {
    configuration: chargerDonnees(FICHIERS.CONFIGURATION),
    avertissements: chargerDonnees(FICHIERS.AVERTISSEMENTS),
    donneesSourdine: chargerDonnees(FICHIERS.SOURDINE),
    donneesBannissement: chargerDonnees(FICHIERS.BANNISSEMENT),
    tableauEtoiles: chargerDonnees(FICHIERS.TABLEAU_ETOILES),
    starboardMessages: chargerDonnees(FICHIERS.STARBOARD_MESSAGES, {}),
    anniversaires: chargerDonnees(FICHIERS.ANNIVERSAIRES),
    notifsYoutube: chargerDonnees(FICHIERS.YOUTUBE),
    notifsBlog: chargerDonnees(FICHIERS.BLOG),
    notifsMedaille: chargerDonnees(FICHIERS.MEDAILLE),
    notifsTiktok: chargerDonnees(FICHIERS.TIKTOK),
    donneesXp: chargerDonnees(FICHIERS.XP),
    rappels: chargerDonnees(FICHIERS.RAPPELS, { reminders: [] }),
    evenements: chargerDonnees(FICHIERS.EVENEMENTS, { events: [] }),
    sondages: chargerDonnees(FICHIERS.SONDAGES, {}),
    concours: chargerDonnees(FICHIERS.CONCOURS, {}),
    rolesReaction: chargerDonnees(FICHIERS.ROLES_REACTION),
    detectionPiratage: chargerDonnees(FICHIERS.COMPTES_PIRATES),
    rolesTemporaires: chargerDonnees(FICHIERS.ROLES_TEMPORAIRES),
    reponsesAuto: chargerDonnees(FICHIERS.REPONSE_AUTO),
    formulairesTicket: chargerDonnees(FICHIERS.FORMULAIRES_TICKET),
    formulaires: chargerDonnees(FICHIERS.FORMULAIRES),
    premium: chargerDonnees(FICHIERS.PREMIUM, { users: {}, customUsers: {}, totalUsers: {} }),
    traductionAuto: chargerDonnees(FICHIERS.TRADUCTION_AUTO),
    languesUtilisateur: chargerDonnees(FICHIERS.LANGUE_UTILISATEUR),
    sauvegardes: chargerDonnees(FICHIERS.SAUVEGARDES, {}),
    vocalTemporaire: chargerDonnees(FICHIERS.VOCAL_TEMPORAIRE),
    planifies: chargerDonnees(FICHIERS.PLANIFIES),
    purgeTemporaire: chargerDonnees(FICHIERS.PURGE_TEMPORAIRE),
    annonceVocale: chargerDonnees(FICHIERS.ANNONCE_VOCALE),
    motsInterdits: chargerDonnees(FICHIERS.MOTS_INTERDITS),
    infractions: chargerDonnees(FICHIERS.INFRACTIONS),
    logsDetailles: chargerDonnees(FICHIERS.LOGS_DETAILLES),
    partenariats: chargerDonnees(FICHIERS.PARTENARIATS),
    partenariatsAuto: chargerDonnees(FICHIERS.PARTENARIATS_AUTO),
    bannissementsTemporaires: chargerDonnees(FICHIERS.BANNISSEMENTS_TEMPORAIRES, {}),
    sourdinesTemporaires: chargerDonnees(FICHIERS.SOURDINES_TEMPORAIRES, {}),
    blacklistServeurs: chargerDonnees(FICHIERS.BLACKLIST_SERVEURS, {}),
    blacklistUtilisateurs: chargerDonnees(FICHIERS.BLACKLIST_UTILISATEURS, {}),
    boutonsDiffusion: chargerDonnees(FICHIERS.BOUTONS_DIFFUSION, { buttons: [] }),
    embedsPersonnalises: chargerDonnees(FICHIERS.EMBEDS_PERSONNALISES, {}),
    donneesEconomie: chargerDonnees(FICHIERS.ECONOMIE, {}),
    comptage: chargerDonnees(FICHIERS.COMPTAGE, {}),
};

// ────────────────────────────────────────────────
// ALIAS ANGLAIS sur le même objet "stockage"
// (même référence mémoire : lire/écrire via l'un ou
// l'autre nom modifie bien les mêmes données)
// ────────────────────────────────────────────────
stockage.config = stockage.configuration;
stockage.warns = stockage.avertissements;
stockage.muteData = stockage.donneesSourdine;
stockage.banData = stockage.donneesBannissement;
stockage.starboard = stockage.tableauEtoiles;
stockage.birthdays = stockage.anniversaires;
stockage.ytNotifs = stockage.notifsYoutube;
stockage.blogNotifs = stockage.notifsBlog;
stockage.medalNotifs = stockage.notifsMedaille;
stockage.tiktokNotifs = stockage.notifsTiktok;
stockage.xpData = stockage.donneesXp;
stockage.reminders = stockage.rappels;
stockage.events = stockage.evenements;
stockage.polls = stockage.sondages;
stockage.giveaways = stockage.concours;
stockage.reactionRoles = stockage.rolesReaction;
stockage.hackedDetection = stockage.detectionPiratage;
stockage.tempRoles = stockage.rolesTemporaires;
stockage.autoresponses = stockage.reponsesAuto;
stockage.ticketForms = stockage.formulairesTicket;
stockage.autoTranslate = stockage.traductionAuto;
stockage.userTranslationPrefs = stockage.languesUtilisateur;
stockage.scheduled = stockage.planifies;
stockage.partnerships = stockage.partenariats;
stockage.broadcastButtons = stockage.boutonsDiffusion;
stockage.economyData = stockage.donneesEconomie;

function persister(cle) {
    const correspondance = {
        // clés françaises d'origine
        configuration: FICHIERS.CONFIGURATION,
        avertissements: FICHIERS.AVERTISSEMENTS,
        donneesSourdine: FICHIERS.SOURDINE,
        donneesBannissement: FICHIERS.BANNISSEMENT,
        tableauEtoiles: FICHIERS.TABLEAU_ETOILES,
        starboardMessages: FICHIERS.STARBOARD_MESSAGES,
        anniversaires: FICHIERS.ANNIVERSAIRES,
        notifsYoutube: FICHIERS.YOUTUBE,
        notifsBlog: FICHIERS.BLOG,
        notifsMedaille: FICHIERS.MEDAILLE,
        notifsTiktok: FICHIERS.TIKTOK,
        donneesXp: FICHIERS.XP,
        rappels: FICHIERS.RAPPELS,
        evenements: FICHIERS.EVENEMENTS,
        sondages: FICHIERS.SONDAGES,
        concours: FICHIERS.CONCOURS,
        rolesReaction: FICHIERS.ROLES_REACTION,
        detectionPiratage: FICHIERS.COMPTES_PIRATES,
        rolesTemporaires: FICHIERS.ROLES_TEMPORAIRES,
        reponsesAuto: FICHIERS.REPONSE_AUTO,
        formulairesTicket: FICHIERS.FORMULAIRES_TICKET,
        formulaires: FICHIERS.FORMULAIRES,
        premium: FICHIERS.PREMIUM,
        traductionAuto: FICHIERS.TRADUCTION_AUTO,
        languesUtilisateur: FICHIERS.LANGUE_UTILISATEUR,
        sauvegardes: FICHIERS.SAUVEGARDES,
        vocalTemporaire: FICHIERS.VOCAL_TEMPORAIRE,
        planifies: FICHIERS.PLANIFIES,
        purgeTemporaire: FICHIERS.PURGE_TEMPORAIRE,
        annonceVocale: FICHIERS.ANNONCE_VOCALE,
        motsInterdits: FICHIERS.MOTS_INTERDITS,
        infractions: FICHIERS.INFRACTIONS,
        logsDetailles: FICHIERS.LOGS_DETAILLES,
        partenariats: FICHIERS.PARTENARIATS,
        partenariatsAuto: FICHIERS.PARTENARIATS_AUTO,
        bannissementsTemporaires: FICHIERS.BANNISSEMENTS_TEMPORAIRES,
        sourdinesTemporaires: FICHIERS.SOURDINES_TEMPORAIRES,
        blacklistServeurs: FICHIERS.BLACKLIST_SERVEURS,
        blacklistUtilisateurs: FICHIERS.BLACKLIST_UTILISATEURS,
        boutonsDiffusion: FICHIERS.BOUTONS_DIFFUSION,
        embedsPersonnalises: FICHIERS.EMBEDS_PERSONNALISES,
        donneesEconomie: FICHIERS.ECONOMIE,
        comptage: FICHIERS.COMPTAGE,

        // alias anglais (mêmes fichiers, clés différentes)
        config: FICHIERS.CONFIGURATION,
        warns: FICHIERS.AVERTISSEMENTS,
        muteData: FICHIERS.SOURDINE,
        banData: FICHIERS.BANNISSEMENT,
        starboard: FICHIERS.TABLEAU_ETOILES,
        birthdays: FICHIERS.ANNIVERSAIRES,
        ytNotifs: FICHIERS.YOUTUBE,
        blogNotifs: FICHIERS.BLOG,
        medalNotifs: FICHIERS.MEDAILLE,
        tiktokNotifs: FICHIERS.TIKTOK,
        xpData: FICHIERS.XP,
        reminders: FICHIERS.RAPPELS,
        events: FICHIERS.EVENEMENTS,
        polls: FICHIERS.SONDAGES,
        giveaways: FICHIERS.CONCOURS,
        reactionRoles: FICHIERS.ROLES_REACTION,
        hackedDetection: FICHIERS.COMPTES_PIRATES,
        tempRoles: FICHIERS.ROLES_TEMPORAIRES,
        autoresponses: FICHIERS.REPONSE_AUTO,
        ticketForms: FICHIERS.FORMULAIRES_TICKET,
        autoTranslate: FICHIERS.TRADUCTION_AUTO,
        userTranslationPrefs: FICHIERS.LANGUE_UTILISATEUR,
        scheduled: FICHIERS.PLANIFIES,
        partnerships: FICHIERS.PARTENARIATS,
        broadcastButtons: FICHIERS.BOUTONS_DIFFUSION,
        economyData: FICHIERS.ECONOMIE,
    };
    if (correspondance[cle]) sauvegarderDonnees(correspondance[cle], stockage[cle]);
}

function obtenirCompartimentGuilde(idGuilde, compartiment, valeurParDefaut = []) {
    const id = String(idGuilde);
    if (!stockage[compartiment]) stockage[compartiment] = {};
    if (!stockage[compartiment][id]) stockage[compartiment][id] = valeurParDefaut;
    return stockage[compartiment][id];
}

function definirCompartimentGuilde(idGuilde, compartiment, valeur) {
    const id = String(idGuilde);
    if (!stockage[compartiment]) stockage[compartiment] = {};
    stockage[compartiment][id] = valeur;
    persister(compartiment);
}

module.exports = {
    // exports français d'origine (au cas où d'autres fichiers les utilisent déjà)
    chargerDonnees,
    sauvegarderDonnees,
    stockage,
    persister,
    RACINE,
    obtenirCompartimentGuilde,
    definirCompartimentGuilde,

    // alias anglais — pour compatibilité avec index.js
    loadData: chargerDonnees,
    saveData: sauvegarderDonnees,
    store: stockage,
    persist: persister,
    getGuildBucket: obtenirCompartimentGuilde,
    setGuildBucket: definirCompartimentGuilde,
};