// Liste de domaines connus pour l'IP logging / phishing Discord.
// À enrichir au fil du temps (grabbers, faux nitro, faux steam...).
const DOMAINES_BLACKLISTES = [
    // IP loggers / grabbers connus
    'grabify.link', 'iplogger.org', 'iplogger.com', 'iplogger.ru',
    '2no.co', 'blasze.tk', 'blasze.com', 'yip.su', 'iploc.me',
    'ps3cfw.com', 'stopstalk.com', 'ipgrabber.ru', 'ipgeolocation.io',
    'gyazo.li', 'discoard.gift', 'linkgrabify.com',

    // Domaines de phishing "faux nitro" classiques
    'dlscord.com', 'discocd.com', 'discordgift.site', 'discord-nitro.com',
    'discordapp.gift', 'discordnitro.gift', 'discrod.com', 'dicsordapp.com',
    'discordn.gift', 'steamcommmunity.com', 'steamcomunnity.com',
    'steancommunity.com', 'stearncommunity.com',
];

// Motifs regex pour repérer les typosquats de discord.gg / discord.com / steamcommunity.com
const MOTIFS_SUSPECTS = [
    /d[il1]sc[o0]rd[^.]*\.(gift|link|click|site|xyz|top|club|fun|icu)/i,
    /steam[cç][o0]mm?unity[^.]*\.(com|net|xyz|click|top)/i,
    /free[-_]?nitro/i,
    /nitro[-_]?free/i,
];

const REGEX_URL = /(https?:\/\/[^\s<>"']+)/gi;

function extraireUrls(contenu) {
    return [...(contenu.matchAll(REGEX_URL))].map(m => m[1]);
}

function estMalveillant(url) {
    let nomHote;
    try {
        nomHote = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return false;
    }

    if (DOMAINES_BLACKLISTES.some(d => nomHote === d || nomHote.endsWith(`.${d}`))) {
        return true;
    }

    return MOTIFS_SUSPECTS.some(re => re.test(url));
}

function analyserContenuPhishing(contenu) {
    if (!contenu) return null;
    const urls = extraireUrls(contenu);
    for (const url of urls) {
        if (estMalveillant(url)) return url;
    }
    return null;
}

module.exports = {
    // exports français d'origine
    analyserContenuPhishing,
    estMalveillant,
    extraireUrls,
    DOMAINES_BLACKLISTES,
    MOTIFS_SUSPECTS,

    // alias anglais — pour compatibilité avec antiScam.js
    scanContentForPhishing: analyserContenuPhishing,
};