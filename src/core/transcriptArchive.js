'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Archive des transcripts de tickets pour le dashboard.
//  • archiver({...})            → enregistre le HTML + une ligne d'index
//  • lister(guildId)            → liste des transcripts (du plus récent au plus ancien)
//  • cheminFichier(guildId, f)  → chemin d'un fichier archivé (null si invalide)
//  • signer / verifier          → lien temporaire signé (ouvrable sans en-tête Authorization)
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dossierPersistant, fichierPersistant } = require('./persistentPath');

const MAX_PAR_SERVEUR = 200;
const DOSSIER = dossierPersistant('transcripts');
const INDEX = fichierPersistant('transcripts.json');

let donnees = {};
try { donnees = JSON.parse(fs.readFileSync(INDEX, 'utf8')) || {}; } catch { donnees = {}; }

function sauver() {
  try { fs.writeFileSync(INDEX, JSON.stringify(donnees)); }
  catch (e) { console.error('[Transcripts] sauvegarde index :', e.message); }
}

function archiver({ guildId, nom, numero, ouvertPar, fermePar, count, html }) {
  const g = String(guildId);
  const fichier = `${g}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.html`;
  fs.writeFileSync(path.join(DOSSIER, fichier), html, 'utf8');
  if (!Array.isArray(donnees[g])) donnees[g] = [];
  donnees[g].push({
    id: numero ?? null,
    name: nom || 'ticket',
    user: ouvertPar || null,
    closedBy: fermePar || null,
    ts: Date.now(),
    messages: count ?? null,
    file: fichier
  });
  // Limite : on supprime les plus anciens (fichier compris)
  while (donnees[g].length > MAX_PAR_SERVEUR) {
    const vieux = donnees[g].shift();
    try { fs.unlinkSync(path.join(DOSSIER, vieux.file)); } catch { /* déjà supprimé */ }
  }
  sauver();
  return fichier;
}

function lister(guildId) {
  const l = donnees[String(guildId)] || [];
  return l.filter(t => fs.existsSync(path.join(DOSSIER, t.file))).slice().reverse();
}

function cheminFichier(guildId, nom) {
  const n = path.basename(String(nom || ''));
  if (!new RegExp(`^${String(guildId).replace(/\D/g, '')}_\\d+_[a-f0-9]{8}\\.html$`).test(n)) return null;
  const f = path.join(DOSSIER, n);
  return fs.existsSync(f) ? f : null;
}

function signature(guildId, fichier, exp, secret) {
  return crypto.createHmac('sha256', secret).update(`transcript.${guildId}.${fichier}.${exp}`).digest('hex').slice(0, 32);
}

function signer(guildId, fichier, secret, dureeMs = 3600 * 1000) {
  const exp = Date.now() + dureeMs;
  return { exp, sig: signature(guildId, fichier, exp, secret) };
}

function verifier(guildId, fichier, exp, sig, secret) {
  const e = Number(exp);
  if (!e || e < Date.now() || typeof sig !== 'string') return false;
  const attendu = signature(guildId, fichier, e, secret);
  if (attendu.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(sig));
}

module.exports = { archiver, lister, cheminFichier, signer, verifier };