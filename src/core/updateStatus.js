// Mode « mise à jour » : change le statut du bot en « Mise à jour vX en cours ».
// L'état est sauvegardé dans update_mode.json (conservé après un redémarrage).
//
// Commande propriétaire :
//   !update 5.5.5 1/11/2026          → active le statut + annonce dans le salon
//   !update off                      → remet la rotation normale des statuts
//   !update status                   → affiche l'état actuel
const { EmbedBuilder } = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('./data');
const maintenance = require('./maintenance');

const FICHIER = 'update_mode.json';
const COULEUR = 0xE8510D;

let etat = Object.assign(
    { enabled: false, version: null, date: null, since: null, by: null },
    chargerDonnees(FICHIER, {})
);
let presenceAppliquee = false;

function sauver() { sauvegarderDonnees(FICHIER, etat); }

function actif() { return !!etat.enabled; }

function texteStatut() {
    return `🔄 Mise à jour ${etat.version} en cours`.slice(0, 128);
}

// Appelée à chaque tour de la rotation des statuts (toutes les 10 s) et à l'activation / désactivation.
function appliquerPresence(client) {
    if (!client?.isReady?.()) return;
    try {
        if (etat.enabled) {
            client.user.setPresence({ status: 'dnd', activities: [{ name: texteStatut(), type: 0 }] });
            presenceAppliquee = true;
        } else if (presenceAppliquee) {
            client.user.setPresence({ status: 'online', activities: [] }); // la rotation des statuts reprend ensuite
            presenceAppliquee = false;
        }
    } catch (e) { console.warn('[Update] présence ignorée :', e.message); }
}

// "5.6.0" -> "v5.6.0" ; "v5.6.0" reste inchangé
function formaterVersion(v) {
    const t = String(v || '').trim();
    return /^v/i.test(t) ? `v${t.slice(1)}` : `v${t}`;
}

// "5.5.5 1/11/2026" ou "5.5.5 date: 1/11/2026" -> { version: "5.5.5", date: "1/11/2026" }
function lireArguments(texte) {
    const m = /^(\S+)\s*(?:date\s*:\s*)?(.*)$/i.exec(texte.trim());
    if (!m) return { version: '', date: null };
    return { version: m[1].trim(), date: m[2].trim() || null };
}

async function commande(message, client) {
    if (!maintenance.estProprietaire(message.author.id)) {
        return void message.reply({ content: '❌ Cette commande est réservée au propriétaire du bot.', allowedMentions: { repliedUser: false } }).catch(() => { });
    }
    const brut = message.content.slice(client.prefix.length).trim().replace(/^\S+\s*/, '');
    const repondre = embed => message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => { });
    const simple = (couleur, texte) => new EmbedBuilder().setColor(couleur).setDescription(texte);
    const aide = `**Utilisation :** \`${client.prefix}update 5.6.0 date: 12/11/2026\`, \`${client.prefix}update off\`, \`${client.prefix}update status\``;

    const premier = brut.split(/\s+/)[0].toLowerCase();

    if (['off', 'stop', 'fin', 'terminé', 'termine'].includes(premier)) {
        if (!etat.enabled) return repondre(simple(0x95A5A6, 'ℹ️ Aucune mise à jour en cours.'));
        const version = etat.version;
        etat = { enabled: false, version: null, date: null, since: null, by: null };
        sauver(); appliquerPresence(client);
        return repondre(simple(0x2ECC71, `✅ **Mise à jour ${version} terminée.** Le statut du bot est revenu à la normale.`));
    }

    if (!brut || premier === 'status') {
        if (etat.enabled) {
            return repondre(simple(COULEUR, `🔄 **Mise à jour ${etat.version} en cours** depuis <t:${Math.floor(etat.since / 1000)}:R>${etat.date ? `\n**Date :** ${etat.date}` : ''}`));
        }
        return repondre(simple(0x95A5A6, `ℹ️ Aucune mise à jour en cours.\n${aide}`));
    }

    const { version, date } = lireArguments(brut);
    if (!version) return repondre(simple(0xE74C3C, `❌ Version manquante.\n${aide}`));

    etat = {
        enabled: true,
        version: formaterVersion(version).slice(0, 40),
        date: date ? date.slice(0, 60) : null,
        since: Date.now(),
        by: message.author.id,
    };
    sauver(); appliquerPresence(client);

    const embed = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle(`🔄 Mise à jour ${etat.version} en cours`)
        .setDescription(`Le bot est en cours de mise à jour.\nStatut : « ${texteStatut()} »`)
        .addFields({ name: 'Version', value: etat.version, inline: true });
    if (etat.date) embed.addFields({ name: 'Date', value: etat.date, inline: true });
    embed.setFooter({ text: `Pour arrêter : ${client.prefix}update off` });
    return repondre(embed);
}

// À appeler au démarrage : reprend le statut si une mise à jour était en cours.
function restaurer(client) {
    if (etat.enabled) appliquerPresence(client);
}

module.exports = { commande, actif, appliquerPresence, restaurer };
