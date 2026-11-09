'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Calendrier (/agenda) — même style que les cartes du bot « tuile + bandeau » :
// fond anthracite, bandeau d'en-tête avec tuile d'icône, libellés gris + grosses valeurs,
// pied de carte avec le nom du bot.
//   • generateAgendaWeek(o)  : vue semaine façon Google Agenda
//   • generateAgendaMonth(o) : vue mois
// Les événements arrivent déjà "aplatis" (voir src/commands/agenda.js) :
//   { type, annee, mois, jour, ts, minutes, heure, titre, duree }
//   ts = minuit UTC du jour, minutes = heure de début (1440 = sans heure)
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

// Polices optionnelles : dépose des .ttf dans assets/fonts/ (utile si l'hébergeur n'a aucune police)
for (const dossier of [
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  path.join(__dirname, '..', 'assets', 'fonts')
]) {
  try {
    if (!fs.existsSync(dossier)) continue;
    for (const f of fs.readdirSync(dossier)) {
      if (/\.(ttf|otf)$/i.test(f)) GlobalFonts.registerFromPath(path.join(dossier, f), 'CalFont');
    }
  } catch (err) {
    console.error('[Agenda] polices non chargées :', err.message);
  }
}

const FONT = '"CalFont","JetBrains Mono","DejaVu Sans Mono","Liberation Mono","Consolas",monospace';
const ZOOM = 1.2; // texte plus gros par rapport à la largeur de l'image
const police = (taille, poids = 'normal') => `${poids} ${Math.round(taille * ZOOM)}px ${FONT}`;

// Palette anthracite (identique aux cartes de logs du bot)
const PAL = {
  bg: '#1c1f26',
  band: '#24272e',
  box: '#252932',
  line: '#2a2e37',
  text: '#f3f4f6',
  muted: '#9ca3af',
  dim: '#6b7280',
  ring: '#4b5563'
};
const ACCENT = '#3b82f6';
const ACCENT_LIGHT = '#93c5fd';
const ROUGE = '#ef4444';
const SELECTION = '#fbbf24';

const TYPES = {
  reunion: { couleur: '#a78bfa', nom: 'Réunion' },
  evenement: { couleur: '#fbbf24', nom: 'Événement' }
};

const MOIS_NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_SEMAINE = ['LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.', 'DIM.'];

const W = 1076;
const PX = 48;
const INNER = W - PX * 2;
const BAND_H = 112;
const TILE_S = 72;
const H_STATS = 86;
const H_LEGENDE = 34;
const H_PIED = 70;
const JOUR_MS = 86400000;

const maj = s => s.charAt(0).toUpperCase() + s.slice(1);
const deux = n => String(n).padStart(2, '0');

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function cheminArrondi(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function ajuster(ctx, texte, largeurMax) {
  if (largeurMax <= 0) return '';
  if (ctx.measureText(texte).width <= largeurMax) return texte;
  let t = texte;
  while (t.length > 1 && ctx.measureText(t + '…').width > largeurMax) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

const dateDepuisTs = ts => {
  const d = new Date(ts);
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate(), dow: d.getUTCDay() };
};

function debutSemaine(ts) {
  const dowLundi = (new Date(ts).getUTCDay() + 6) % 7;
  return ts - dowLundi * JOUR_MS;
}

// ───────────────────────────────────────────────
// BRIQUES COMMUNES (style « tuile + bandeau »)
// ───────────────────────────────────────────────
function fondCarte(ctx, H) {
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, W, H);
}

function contourCarte(ctx, H) {
  cheminArrondi(ctx, 1, 1, W - 2, H - 2, 22);
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.line;
  ctx.stroke();
}

