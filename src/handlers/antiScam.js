const { createWorker } = require('tesseract.js');
const axios = require('axios');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { store, persist } = require('../core/data');
const { sendLog } = require('../core/utils');
const { scanContentForPhishing } = require('../core/phishing');
const { glassPayload } = require('../core/glassEmbed');

// Alerte « verre fumé » postée dans le salon (supprimée au bout de 8 s)
async function alerteScam(message, texte) {
    const embed = new EmbedBuilder().setTitle('⚠️ Message supprimé').setDescription(texte).setColor(0xff0000);
    const payload = await glassPayload({ embeds: [embed], content: `${message.author}`, allowedMentions: { users: [message.author.id] } },
        { guild: message.guild, client: message.client, badge: 'ANTI-SCAM', avatar: message.author.displayAvatarURL({ extension: 'png', size: 256 }) });
    return message.channel.send(payload).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
}

// Mots-clés typiques des images d'arnaque (nitro gratuit, giveaway crypto, etc.)
const SCAM_KEYWORDS = [
    'nitro', 'free nitro', 'discord nitro', 'giveaway', 'airdrop',
    'claim', 'claim now', 'connect wallet', 'connect your wallet',
    'steam gift', 'free gift', 'you won', 'you have won',
    'verify your account', 'verify your account', 'limited offer',
];
const SCAM_THRESHOLD = 2; // nombre minimum de mots-clés trouvés pour agir

let worker = null;
let workerReady = null;

// IMPORTANT : tesseract.js jette une exception NON catchable (throw brut dans
// le handler du MessagePort du worker thread, pas une rejection de Promise)
// quand une image ne peut pas être lue et qu'aucun `errorHandler` n'est fourni
// à createWorker(). C'est ce qui provoquait le crash "Exception non gérée" —
// le try/catch autour de w.recognize() ne pouvait jamais l'intercepter.
// En fournissant errorHandler, on transforme ça en simple log.
async function getWorker() {
    if (!worker) {
        workerReady = createWorker('fra+eng', undefined, {
            errorHandler: (err) => {
                console.error('Erreur interne Tesseract (worker) :', err);
            },
        });
        worker = await workerReady;
    }
    return worker;
}

// Télécharge l'image nous-mêmes en Buffer plutôt que de laisser Tesseract
// gérer l'URL : ça évite les flux tronqués/timeouts côté CDN Discord qui
// provoquaient "Unknown format: no pix returned" / "truncated file".
async function downloadImageBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 15 * 1024 * 1024, // 15 Mo max
    });
    return Buffer.from(res.data);
}

async function ocrImageText(url) {
    const w = await getWorker();
    const buffer = await downloadImageBuffer(url);
    const { data } = await w.recognize(buffer);
    return (data.text || '').toLowerCase();
}

async function logAndStrike(message, type, detail) {
    const uid = String(message.author.id);
    if (!store.infractions[uid]) store.infractions[uid] = [];
    store.infractions[uid].push({
        type,
        detail,
        guild_id: message.guild.id,
        date: new Date().toISOString(),
    });
    persist('infractions');

    const embed = new EmbedBuilder()
        .setTitle(`🚨 ${type}`)
        .setColor(0xff0000)
        .addFields(
            { name: 'Membre', value: `${message.author} (${message.author.id})`, inline: true },
            { name: 'Salon', value: `${message.channel}`, inline: true },
            { name: 'Détail', value: detail.slice(0, 1000), inline: false },
        )
        .setTimestamp();
    await sendLog(message.guild, embed);
}

// ── Filtre anti-phishing (liens) ─────────────────────────────
async function handlePhishingCheck(message) {
    if (message.author.bot || !message.guild) return false;
    const cfg = getGuildConfig(message.guild.id);
    if (!cfg.anti_phishing) return false;

    const badUrl = scanContentForPhishing(message.content);
    if (!badUrl) return false;

    const me = message.guild.members.me;
    if (message.deletable && me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await message.delete().catch(() => {});
    }

    await alerteScam(message, 'Ton message contenait un lien suspect (phishing / IP logger) et a été supprimé.');

    await logAndStrike(message, 'Lien de phishing / IP logger', badUrl);
    return true;
}

// ── Filtre anti-arnaque image (OCR) ─────────────────────────────
async function handleScamImageCheck(message) {
    if (message.author.bot || !message.guild) return false;
    if (!message.attachments.size) return false;

    const cfg = getGuildConfig(message.guild.id);
    if (!cfg.anti_scam_image) return false;

    const images = [...message.attachments.values()].filter(a =>
        a.contentType?.startsWith('image/')
    );
    if (!images.length) return false;

    for (const img of images) {
        let text;
        try {
            text = await ocrImageText(img.url);
        } catch (e) {
            console.error('Erreur OCR anti-arnaque :', e.message);
            continue;
        }

        const hits = SCAM_KEYWORDS.filter(k => text.includes(k));
        const linkInText = scanContentForPhishing(text);

        if (hits.length >= SCAM_THRESHOLD || linkInText) {
            const me = message.guild.members.me;
            if (message.deletable && me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
                await message.delete().catch(() => {});
            }

            await alerteScam(message, 'Ton image ressemble à une arnaque (nitro / giveaway) et a été supprimée.');

            await logAndStrike(
                message,
                'Image d\'arnaque détectée (OCR)',
                `Mots-clés : ${hits.join(', ') || 'aucun'}${linkInText ? ` | Lien : ${linkInText}` : ''}`
            );
            return true;
        }
    }
    return false;
}

// ────────────────────────────────────────────────
// ENREGISTREMENT — même schéma que registerLogHandlers / registerWelcomeHandler
// IMPORTANT : ce listener doit être attaché AVANT celui de logs.js si tu veux
// éviter de logger un message qui va être supprimé (optionnel, cosmétique).
// ────────────────────────────────────────────────
function registerAntiScamHandler(client) {
    client.on('messageCreate', async message => {
        try {
            if (await handlePhishingCheck(message)) return;
            await handleScamImageCheck(message);
        } catch (e) {
            console.error('Erreur handler AntiScam :', e);
        }
    });
    console.log('✅ Anti-phishing / Anti-arnaque image (OCR) initialisé.');
}

module.exports = {
    handlePhishingCheck,
    handleScamImageCheck,
    registerAntiScamHandler,
};