// Mode « mise à jour » : permet d'annoncer une mise à jour du BOT ou du SITE.
// L'état est sauvegardé dans update_mode.json (conservé après un redémarrage).
//
// Commande propriétaire :
//   !update 5.5.5 1/11/2026            → affiche deux boutons : 🤖 Bot / 🌐 Site
//   !update bot 5.5.5 1/11/2026        → lance directement la mise à jour du bot (statut « Mise à jour du bot … en cours »)
//   !update site 5.5.5 1/11/2026       → lance directement la mise à jour du site (statut « Mise à jour du site … en cours » + /status → update.site)
//   !update off                        → arrête (si bot ET site sont actifs : boutons Bot / Site / Les deux)
//   !update bot off  |  !update site off
//   !update status                     → affiche l'état du bot et du site
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags,
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('./data');
const maintenance = require('./maintenance');

const FICHIER = 'update_mode.json';
const COULEUR = 0xE8510D;
const DELAI_CHOIX = 60000;
const MOTS_OFF = ['off', 'stop', 'fin', 'terminé', 'termine'];

const CIBLES = {
    bot: { label: 'Bot', emoji: '🤖', de: 'du bot' },
    site: { label: 'Site', emoji: '🌐', de: 'du site' },
};

const vide = () => ({ enabled: false, version: null, date: null, since: null, by: null });

// Charge l'état. Gère l'ancien format (un seul état à plat, qui correspondait au bot).
function chargerEtat() {
    const brut = chargerDonnees(FICHIER, {}) || {};
    if (brut.bot || brut.site) {
        return { bot: Object.assign(vide(), brut.bot), site: Object.assign(vide(), brut.site) };
    }
    return { bot: Object.assign(vide(), brut), site: vide() };
}

let etat = chargerEtat();
let presenceAppliquee = false;

function sauver() { sauvegarderDonnees(FICHIER, etat); }

// Une mise à jour (bot ou site) est-elle en cours ? (utilisé par la rotation des statuts dans index.js :
// tant que c'est vrai, la rotation normale est suspendue et le statut de mise à jour est affiché sous le nom du bot)
function actif() { return !!(etat.bot.enabled || etat.site.enabled); }

// État public (sans l'ID de l'auteur) : à exposer dans /status pour que le site puisse afficher un bandeau.
function etatPublic() {
    const pub = e => ({ enabled: !!e.enabled, version: e.version, date: e.date, since: e.since });
    return { bot: pub(etat.bot), site: pub(etat.site) };
}

function texteStatut(cible = 'bot') {
    const c = CIBLES[cible];
    return `${cible === 'bot' ? '🔄' : c.emoji} Mise à jour ${c.de} ${etat[cible].version} en cours`.slice(0, 128);
}

