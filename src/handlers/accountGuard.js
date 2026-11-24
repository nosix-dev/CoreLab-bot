'use strict';

// ─────────────────────────────────────────────────────────────────────────
// accountGuard.js — 3 protections de messages
//   1. Anti-token / anti-secret   (cfg.anti_token_enabled)
//      Supprime tout message qui contient un token, un webhook, une clé d'API,
//      une clé privée ou une URL de base de données. Aucune sanction : c'est une fuite, pas une attaque.
//   2. Filtre de fichiers dangereux (cfg.dangerous_files_enabled)
//      Supprime les pièces jointes exécutables / scripts / macros (.exe, .bat, .scr, .ps1, .jar, .lnk, .docm…),
//      les faux noms (RLO ‹‮›) et les types MIME exécutables. Strike pour les membres non-staff.
//   3. Compte piraté (cfg.compromised_account_enabled)
//      Détecte un compte qui poste le même lien / fichier dans plusieurs salons en quelques secondes,
//      supprime ses messages, l'exclut 24 h, le prévient en MP et alerte le staff.
//
// Ce listener doit être enregistré AVANT celui de logs.js : le message est « muet » de façon synchrone
// pour que le secret ne soit jamais recopié dans les logs.
// ─────────────────────────────────────────────────────────────────────────

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { store, persist } = require('../core/data');
const { sendLog } = require('../core/utils');
const { sendProtectionEmbed } = require('../core/protectionLog');
const { mute } = require('../core/silentMessages');

const P = PermissionFlagsBits;

// ── 1. Secrets ───────────────────────────────────────────────────────────
function discordTokenValide(m) {
    // Le 1er segment d'un token Discord est l'ID du compte en base64 (que des chiffres une fois décodé)
    try {
        const id = Buffer.from(m.split('.')[0], 'base64').toString('utf8');
        return /^\d{17,20}$/.test(id);
    } catch { return false; }
}

