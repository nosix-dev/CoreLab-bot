// Mode maintenance : bloque les commandes et interactions des membres (le propriétaire du bot reste autorisé).
// L'état est sauvegardé dans maintenance.json (donc conservé après un redéploiement si DATA_DIR est défini)
// et peut s'arrêter tout seul après une durée.
//
// Commande propriétaire :
//   !maintenance on [durée] [raison]   ex. !maintenance on 30m Mise à jour des cartes
//   !maintenance off
//   !maintenance status
// Durée : 30m, 2h, 1j (sans lettre = minutes). Sans durée, la maintenance dure jusqu'au !maintenance off.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('./data');
const constants = require('./constants');

const FICHIER = 'maintenance.json';
const COULEUR = 0xE67E22;
const DELAI_MAX_TIMER = 2147483647;

let etat = Object.assign(
    { enabled: false, reason: null, since: null, until: null, by: null },
    chargerDonnees(FICHIER, {})
);
let timer = null;
let presenceAppliquee = false;
let clientRef = null;
const dernierAvis = new Map(); // userId -> timestamp du dernier avertissement (anti-spam)

function estProprietaire(id) {
    const ids = constants.OWNER_IDS;
    const liste = ids instanceof Set ? [...ids] : [].concat(ids || []);
    if (constants.BOT_OWNER_ID) liste.push(constants.BOT_OWNER_ID);
    return liste.map(String).includes(String(id));
}

function sauver() { sauvegarderDonnees(FICHIER, etat); }

function actif() {
    if (etat.enabled && etat.until && Date.now() >= etat.until) desactiver();
    return !!etat.enabled;
}

function planifier() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!etat.enabled || !etat.until) return;
    const reste = etat.until - Date.now();
    if (reste <= 0) return desactiver();
    timer = setTimeout(() => { timer = null; actif(); }, Math.min(reste, DELAI_MAX_TIMER));
    timer.unref?.();
}

function appliquerPresence(client = clientRef) {
    if (!client?.isReady?.()) return;
    try {
        if (etat.enabled) {
            if (presenceAppliquee) return;
            client.user.setPresence({ status: 'dnd', activities: [{ name: '🛠️ Maintenance en cours', type: 0 }] });
            presenceAppliquee = true;
        } else if (presenceAppliquee) {
            client.user.setPresence({ status: 'online', activities: [] }); // la rotation des statuts reprend ensuite
            presenceAppliquee = false;
        }
    } catch (e) { console.warn('[Maintenance] présence ignorée :', e.message); }
}

function activer({ raison = null, minutes = null, par = null } = {}) {
    etat = {
        enabled: true,
        reason: raison || null,
        since: Date.now(),
        until: minutes ? Date.now() + minutes * 60000 : null,
        by: par,
    };
    sauver(); planifier(); appliquerPresence();
}

function desactiver() {
    etat = { enabled: false, reason: null, since: null, until: null, by: null };
    sauver(); planifier(); appliquerPresence();
}

function embedMaintenance() {
    const e = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle('🛠️ Maintenance en cours')
        .setDescription(`Le bot est temporairement en maintenance, les commandes sont désactivées.\n${etat.reason ? `\n**Raison :** ${etat.reason}` : ''}`);
    if (etat.until) e.addFields({ name: 'Retour prévu', value: `<t:${Math.floor(etat.until / 1000)}:R>`, inline: true });
    if (etat.since) e.addFields({ name: 'Depuis', value: `<t:${Math.floor(etat.since / 1000)}:R>`, inline: true });
    return e;
}

// Bloque les interactions (slash, boutons, menus, formulaires, autocomplétion) des non-propriétaires.
// On enveloppe client.emit : ça couvre tous les listeners interactionCreate du bot d'un coup.
function installer(client) {
    clientRef = client;
    const emitOriginal = client.emit;
    client.emit = function (event, ...args) {
        if (event === 'interactionCreate' && actif()) {
            const i = args[0];
            if (i?.user && !estProprietaire(i.user.id)) {
                refuserInteraction(i);
                return true;
            }
        }
        return emitOriginal.call(this, event, ...args);
    };
}

