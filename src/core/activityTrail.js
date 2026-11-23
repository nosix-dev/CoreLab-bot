// src/core/activityTrail.js : mémoire courte de l'activité des membres (5 dernières minutes).
// Quand un membre est signalé (/report), on copie ce qu'il vient de faire (messages envoyés,
// modifiés, supprimés, vocal, pseudo, réactions) dans le signalement, pour le relire dans le dashboard.
// Tout est gardé en mémoire vive, rien n'est écrit sur disque tant qu'il n'y a pas de signalement.

const FENETRE_MS = 5 * 60 * 1000;      // durée copiée dans un signalement
const RETENTION_MS = 6 * 60 * 1000;    // un peu plus, pour ne rien perdre au moment du signalement
const MAX_PAR_MEMBRE = 60;             // événements gardés en mémoire par membre
const MAX_SNAPSHOT = 30;               // événements copiés dans un signalement
const MAX_TEXTE = 200;                 // caractères gardés par message

// guildId -> Map(userId -> [événements])
const TRAIL = new Map();
// messageId -> { gid, uid } pour retrouver l'auteur d'un message supprimé ou modifié (messages « partiels »)
const AUTEURS = new Map();

const coupe = (t, n = MAX_TEXTE) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

function liste(gid, uid) {
  let g = TRAIL.get(gid);
  if (!g) { g = new Map(); TRAIL.set(gid, g); }
  let l = g.get(uid);
  if (!l) { l = []; g.set(uid, l); }
  return l;
}

function ajouter(gid, uid, evt) {
  const l = liste(gid, uid);
  l.push({ ts: Date.now(), ...evt });
  if (l.length > MAX_PAR_MEMBRE) l.splice(0, l.length - MAX_PAR_MEMBRE);
}

function trouverMessage(gid, uid, messageId) {
  const g = TRAIL.get(gid);
  const l = g && g.get(uid);
  if (!l) return null;
  for (let i = l.length - 1; i >= 0; i--) if (l[i].t === 'msg' && l[i].mid === messageId) return l[i];
  return null;
}

function nettoyer() {
  const limite = Date.now() - RETENTION_MS;
  for (const [gid, g] of TRAIL) {
    for (const [uid, l] of g) {
      while (l.length && l[0].ts < limite) l.shift();
      if (!l.length) g.delete(uid);
    }
    if (!g.size) TRAIL.delete(gid);
  }
  for (const [mid, a] of AUTEURS) {
    const e = trouverMessage(a.gid, a.uid, mid);
    if (!e || e.ts < limite) AUTEURS.delete(mid);
  }
}

/** Événements d'un membre sur les `ms` dernières millisecondes (du plus ancien au plus récent). */
function recent(gid, uid, ms = FENETRE_MS) {
  const l = TRAIL.get(String(gid))?.get(String(uid));
  if (!l) return [];
  const limite = Date.now() - ms;
  return l.filter(e => e.ts >= limite).slice(-MAX_SNAPSHOT).map(e => {
    const { mid, cur, ...reste } = e; // identifiant et texte courant restent en mémoire
    return reste;
  });
}

/** Résumé court pour l'embed du salon de signalement. */
function resume(activite) {
  const n = t => activite.filter(e => e.t === t).length;
  if (!activite.length) return 'Aucune activité enregistrée sur les 5 dernières minutes.';
  const p = [];
  if (n('msg')) p.push(`${n('msg')} message${n('msg') > 1 ? 's' : ''}`);
  if (n('edit')) p.push(`${n('edit')} modifié${n('edit') > 1 ? 's' : ''}`);
  if (n('delete')) p.push(`${n('delete')} supprimé${n('delete') > 1 ? 's' : ''}`);
  const autres = n('voice') + n('nick') + n('react');
  if (autres) p.push(`${autres} autre${autres > 1 ? 's' : ''}`);
  return `${p.join(' · ')} (5 dernières minutes) — détails dans le dashboard.`;
}