const SECRETS = [
    { nom: 'Token Discord', re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/g, check: discordTokenValide },
    { nom: 'Token Discord (MFA)', re: /\bmfa\.[A-Za-z\d_-]{80,90}\b/g },
    { nom: 'Webhook Discord', re: /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d{17,20}\/[\w-]{60,}/gi },
    { nom: 'Token GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
    { nom: 'Token GitHub (fine-grained)', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
    { nom: 'Clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { nom: 'Clé API Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { nom: 'Clé Stripe', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g },
    { nom: 'Token Slack', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
    { nom: 'Clé API (OpenAI / Anthropic)', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/g },
    { nom: 'Token Telegram', re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
    { nom: 'Clé privée', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
    { nom: 'URL de base de données', re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@\S+/gi },
    { nom: 'Variable secrète (.env)', re: /\b(?:[A-Z0-9_]*TOKEN|[A-Z0-9_]*SECRET|API_?KEY|PASSWORD|PASSWD)\s*=\s*["']?[A-Za-z0-9_\-./+=]{16,}/g },
];

function masquer(s) {
    s = String(s);
    return s.length <= 10 ? '••••' : `${s.slice(0, 6)}••••••••${s.slice(-2)}`;
}

/** Retourne la liste des secrets trouvés : [{ nom, extrait }] */
function scannerSecrets(texte) {
    if (!texte) return [];
    const trouves = [];
    for (const s of SECRETS) {
        s.re.lastIndex = 0;
        for (const m of texte.matchAll(s.re)) {
            if (s.check && !s.check(m[0])) continue;
            trouves.push({ nom: s.nom, extrait: masquer(m[0]) });
        }
    }
    return trouves;
}

// ── 2. Fichiers dangereux ────────────────────────────────────────────────
const EXT_DANGEREUSES = new Set([
    'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'msi', 'msp', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
    'wsf', 'wsh', 'hta', 'jar', 'lnk', 'url', 'reg', 'dll', 'cpl', 'inf', 'scf', 'msc', 'chm',
    'gadget', 'application', 'apk', 'appimage', 'dmg', 'docm', 'xlsm', 'pptm', 'dotm', 'xlam',
]);
const MIME_DANGEREUX = /(x-msdownload|x-msdos-program|x-dosexec|x-executable|x-msi|java-archive|vnd\.android\.package-archive|x-sh\b|x-bat)/i;

function analyserFichier(att) {
    const nom = String(att.name || '');
    const bas = nom.toLowerCase();
    const ext = bas.includes('.') ? bas.split('.').pop() : '';
    if (/[\u202E\u202D\u2066-\u2069]/.test(nom)) return 'Nom de fichier falsifié (caractère de direction RLO)';
    if (EXT_DANGEREUSES.has(ext)) return `Extension dangereuse « .${ext} »`;
    if (att.contentType && MIME_DANGEREUX.test(att.contentType)) return `Type de fichier exécutable (${att.contentType.split(';')[0]})`;
    return null;
}

// ── 3. Compte piraté ─────────────────────────────────────────────────────
const FENETRE_MS = 60 * 1000;
const SEUIL_SALONS = 3;          // même message dans N salons différents
const SEUIL_SALONS_SCAM = 2;     // …ou N salons si le message sent l'arnaque
const TIMEOUT_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000;
const RE_LIEN = /https?:\/\/\S+|discord\.gg\/\S+|discord(?:app)?\.com\/invite\/\S+/i;
const RE_ARNAQUE = /(nitro|gift|free|airdrop|giveaway|claim|wallet|steam|crypto|bitcoin|casino|you won|vous avez gagn|cadeau|gratuit)/i;

const historique = new Map();    // `${guildId}:${userId}` -> [{ channelId, messageId, hash, ts }]
const dejaTraite = new Map();    // `${guildId}:${userId}` -> ts

setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of historique) {
        const rest = arr.filter(e => now - e.ts < FENETRE_MS);
        if (rest.length) historique.set(k, rest); else historique.delete(k);
    }
    for (const [k, ts] of dejaTraite) if (now - ts > COOLDOWN_MS) dejaTraite.delete(k);
}, 60 * 1000).unref?.();

function empreinte(message) {
    const txt = (message.content || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const pj = [...message.attachments.values()].map(a => (a.name || '').toLowerCase()).sort().join('|');
    return `${txt}#${pj}`;
}

function estStaff(member) {
    return !!member?.permissions?.has([P.Administrator], false)
        || !!member?.permissions?.has(P.ManageMessages)
        || !!member?.permissions?.has(P.ManageGuild);
}

// ── Utilitaires communs ──────────────────────────────────────────────────
function peutSupprimer(message) {
    const me = message.guild.members.me;
    return message.deletable && me?.permissions.has(P.ManageMessages);
}

async function alerteSalon(message, titre, texte) {
    try {
        const embed = new EmbedBuilder().setTitle(titre).setDescription(texte).setColor(0xe8510d);
        let payload = { embeds: [embed], content: `${message.author}`, allowedMentions: { users: [message.author.id] } };
        try {
            const { glassPayload } = require('../core/glassEmbed');
            payload = await glassPayload(payload, {
                guild: message.guild, client: message.client, badge: 'PROTECTION',
                avatar: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
            });
        } catch { /* repli : embed classique */ }
        const m = await message.channel.send(payload);
        setTimeout(() => m.delete().catch(() => {}), 12000);
    } catch (e) { console.error('[AccountGuard] alerte :', e.message); }
}

async function logStaff(guild, embed) {
    try { require('../core/threatCounter').inc('threats_blocked'); } catch { /* compteur du site */ }
    if (!(await sendProtectionEmbed(guild, embed))) await sendLog(guild, embed);
}

function strike(message, raison) {
    try {
        const uid = String(message.author.id);
        if (!store.warns[uid]) store.warns[uid] = [];
        store.warns[uid].push({ reason: raison, moderator: message.client.user.id, date: new Date().toISOString(), guild_id: message.guild.id });
        persist('warns');
        if (!store.infractions[uid]) store.infractions[uid] = [];
        store.infractions[uid].push({ type: raison, detail: '', guild_id: message.guild.id, date: new Date().toISOString() });
        persist('infractions');
        require('../core/discipline').apresStrike(message.guild, uid, { reason: raison }).catch(() => {});
    } catch (e) { console.error('[AccountGuard] strike :', e.message); }
}

// ── Handlers ─────────────────────────────────────────────────────────────
async function traiterSecrets(message, cfg) {
    if (!cfg.anti_token_enabled) return false;
    const trouves = scannerSecrets(message.content);
    if (!trouves.length) return false;

    mute(message.id); // synchrone : le secret n'ira jamais dans les logs
    if (peutSupprimer(message)) await message.delete().catch(() => {});

    const types = [...new Set(trouves.map(t => t.nom))];
    await alerteSalon(message, '🔐 Secret détecté',
        `Ton message contenait **${types.join(', ')}** et a été supprimé.\n` +
        '**Régénère-le tout de suite** (le contenu a pu être vu avant la suppression).');

    const embed = new EmbedBuilder()
        .setTitle('🔐 Fuite de secret bloquée').setColor(0xe8510d)
        .addFields(
            { name: 'Membre', value: `${message.author} (${message.author.id})`, inline: true },
            { name: 'Salon', value: `${message.channel}`, inline: true },
            { name: 'Type', value: types.join(', ').slice(0, 1000), inline: false },
            { name: 'Aperçu masqué', value: trouves.slice(0, 5).map(t => `\`${t.extrait}\``).join('\n'), inline: false },
        ).setTimestamp();
    await logStaff(message.guild, embed);
    return true;
}

async function traiterFichiers(message, cfg) {
    if (!cfg.dangerous_files_enabled || !message.attachments.size) return false;
    if (estStaff(message.member)) return false;

    const problemes = [];
    for (const att of message.attachments.values()) {
        const p = analyserFichier(att);
        if (p) problemes.push({ nom: att.name, raison: p });
    }
    if (!problemes.length) return false;

    if (peutSupprimer(message)) await message.delete().catch(() => {});
    await alerteSalon(message, '🚫 Fichier dangereux bloqué',
        `Ton message contenait un fichier dangereux (**${problemes[0].nom}**) et a été supprimé.`);

    strike(message, 'Fichier dangereux');
    const embed = new EmbedBuilder()
        .setTitle('🚫 Fichier dangereux bloqué').setColor(0xff0000)
        .addFields(
            { name: 'Membre', value: `${message.author} (${message.author.id})`, inline: true },
            { name: 'Salon', value: `${message.channel}`, inline: true },
            { name: 'Fichiers', value: problemes.slice(0, 5).map(p => `\`${p.nom}\` — ${p.raison}`).join('\n').slice(0, 1000), inline: false },
        ).setTimestamp();
    await logStaff(message.guild, embed);
    return true;
}

async function traiterComptePirate(message, cfg) {
    if (!cfg.compromised_account_enabled) return false;
    const contenu = message.content || '';
    const aLien = RE_LIEN.test(contenu);
    if (!aLien && !message.attachments.size) return false;

    const cle = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const hist = (historique.get(cle) || []).filter(e => now - e.ts < FENETRE_MS);
    hist.push({ channelId: message.channel.id, messageId: message.id, hash: empreinte(message), ts: now });
    historique.set(cle, hist);

    const meme = hist.filter(e => e.hash === hist[hist.length - 1].hash);
    const salons = new Set(meme.map(e => e.channelId));
    const arnaque = aLien && RE_ARNAQUE.test(contenu);
    const declenche = salons.size >= SEUIL_SALONS || (arnaque && salons.size >= SEUIL_SALONS_SCAM);
    if (!declenche) return false;
    if (dejaTraite.has(cle)) return false;
    dejaTraite.set(cle, now);

    const guild = message.guild;
    const membre = message.member || await guild.members.fetch(message.author.id).catch(() => null);
    const staff = estStaff(membre);

    // 1. Supprime les messages en cause (sauf compte staff : alerte seule, pas de suppression à l'aveugle)
    let supprimes = 0;
    if (!staff && guild.members.me?.permissions.has(P.ManageMessages)) {
        for (const e of meme) {
            mute(e.messageId);
            const ch = guild.channels.cache.get(e.channelId);
            const ok = await ch?.messages.delete(e.messageId).then(() => true).catch(() => false);
            if (ok) supprimes++;
        }
    }

    // 2. Exclusion 24 h + MP
    let exclu = false;
    if (!staff && membre?.moderatable && guild.members.me?.permissions.has(P.ModerateMembers)) {
        exclu = await membre.timeout(TIMEOUT_MS, 'Compte probablement piraté (même message dans plusieurs salons)').then(() => true).catch(() => false);
    }
    let mp = false;
    if (!staff) {
        const en = (cfg.language || 'fr') === 'en';
        const txt = en
            ? `⚠️ Your account looks **compromised** on **${guild.name}**: it posted the same link/file in several channels within seconds. Your messages were removed and you were muted for 24 h.\n\n**Change your password now, enable 2FA and revoke unknown apps** (Discord settings → Authorized Apps).`
            : `⚠️ Ton compte semble **piraté** sur **${guild.name}** : il a posté le même lien/fichier dans plusieurs salons en quelques secondes. Tes messages ont été supprimés et tu as été exclu 24 h.\n\n**Change ton mot de passe maintenant, active la double authentification et révoque les applications inconnues** (Paramètres Discord → Applications autorisées).`;
        mp = await message.author.send(txt).then(() => true).catch(() => false);
    }

    // 3. Alerte staff
    const embed = new EmbedBuilder()
        .setTitle(staff ? '🚨 Compte staff peut-être piraté' : '🚨 Compte probablement piraté').setColor(0xff0000)
        .addFields(
            { name: 'Membre', value: `${message.author} (${message.author.id})`, inline: true },
            { name: 'Salons touchés', value: `${salons.size}`, inline: true },
            { name: 'Actions', value: staff
                ? 'Aucune (membre du staff) — vérifie vite son compte.'
                : `Messages supprimés : ${supprimes}/${meme.length}\nExclusion 24 h : ${exclu ? 'oui' : 'non (permission/hiérarchie)'}\nMP envoyé : ${mp ? 'oui' : 'non (MP fermés)'}`, inline: false },
            { name: 'Message', value: (contenu || '(fichier)').slice(0, 300), inline: false },
        ).setTimestamp();
    await logStaff(guild, embed);
    return true;
}

async function analyser(message) {
    if (!message.guild || message.author?.bot || message.system) return;
    const cfg = getGuildConfig(message.guild.id);

    // 1) synchrone d'abord (mute avant que les logs ne lisent le message)
    if (await traiterSecrets(message, cfg)) return;
    if (await traiterFichiers(message, cfg)) return;
    await traiterComptePirate(message, cfg);
}

function registerAccountGuardHandler(client) {
    client.on('messageCreate', async message => {
        try { await analyser(message); } catch (e) { console.error('Erreur handler AccountGuard :', e); }
    });
    // Message modifié pour y glisser un secret après coup
    client.on('messageUpdate', async (before, after) => {
        try {
            if (!after.guild || after.author?.bot) return;
            if (after.partial) after = await after.fetch().catch(() => null);
            if (!after) return;
            const cfg = getGuildConfig(after.guild.id);
            await traiterSecrets(after, cfg);
        } catch (e) { console.error('Erreur AccountGuard (édition) :', e); }
    });
    console.log('✅ Anti-token / Fichiers dangereux / Compte piraté initialisé.');
}

module.exports = { registerAccountGuardHandler, scannerSecrets, analyserFichier };