let tour = 0;
// Appelée à chaque tour de la rotation des statuts (toutes les 10 s) et à l'activation / désactivation.
// Le texte apparaît sous le nom du bot. Si le bot ET le site sont en mise à jour, les deux textes alternent.
function appliquerPresence(client) {
    if (!client?.isReady?.()) return;
    try {
        const actifs = ['bot', 'site'].filter(k => etat[k].enabled);
        if (actifs.length) {
            const cible = actifs[tour++ % actifs.length];
            client.user.setPresence({ status: etat.bot.enabled ? 'dnd' : 'online', activities: [{ name: texteStatut(cible), type: 0 }] });
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

const simple = (couleur, texte) => new EmbedBuilder().setColor(couleur).setDescription(texte);

function embedDemarrage(cible, client) {
    const c = CIBLES[cible];
    const e = etat[cible];
    const embed = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle(`${c.emoji} Mise à jour ${c.de} ${e.version} en cours`)
        .setDescription(cible === 'bot'
            ? `Le bot est en cours de mise à jour.\nStatut : « ${texteStatut('bot')} »`
            : `Le site est en cours de mise à jour.\nStatut : « ${texteStatut('site')} »\nL'information est aussi disponible pour le site via \`/status\` (\`update.site\`).`)
        .addFields({ name: 'Version', value: e.version, inline: true });
    if (e.date) embed.addFields({ name: 'Date', value: e.date, inline: true });
    embed.setFooter({ text: `Pour arrêter : ${client.prefix}update ${cible} off` });
    return embed;
}

function demarrer(cible, version, date, auteurId, client) {
    etat[cible] = {
        enabled: true,
        version: formaterVersion(version).slice(0, 40),
        date: date ? date.slice(0, 60) : null,
        since: Date.now(),
        by: auteurId,
    };
    sauver();
    appliquerPresence(client);
    return embedDemarrage(cible, client);
}

function arreter(cible, client) {
    const c = CIBLES[cible];
    if (!etat[cible].enabled) return simple(0x95A5A6, `ℹ️ Aucune mise à jour ${c.de} en cours.`);
    const version = etat[cible].version;
    etat[cible] = vide();
    sauver();
    appliquerPresence(client);
    return simple(0x2ECC71, `✅ **Mise à jour ${c.de} ${version} terminée.**${actif() ? '' : ' Le statut du bot est revenu à la normale.'}`);
}

function embedStatut(client, aide) {
    const lignes = Object.entries(CIBLES).map(([cle, c]) => {
        const e = etat[cle];
        if (!e.enabled) return `${c.emoji} **${c.label}** : aucune mise à jour en cours.`;
        return `${c.emoji} **${c.label}** : 🔄 mise à jour **${e.version}** en cours depuis <t:${Math.floor(e.since / 1000)}:R>${e.date ? ` (date : ${e.date})` : ''}`;
    });
    const aucune = !etat.bot.enabled && !etat.site.enabled;
    return new EmbedBuilder()
        .setColor(aucune ? 0x95A5A6 : COULEUR)
        .setTitle('🔄 État des mises à jour')
        .setDescription(lignes.join('\n') + (aucune ? `\n\n${aide}` : ''));
}

// Affiche des boutons, attend le choix du propriétaire, puis appelle appliquer(idChoisi) -> tableau d'embeds.
async function proposerChoix(message, { embed, boutons, appliquer }) {
    const rangee = new ActionRowBuilder().addComponents(boutons.map(b =>
        new ButtonBuilder()
            .setCustomId(`upd:${message.id}:${b.id}`)
            .setLabel(b.label)
            .setEmoji(b.emoji)
            .setStyle(b.style || ButtonStyle.Primary)
    ));
    const msg = await message.reply({ embeds: [embed], components: [rangee], allowedMentions: { repliedUser: false } }).catch(() => null);
    if (!msg) return;

    const col = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: DELAI_CHOIX });
    col.on('collect', async i => {
        if (!i.customId.startsWith(`upd:${message.id}:`)) return;
        if (i.user.id !== message.author.id) {
            return void i.reply({ content: '❌ Seul l\'auteur de la commande peut choisir.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        const choix = i.customId.split(':')[2];
        col.stop('choisi');
        let embeds;
        try { embeds = appliquer(choix); }
        catch (e) { console.error('[Update] :', e); embeds = [simple(0xE74C3C, '❌ Une erreur est survenue.')]; }
        await i.update({ embeds, components: [] }).catch(() => { });
    });
    col.on('end', (_, raison) => {
        if (raison === 'choisi') return;
        msg.edit({ embeds: [simple(0x95A5A6, '⏱️ Temps écoulé : aucune action effectuée.')], components: [] }).catch(() => { });
    });
}

async function commande(message, client) {
    if (!maintenance.estProprietaire(message.author.id)) {
        return void message.reply({ content: '❌ Cette commande est réservée au propriétaire du bot.', allowedMentions: { repliedUser: false } }).catch(() => { });
    }
    const p = client.prefix;
    const brut = message.content.slice(p.length).trim().replace(/^\S+\s*/, '');
    const repondre = embed => message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => { });
    const aide = [
        '**Utilisation :**',
        `\`${p}update 5.6.0 date: 12/11/2026\` → choix **Bot** ou **Site**`,
        `\`${p}update bot 5.6.0 date: 12/11/2026\` / \`${p}update site 5.6.0\``,
        `\`${p}update off\` · \`${p}update bot off\` · \`${p}update site off\``,
        `\`${p}update status\``,
    ].join('\n');

    // Découpe : [bot|site] éventuel, puis le reste
    const mots = brut.split(/\s+/).filter(Boolean);
    const estCible = m => !!m && Object.prototype.hasOwnProperty.call(CIBLES, m.toLowerCase());
    let cible = null;
    if (estCible(mots[0])) cible = mots.shift().toLowerCase();                                   // "bot off", "site 5.6.0"
    else if (MOTS_OFF.includes((mots[0] || '').toLowerCase()) && estCible(mots[1])) cible = mots.splice(1, 1)[0].toLowerCase(); // "off bot"
    const reste = mots.join(' ');
    const premier = (mots[0] || '').toLowerCase();

    // --- Arrêt ---
    if (MOTS_OFF.includes(premier)) {
        if (cible) return repondre(arreter(cible, client));
        const actifs = Object.keys(CIBLES).filter(k => etat[k].enabled);
        if (actifs.length === 0) return repondre(simple(0x95A5A6, 'ℹ️ Aucune mise à jour en cours (ni bot, ni site).'));
        if (actifs.length === 1) return repondre(arreter(actifs[0], client));
        return proposerChoix(message, {
            embed: simple(COULEUR, 'Le bot **et** le site sont en mise à jour. Que veux-tu arrêter ?'),
            boutons: [
                { id: 'bot', label: CIBLES.bot.label, emoji: CIBLES.bot.emoji, style: ButtonStyle.Success },
                { id: 'site', label: CIBLES.site.label, emoji: CIBLES.site.emoji, style: ButtonStyle.Success },
                { id: 'tous', label: 'Les deux', emoji: '✅', style: ButtonStyle.Secondary },
            ],
            appliquer: id => (id === 'tous' ? ['bot', 'site'] : [id]).map(k => arreter(k, client)),
        });
    }

    // --- Statut ---
    if (!reste || premier === 'status') {
        if (cible && !reste) {
            const e = etat[cible];
            const c = CIBLES[cible];
            return repondre(e.enabled
                ? simple(COULEUR, `${c.emoji} **Mise à jour ${c.de} ${e.version} en cours** depuis <t:${Math.floor(e.since / 1000)}:R>${e.date ? `\n**Date :** ${e.date}` : ''}`)
                : simple(0x95A5A6, `ℹ️ Aucune mise à jour ${c.de} en cours.`));
        }
        return repondre(embedStatut(client, aide));
    }

    // --- Démarrage ---
    const { version, date } = lireArguments(reste);
    if (!version) return repondre(simple(0xE74C3C, `❌ Version manquante.\n${aide}`));

    if (cible) return repondre(demarrer(cible, version, date, message.author.id, client));

    const apercu = `${formaterVersion(version)}${date ? ` · ${date}` : ''}`;
    return proposerChoix(message, {
        embed: simple(COULEUR, `🔄 Mise à jour **${apercu}**\nQu'est-ce qui est mis à jour ?`),
        boutons: [
            { id: 'bot', label: CIBLES.bot.label, emoji: CIBLES.bot.emoji },
            { id: 'site', label: CIBLES.site.label, emoji: CIBLES.site.emoji },
        ],
        appliquer: id => [demarrer(id, version, date, message.author.id, client)],
    });
}

// À appeler au démarrage : reprend le statut si une mise à jour (bot ou site) était en cours.
function restaurer(client) {
    if (actif()) appliquerPresence(client);
}

module.exports = { commande, actif, etatPublic, appliquerPresence, restaurer };