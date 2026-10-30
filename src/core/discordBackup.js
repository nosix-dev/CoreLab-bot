// Sauvegarde automatique des données du bot dans un salon Discord privé (BACKUP_CHANNEL_ID).
// Les données sont envoyées régulièrement et à l'arrêt du bot (redéploiement Render = signal SIGTERM),
// puis restaurées par restore.js au démarrage suivant. Ça marche même sans disque persistant.
const zlib = require('zlib');
const { construire } = require('./backupBundle');
const { stockage, persister } = require('./data');

const CHANNEL_ID = process.env.BACKUP_CHANNEL_ID;
const INTERVALLE_MIN = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_MIN, 10) || 3);
const GARDER = 5; // nombre de sauvegardes conservées par type
const NOM_RE = /^corelab-backup-(data|images)-(\d+)-(\d+)of(\d+)\.json\.gz$/;

const dernierHash = { data: null, images: null };
let enCours = null;

async function envoyer(client, kind, force = false) {
    const { hash, parties } = construire(kind);
    if (!force && hash === dernierHash[kind]) return false;
    const channel = await client.channels.fetch(CHANNEL_ID);
    const ts = Date.now();
    for (let i = 0; i < parties.length; i++) {
        const buffer = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, kind, at: new Date(ts).toISOString(), files: parties[i].files })));
        const name = `corelab-backup-${kind}-${ts}-${i + 1}of${parties.length}.json.gz`;
        await channel.send({ content: `💾 Sauvegarde **${kind}** — ${Object.keys(parties[i].files).length} fichier(s) — ${(buffer.length / 1024).toFixed(0)} Ko`, files: [{ attachment: buffer, name }] });
    }
    dernierHash[kind] = hash;
    await purger(client, channel).catch(e => console.warn('[Backup] nettoyage ignoré :', e.message));
    return true;
}

// Supprime les anciennes sauvegardes (on garde les GARDER plus récentes de chaque type)
async function purger(client, channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    const groupes = { data: new Map(), images: new Map() };
    for (const m of messages.values()) {
        if (m.author.id !== client.user.id) continue;
        for (const a of m.attachments.values()) {
            const r = NOM_RE.exec(a.name || '');
            if (!r) continue;
            const g = groupes[r[1]];
            if (!g.has(r[2])) g.set(r[2], []);
            g.get(r[2]).push(m);
        }
    }
    for (const g of Object.values(groupes)) {
        const anciens = [...g.keys()].sort((a, b) => Number(b) - Number(a)).slice(GARDER);
        for (const ts of anciens) for (const m of g.get(ts)) await m.delete().catch(() => { });
    }
}

async function sauvegarderTout(client, force = false) {
    if (!CHANNEL_ID || !client?.isReady?.()) return;
    if (enCours) return enCours;
    enCours = (async () => {
        try {
            const d = await envoyer(client, 'data', force);
            const im = await envoyer(client, 'images', force);
            if (d || im) console.log(`[Backup] sauvegarde envoyée (${[d && 'données', im && 'images'].filter(Boolean).join(' + ')})`);
        } catch (e) {
            console.error('[Backup] échec :', e.message);
        } finally { enCours = null; }
    })();
    return enCours;
}

function installerArret(client) {
    let arret = false;
    const fin = async signal => {
        if (arret) return;
        arret = true;
        console.log(`[Backup] ${signal} reçu : sauvegarde finale…`);
        setTimeout(() => process.exit(0), 20000); // filet de sécurité
        try {
            for (const k of Object.keys(stockage)) { try { persister(k); } catch { /* ignoré */ } }
            await new Promise(r => setTimeout(r, 1000)); // laisse finir les écritures de fichiers
            await sauvegarderTout(client);
        } catch (e) { console.error('[Backup] sauvegarde finale :', e.message); }
        process.exit(0);
    };
    process.once('SIGTERM', () => fin('SIGTERM'));
    process.once('SIGINT', () => fin('SIGINT'));
}

function demarrer(client) {
    if (!CHANNEL_ID) {
        console.warn('[Backup] BACKUP_CHANNEL_ID absent : sauvegarde Discord désactivée.');
        return;
    }
    installerArret(client);
    setTimeout(() => sauvegarderTout(client), 60 * 1000);
    setInterval(() => sauvegarderTout(client), INTERVALLE_MIN * 60 * 1000);
    console.log(`[Backup] sauvegarde Discord active (toutes les ${INTERVALLE_MIN} min et à l'arrêt).`);
}

module.exports = { demarrer, sauvegarderTout };