function enregistrer(client) {
  setInterval(nettoyer, 60 * 1000).unref?.();

  client.on('messageCreate', message => {
    try {
      if (!message.guild || !message.author || message.author.bot) return;
      const gid = message.guild.id, uid = message.author.id;
      ajouter(gid, uid, {
        t: 'msg', mid: message.id, channelId: message.channel?.id, channel: message.channel?.name || null,
        text: coupe(message.content) || null,
        files: message.attachments?.size || 0
      });
      AUTEURS.set(message.id, { gid, uid });
    } catch (e) { console.error('[activityTrail] messageCreate :', e.message); }
  });

  client.on('messageUpdate', (avant, apres) => {
    try {
      if (!apres.guild) return;
      const a = AUTEURS.get(apres.id);
      const uid = apres.author?.id || a?.uid;
      if (!uid || apres.author?.bot) return;
      const gid = apres.guild.id;
      const trace = trouverMessage(gid, uid, apres.id);
      const apresTxt = apres.content;
      if (apresTxt == null) return; // message partiel sans contenu
      const avantTxt = avant?.content != null ? avant.content : (trace?.cur ?? trace?.text);
      if (avantTxt != null && coupe(avantTxt, 5000) === coupe(apresTxt, 5000)) return; // pas un vrai changement de texte
      ajouter(gid, uid, {
        t: 'edit', channelId: apres.channel?.id, channel: apres.channel?.name || null,
        before: avantTxt != null ? coupe(avantTxt) : null,
        text: coupe(apresTxt)
      });
      if (trace) trace.cur = coupe(apresTxt); // le message garde son texte d'origine, l'édition garde « avant → après »
    } catch (e) { console.error('[activityTrail] messageUpdate :', e.message); }
  });

  const supprime = message => {
    try {
      if (!message.guild) return;
      const a = AUTEURS.get(message.id);
      const uid = message.author?.id || a?.uid;
      if (!uid || message.author?.bot) return;
      const gid = message.guild.id;
      const trace = trouverMessage(gid, uid, message.id);
      ajouter(gid, uid, {
        t: 'delete', channelId: message.channel?.id, channel: message.channel?.name || null,
        text: coupe(message.content != null ? message.content : (trace?.cur ?? trace?.text)) || null
      });
      AUTEURS.delete(message.id);
    } catch (e) { console.error('[activityTrail] messageDelete :', e.message); }
  };
  client.on('messageDelete', supprime);
  client.on('messageDeleteBulk', messages => { for (const m of messages.values()) supprime(m); });

  client.on('voiceStateUpdate', (avant, apres) => {
    try {
      const m = apres.member || avant.member;
      if (!m || m.user?.bot || avant.channelId === apres.channelId) return;
      const action = !avant.channelId ? 'join' : !apres.channelId ? 'leave' : 'move';
      ajouter(apres.guild.id, m.id, {
        t: 'voice', action,
        channel: (apres.channel || avant.channel)?.name || null,
        from: avant.channel?.name || null
      });
    } catch (e) { console.error('[activityTrail] voiceStateUpdate :', e.message); }
  });

  client.on('guildMemberUpdate', (avant, apres) => {
    try {
      if (apres.user?.bot || avant.nickname === apres.nickname) return;
      ajouter(apres.guild.id, apres.id, {
        t: 'nick', before: avant.nickname || avant.user?.username || null, text: apres.nickname || apres.user?.username || null
      });
    } catch (e) { console.error('[activityTrail] guildMemberUpdate :', e.message); }
  });

  client.on('messageReactionAdd', (reaction, user) => {
    try {
      const msg = reaction.message;
      if (!msg?.guild || !user || user.bot) return;
      ajouter(msg.guild.id, user.id, {
        t: 'react', channelId: msg.channel?.id, channel: msg.channel?.name || null,
        text: reaction.emoji?.name || null
      });
    } catch (e) { console.error('[activityTrail] messageReactionAdd :', e.message); }
  });
}

module.exports = { enregistrer, recent, resume, FENETRE_MS };