// Petit calendrier dessiné dans la tuile (pas d'emoji : fonctionne sans police emoji)
function iconeCalendrier(ctx, cx, cy) {
  const w = 34, h = 32, x = cx - w / 2, y = cy - h / 2 + 2;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ACCENT_LIGHT;
  cheminArrondi(ctx, x, y, w, h, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + 10);
  ctx.lineTo(x + w, y + 10);
  ctx.moveTo(x + 9, y - 4);
  ctx.lineTo(x + 9, y + 4);
  ctx.moveTo(x + w - 9, y - 4);
  ctx.lineTo(x + w - 9, y + 4);
  ctx.stroke();
  ctx.fillStyle = ACCENT_LIGHT;
  for (const [dx, dy] of [[9, 18], [17, 18], [25, 18], [9, 25], [17, 25]]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function dessinerBandeau(ctx, titre, sousTitre, heure) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAL.band;
  ctx.fillRect(0, 0, W, BAND_H);
  ctx.fillStyle = PAL.line;
  ctx.fillRect(0, BAND_H - 2, W, 2);

  const ty = (BAND_H - TILE_S) / 2;
  cheminArrondi(ctx, PX, ty, TILE_S, TILE_S, 18);
  ctx.fillStyle = rgba(ACCENT, 0.16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(ACCENT, 0.45);
  ctx.stroke();
  iconeCalendrier(ctx, PX + TILE_S / 2, ty + TILE_S / 2);

  const tx = PX + TILE_S + 22;
  ctx.textAlign = 'left';
  ctx.font = police(25, 'bold');
  ctx.fillStyle = PAL.text;
  ctx.fillText(ajuster(ctx, titre.toUpperCase(), W - PX - tx - 110), tx, 54);
  ctx.font = police(19);
  ctx.fillStyle = PAL.muted;
  ctx.fillText(ajuster(ctx, sousTitre, W - PX - tx - 110), tx, 86);

  ctx.textAlign = 'right';
  ctx.font = police(17);
  ctx.fillStyle = PAL.dim;
  ctx.fillText(heure, W - PX, 54);
  ctx.textAlign = 'left';
}

// Libellé gris + grosse valeur blanche (comme les cartes de logs)
function dessinerStats(ctx, y, stats) {
  // 2 colonnes étroites (compteurs) + une large pour « Prochain »
  const parts = stats.length === 3 ? [0.25, 0.25, 0.5] : stats.map(() => 1 / stats.length);
  let cumul = 0;
  stats.forEach((s, i) => {
    const x = PX + cumul * INNER;
    const colW = parts[i] * INNER;
    cumul += parts[i];
    ctx.textAlign = 'left';
    ctx.font = police(14);
    ctx.fillStyle = PAL.muted;
    ctx.fillText(s.libelle, x, y + 18);
    if (s.couleur) {
      ctx.beginPath();
      ctx.arc(x + 9, y + 50, 7, 0, Math.PI * 2);
      ctx.fillStyle = s.couleur;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.ring;
      ctx.stroke();
    }
    ctx.font = police(26, 'bold');
    ctx.fillStyle = PAL.text;
    ctx.fillText(ajuster(ctx, s.valeur, colW - 24 - (s.couleur ? 24 : 0)), x + (s.couleur ? 26 : 0), y + 60);
  });
}

function construireStats(evsPlage, next) {
  const compte = t => evsPlage.filter(e => e.type === t).length;
  return [
    { libelle: 'Réunions', valeur: String(compte('reunion')), couleur: TYPES.reunion.couleur },
    { libelle: 'Événements', valeur: String(compte('evenement')), couleur: TYPES.evenement.couleur },
    { libelle: 'Prochain', valeur: next || 'Aucun' }
  ];
}

function dessinerLegende(ctx, y) {
  let lx = PX;
  ctx.textAlign = 'left';
  ctx.font = police(14);
  for (const t of Object.values(TYPES)) {
    ctx.beginPath();
    ctx.arc(lx + 6, y + 10, 5, 0, Math.PI * 2);
    ctx.fillStyle = t.couleur;
    ctx.fill();
    ctx.fillStyle = PAL.muted;
    ctx.fillText(t.nom, lx + 18, y + 15);
    lx += 18 + ctx.measureText(t.nom).width + 28;
  }
}

function dessinerPied(ctx, H, botName, droite) {
  ctx.fillStyle = PAL.line;
  ctx.fillRect(PX, H - 58, INNER, 2);
  ctx.font = police(14);
  ctx.fillStyle = PAL.dim;
  ctx.textAlign = 'left';
  ctx.fillText(botName || 'CoreLab', PX, H - 26);
  ctx.textAlign = 'right';
  ctx.fillText(droite, W - PX, H - 26);
  ctx.textAlign = 'left';
}

function creerCarte(H) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.save();
  cheminArrondi(ctx, 1, 1, W - 2, H - 2, 22);
  ctx.clip();
  fondCarte(ctx, H);
  return { canvas, ctx };
}

function finCarte(canvas, ctx, H) {
  ctx.restore();
  contourCarte(ctx, H);
  return canvas.toBuffer('image/png');
}

const heureTexte = today => `${deux(Math.floor((today.minutes || 0) / 60))}:${deux((today.minutes || 0) % 60)}`;
const dateTexte = today => `${deux(today.d)}/${deux(today.m)}/${today.y}`;

// ───────────────────────────────────────────────
// VUE SEMAINE (style Google Agenda)
//   o : { botName, today:{y,m,d,minutes}, start:{y,m,d}, events, selTs, next }
// ───────────────────────────────────────────────
function generateAgendaWeek(o) {
  const now = { annee: o.today.y, mois: o.today.m, jour: o.today.d, minutes: o.today.minutes || 0, ts: Date.UTC(o.today.y, o.today.m - 1, o.today.d) };
  const debut = debutSemaine(Date.UTC(o.start.y, o.start.m - 1, o.start.d));
  const selTs = o.selTs || null;
  const evs = o.events.filter(e => e.ts >= debut && e.ts <= debut + 6 * JOUR_MS);

  const avecHeure = evs.filter(e => e.minutes < 1440);
  const sansHeure = evs.filter(e => e.minutes >= 1440);

  // Plage horaire affichée
  let h0 = 8, h1 = 22;
  if (avecHeure.length) {
    const minM = Math.min(...avecHeure.map(e => e.minutes));
    const maxM = Math.max(...avecHeure.map(e => Math.min(1440, e.minutes + e.duree)));
    h0 = Math.max(0, Math.min(8, Math.floor(minM / 60) - 1));
    h1 = Math.min(24, Math.max(22, Math.ceil(maxM / 60) + 1));
  }
  const HH = 30;
  const nbHeures = h1 - h0;

  const H_JOUR = 76;
  const H_TOUTE = sansHeure.length ? 42 : 0;
  const H_PAD_H = 12;
  const H_GRILLE = H_JOUR + H_TOUTE + nbHeures * HH + H_PAD_H;
  const H = BAND_H + 20 + H_STATS + 8 + H_GRILLE + 18 + H_LEGENDE + H_PIED;

  const { canvas, ctx } = creerCarte(H);

  // Titre
  const d1 = dateDepuisTs(debut);
  const d2 = dateDepuisTs(debut + 6 * JOUR_MS);
  const titre = `Agenda — ${MOIS_NOMS[d1.mois - 1]} ${d1.annee}`;
  const sousTitre = (d1.mois === d2.mois
    ? `Semaine du ${d1.jour} au ${d2.jour} ${MOIS_NOMS[d1.mois - 1]}`
    : `Semaine du ${d1.jour} ${MOIS_NOMS[d1.mois - 1]} au ${d2.jour} ${MOIS_NOMS[d2.mois - 1]}`)
    + ` · ${evs.length} événement${evs.length > 1 ? 's' : ''}`;
  dessinerBandeau(ctx, titre, sousTitre, heureTexte(o.today));

  let y = BAND_H + 20;
  dessinerStats(ctx, y, construireStats(evs, o.next));
  y += H_STATS + 8;

  // ── Grille ──
  const gutter = 60;
  const colW = (INNER - gutter) / 7;
  const gy = y;
  const ix = PX;
  cheminArrondi(ctx, ix, gy, INNER, H_GRILLE, 14);
  ctx.fillStyle = PAL.box;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PAL.line;
  ctx.stroke();

  const colX = i => ix + gutter + i * colW;
  const yHeures = gy + H_JOUR + H_TOUTE;

  // Colonne d'aujourd'hui + sélection
  for (let i = 0; i < 7; i++) {
    const ts = debut + i * JOUR_MS;
    if (ts === now.ts) {
      ctx.fillStyle = rgba(ACCENT, 0.09);
      ctx.fillRect(colX(i), gy + 1, colW, H_GRILLE - 2);
    }
    if (selTs && ts === selTs) {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(colX(i), gy + 1, colW, H_GRILLE - 2);
    }
  }

  // En-têtes de jours
  ctx.textAlign = 'center';
  for (let i = 0; i < 7; i++) {
    const ts = debut + i * JOUR_MS;
    const d = dateDepuisTs(ts);
    const cx = colX(i) + colW / 2;
    const estAujourdhui = ts === now.ts;

    ctx.font = police(12, 'bold');
    ctx.fillStyle = estAujourdhui ? ACCENT_LIGHT : PAL.muted;
    ctx.fillText(JOURS_SEMAINE[i], cx, gy + 27);

    if (estAujourdhui) {
      ctx.beginPath();
      ctx.arc(cx, gy + 53, 19, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
    } else if (selTs && ts === selTs) {
      ctx.beginPath();
      ctx.arc(cx, gy + 53, 19, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = SELECTION;
      ctx.stroke();
    }
    ctx.font = police(22, 'bold');
    ctx.fillStyle = estAujourdhui ? '#ffffff' : (d.dow === 0 || d.dow === 6 ? PAL.muted : PAL.text);
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d.jour), cx, gy + 54);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = PAL.line;
  ctx.fillRect(ix, gy + H_JOUR, INNER, 2);

  // Journée entière
  if (H_TOUTE) {
    ctx.textAlign = 'right';
    ctx.font = police(10, 'bold');
    ctx.fillStyle = PAL.dim;
    ctx.fillText('JOURNÉE', ix + gutter - 8, gy + H_JOUR + 26);
    for (let i = 0; i < 7; i++) {
      const ts = debut + i * JOUR_MS;
      const du = sansHeure.filter(e => e.ts === ts);
      if (!du.length) continue;
      const e = du[0];
      const t = TYPES[e.type];
      const bx = colX(i) + 4, bw = colW - 8, by = gy + H_JOUR + 8;
      cheminArrondi(ctx, bx, by, bw, 26, 6);
      ctx.fillStyle = rgba(t.couleur, 0.28);
      ctx.fill();
      ctx.fillStyle = t.couleur;
      ctx.fillRect(bx, by + 4, 3, 18);
      ctx.textAlign = 'left';
      ctx.font = police(12, 'bold');
      ctx.fillStyle = PAL.text;
      const reste = du.length > 1 ? ` +${du.length - 1}` : '';
      ctx.fillText(ajuster(ctx, e.titre + reste, bw - 16), bx + 10, by + 18);
    }
    ctx.fillStyle = PAL.line;
    ctx.fillRect(ix, gy + H_JOUR + H_TOUTE, INNER, 2);
  }

  // Lignes d'heures
  ctx.textAlign = 'right';
  ctx.font = police(11);
  for (let h = h0; h <= h1; h++) {
    const ly = yHeures + H_PAD_H + (h - h0) * HH;
    if (h < h1) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(ix + gutter - 6, ly, INNER - gutter + 6, 1);
    }
    ctx.fillStyle = PAL.dim;
    if (h < 24) ctx.fillText(`${h}h`, ix + gutter - 12, ly + 4);
  }

  // Séparateurs de colonnes
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i <= 7; i++) ctx.fillRect(colX(i), gy + 1, 1, H_GRILLE - 2);

  // Événements horaires
  const yDe = m => yHeures + H_PAD_H + ((m - h0 * 60) / 60) * HH;
  for (let i = 0; i < 7; i++) {
    const ts = debut + i * JOUR_MS;
    const du = avecHeure.filter(e => e.ts === ts).sort((a, b) => a.minutes - b.minutes);

    // Gestion des chevauchements : voies
    const voies = [];
    for (const e of du) {
      e.fin = Math.min(1440, e.minutes + e.duree);
      let v = voies.findIndex(f => f <= e.minutes);
      if (v === -1) { v = voies.length; voies.push(0); }
      voies[v] = e.fin;
      e.voie = v;
    }
    for (const e of du) {
      const conc = du.filter(x => x.minutes < e.fin && x.fin > e.minutes);
      e.nbVoies = Math.max(...conc.map(x => x.voie)) + 1;
    }

    for (const e of du) {
      const t = TYPES[e.type];
      const largeurVoie = (colW - 8) / e.nbVoies;
      const bx = colX(i) + 4 + e.voie * largeurVoie;
      const bw = largeurVoie - 2;
      const by = yDe(e.minutes) + 1;
      const bh = Math.max(30, ((e.fin - e.minutes) / 60) * HH - 3);

      cheminArrondi(ctx, bx, by, bw, bh, 7);
      ctx.fillStyle = rgba(t.couleur, 0.24);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(t.couleur, 0.7);
      ctx.stroke();
      ctx.fillStyle = t.couleur;
      ctx.fillRect(bx, by + 4, 4, bh - 8);

      ctx.textAlign = 'left';
      ctx.font = police(12, 'bold');
      ctx.fillStyle = PAL.text;
      if (bh >= 48) {
        ctx.fillText(e.heure, bx + 11, by + 19);
        ctx.font = police(12);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillText(ajuster(ctx, e.titre, bw - 18), bx + 11, by + 37);
      } else {
        ctx.fillText(ajuster(ctx, `${e.heure} ${e.titre}`, bw - 18), bx + 11, by + 20);
      }
    }
  }

  // Trait « maintenant » rouge (comme Google Agenda)
  const iAujourdhui = Math.round((now.ts - debut) / JOUR_MS);
  if (iAujourdhui >= 0 && iAujourdhui < 7 && now.minutes >= h0 * 60 && now.minutes <= h1 * 60) {
    const ly = yDe(now.minutes);
    ctx.fillStyle = ROUGE;
    ctx.fillRect(colX(iAujourdhui), ly - 1, colW, 2);
    ctx.beginPath();
    ctx.arc(colX(iAujourdhui), ly, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }

  y = gy + H_GRILLE + 18;
  dessinerLegende(ctx, y);
  dessinerPied(ctx, H, o.botName, `Agenda · ${dateTexte(o.today)}`);
  return finCarte(canvas, ctx, H);
}

// ───────────────────────────────────────────────
// VUE MOIS
//   o : { botName, today:{y,m,d,minutes}, year, month, events, selTs, next }
// ───────────────────────────────────────────────
function generateAgendaMonth(o) {
  const annee = o.year, mois = o.month;
  const now = { annee: o.today.y, mois: o.today.m, jour: o.today.d };
  const selTs = o.selTs || null;
  const debut = Date.UTC(annee, mois - 1, 1);
  const fin = Date.UTC(annee, mois, 0);
  const evs = o.events.filter(e => e.ts >= debut && e.ts <= fin);
  const estMoisCourant = now.annee === annee && now.mois === mois;

  const nbJours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  const decalage = (new Date(Date.UTC(annee, mois - 1, 1)).getUTCDay() + 6) % 7;
  const nbLignes = Math.ceil((decalage + nbJours) / 7);

  const parJour = {};
  for (const e of evs) (parJour[e.jour] = parJour[e.jour] || []).push(e);

  const GAP = 6, CASE_H = 72, H_JOURS = 32;
  const H_GRILLE = nbLignes * CASE_H + (nbLignes - 1) * GAP;
  const H = BAND_H + 20 + H_STATS + 8 + H_JOURS + H_GRILLE + 18 + H_LEGENDE + H_PIED;

  const { canvas, ctx } = creerCarte(H);

  dessinerBandeau(
    ctx,
    `Agenda — ${MOIS_NOMS[mois - 1]} ${annee}`,
    `Vue du mois · ${evs.length} événement${evs.length > 1 ? 's' : ''}`,
    heureTexte(o.today)
  );

  let y = BAND_H + 20;
  dessinerStats(ctx, y, construireStats(evs, o.next));
  y += H_STATS + 8;

  const largeurCase = (INNER - GAP * 6) / 7;
  ctx.font = police(13, 'bold');
  ctx.fillStyle = PAL.muted;
  ctx.textAlign = 'center';
  for (let i = 0; i < 7; i++) {
    ctx.fillText(JOURS_SEMAINE[i], PX + i * (largeurCase + GAP) + largeurCase / 2, y + 20);
  }
  y += H_JOURS;

  const joursMoisPrec = new Date(Date.UTC(annee, mois - 1, 0)).getUTCDate();
  for (let i = 0; i < nbLignes * 7; i++) {
    const col = i % 7;
    const ligne = Math.floor(i / 7);
    const x = PX + col * (largeurCase + GAP);
    const cy = y + ligne * (CASE_H + GAP);
    const numero = i - decalage + 1;
    const dansMois = numero >= 1 && numero <= nbJours;

    cheminArrondi(ctx, x, cy, largeurCase, CASE_H, 12);
    if (!dansMois) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = police(13);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillText(String(numero < 1 ? joursMoisPrec + numero : numero - nbJours), x + 12, cy + 24);
      continue;
    }

    const du = parJour[numero] || [];
    const estAujourdhui = estMoisCourant && numero === now.jour;
    const estSel = selTs && Date.UTC(annee, mois - 1, numero) === selTs;

    ctx.fillStyle = estAujourdhui ? rgba(ACCENT, 0.14) : PAL.box;
    ctx.fill();
    ctx.lineWidth = estAujourdhui ? 2 : 1.5;
    ctx.strokeStyle = estAujourdhui ? ACCENT : (du.length ? PAL.ring : PAL.line);
    ctx.stroke();
    if (estSel) {
      cheminArrondi(ctx, x, cy, largeurCase, CASE_H, 12);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = SELECTION;
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    if (estAujourdhui) {
      ctx.beginPath();
      ctx.arc(x + 21, cy + 20, 13, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = police(15, 'bold');
      ctx.textAlign = 'center';
      ctx.fillText(String(numero), x + 21, cy + 25.5);
      ctx.textAlign = 'left';
    } else {
      ctx.font = police(15, 'bold');
      ctx.fillStyle = du.length ? PAL.text : PAL.muted;
      ctx.fillText(String(numero), x + 12, cy + 25);
    }

    const maxVis = du.length > 2 ? 1 : du.length;
    for (let k = 0; k < maxVis; k++) {
      const e = du[k];
      const t = TYPES[e.type];
      const chipY = cy + 31 + k * 18;
      cheminArrondi(ctx, x + 8, chipY, largeurCase - 16, 16, 5);
      ctx.fillStyle = rgba(t.couleur, 0.22);
      ctx.fill();
      ctx.fillStyle = t.couleur;
      ctx.fillRect(x + 8, chipY + 2, 3, 12);
      ctx.font = police(12);
      ctx.fillStyle = PAL.text;
      ctx.fillText(ajuster(ctx, `${e.heure ? e.heure + ' ' : ''}${e.titre}`, largeurCase - 36), x + 17, chipY + 12);
    }
    if (du.length > 2) {
      ctx.font = police(12, 'bold');
      ctx.fillStyle = ACCENT_LIGHT;
      ctx.fillText(`+${du.length - 1} autres`, x + 12, cy + 31 + 18 + 12);
    }
  }
  y += H_GRILLE + 18;

  dessinerLegende(ctx, y);
  dessinerPied(ctx, H, o.botName, `Agenda · ${dateTexte(o.today)}`);
  return finCarte(canvas, ctx, H);
}

module.exports = {
  generateAgendaWeek,
  generateAgendaMonth,
  TYPES,
  MOIS_NOMS,
  JOURS_COURTS,
  JOURS_SEMAINE,
  JOUR_MS,
  dateDepuisTs,
  debutSemaine
};