function refuserInteraction(i) {
    try {
        if (i.isAutocomplete?.()) return void i.respond([]).catch(() => { });
        if (!i.isRepliable?.() || i.replied || i.deferred) return;
        i.reply({ embeds: [embedMaintenance()], flags: MessageFlags.Ephemeral }).catch(() => { });
    } catch { /* ignoré */ }
}

// Pour les commandes à préfixe (!help…) : renvoie true si le message doit être ignoré.
function bloquerPrefixe(message) {
    if (!actif() || estProprietaire(message.author.id)) return false;
    const id = message.author.id;
    const maintenant = Date.now();
    if ((dernierAvis.get(id) || 0) + 30000 < maintenant) {
        dernierAvis.set(id, maintenant);
        if (dernierAvis.size > 500) for (const [k, t] of dernierAvis) if (t + 30000 < maintenant) dernierAvis.delete(k);
        message.reply({ embeds: [embedMaintenance()], allowedMentions: { repliedUser: false } }).catch(() => { });
    }
    return true;
}

function lireDuree(texte) {
    const m = /^(\d+)\s*(m|min|h|j|d)?$/i.exec(texte || '');
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unite = (m[2] || 'm').toLowerCase();
    const minutes = unite === 'h' ? n * 60 : (unite === 'j' || unite === 'd') ? n * 1440 : n;
    return minutes > 0 ? minutes : null;
}

async function commande(message, client) {
    if (!estProprietaire(message.author.id)) {
        return void message.reply({ content: '❌ Cette commande est réservée au propriétaire du bot.', allowedMentions: { repliedUser: false } }).catch(() => { });
    }
    const args = message.content.slice(client.prefix.length).trim().split(/\s+/).slice(1);
    const sub = (args.shift() || 'status').toLowerCase();
    const repondre = embed => message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => { });
    const simple = (couleur, texte) => new EmbedBuilder().setColor(couleur).setDescription(texte);

    if (['on', 'activer', 'start'].includes(sub)) {
        const minutes = lireDuree(args[0]);
        if (minutes) args.shift();
        const raison = args.join(' ').trim().slice(0, 300) || null;
        activer({ raison, minutes, par: message.author.id });
        return repondre(simple(COULEUR, `🛠️ **Maintenance activée**${raison ? `\n**Raison :** ${raison}` : ''}\n${minutes ? `Fin automatique <t:${Math.floor(etat.until / 1000)}:R>.` : 'Pas de fin automatique : utilise `!maintenance off`.'}\nTu restes le seul à pouvoir utiliser le bot.`));
    }
    if (['off', 'desactiver', 'désactiver', 'stop'].includes(sub)) {
        if (!etat.enabled) return repondre(simple(0x95A5A6, 'ℹ️ La maintenance n\'est pas activée.'));
        desactiver();
        return repondre(simple(0x2ECC71, '✅ **Maintenance terminée**, le bot est de nouveau disponible pour tout le monde.'));
    }
    if (actif()) {
        return repondre(simple(COULEUR, `🛠️ **Maintenance activée** depuis <t:${Math.floor(etat.since / 1000)}:R>${etat.reason ? `\n**Raison :** ${etat.reason}` : ''}${etat.until ? `\nFin prévue <t:${Math.floor(etat.until / 1000)}:R>` : ''}`));
    }
    return repondre(simple(0x2ECC71, `✅ Maintenance désactivée.\n**Utilisation :** \`${client.prefix}maintenance on [durée] [raison]\` (ex. \`30m\`, \`2h\`, \`1j\`), \`${client.prefix}maintenance off\`, \`${client.prefix}maintenance status\``));
}

// À appeler au démarrage : reprend une maintenance en cours après un redémarrage/redéploiement.
function restaurer(client) {
    clientRef = client;
    if (actif()) { planifier(); appliquerPresence(client); }
}

module.exports = { installer, restaurer, actif, activer, desactiver, bloquerPrefixe, appliquerPresence, commande, estProprietaire };
