// src/core/voteCard.js
// Carte de sondage CoreLab â€” reproduit le design de la photo "vote_card".
// DÃ©pendance : npm install @napi-rs/canvas
const fs = require('fs');
const {
  createCanvas,
  loadImage,
  GlobalFonts
} = require('@napi-rs/canvas');

const FAMILLE = 'CoreLabVote';
const CHEMINS_POLICES = ['assets/fonts/Inter-Regular.ttf', 'assets/fonts/Inter-SemiBold.ttf', 'assets/fonts/Inter-Bold.ttf', 'assets/fonts/Inter-Black.ttf'];
let policesEnregistrees = false;

function enregistrerPolices() {
  if (policesEnregistrees) return;
  policesEnregistrees = true;
  for (const chemin of CHEMINS_POLICES) {
    try {
      if (fs.existsSync(chemin)) GlobalFonts.registerFromPath(chemin, FAMILLE);
    } catch {}
  }
}

function police(taille, graisse) {
  enregistrerPolices();
  return (graisse || '400') + ' ' + taille + 'px ' + FAMILLE + ", 'Segoe UI', Arial, sans-serif";
}

function arrondi(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function chargerImageSecurisee(url, delaiMs) {
  return new Promise(resolve => {
    let fini = false;
    const timer = setTimeout(() => {
      if (!fini) { fini = true; resolve(null); }
    }, delaiMs || 6000);
    loadImage(url).then(img => {
      if (!fini) { fini = true; clearTimeout(timer); resolve(img); }
    }).catch(() => {
      if (!fini) { fini = true; clearTimeout(timer); resolve(null); }
    });
  });
}

function decouperTexte(ctx, texte, maxW, maxLignes) {
  const mots = String(texte).split(/\s+/);
  const lignes = [];
  let courante = '';
  for (const mot of mots) {
    const essai = courante ? courante + ' ' + mot : mot;
    if (ctx.measureText(essai).width <= maxW || !courante) courante = essai;
    else {
      lignes.push(courante);
      courante = mot;
      if (lignes.length === maxLignes) break;
    }
  }
  if (lignes.length < maxLignes && courante) lignes.push(courante);
  if (lignes.length === maxLignes) {
    let derniere = lignes[maxLignes - 1];
    if (ctx.measureText(derniere).width > maxW) {
      while (derniere && ctx.measureText(derniere + 'â€¦').width > maxW) derniere = derniere.slice(0, -1);
      lignes[maxLignes - 1] = derniere + 'â€¦';
    }
  }
  return lignes;
}

function libelleDuree(restant) {
  if (restant <= 0) return 'clos';
  const min = Math.ceil(restant / 60000);
  if (min < 60) return 'clos dans ' + min + ' min';
  const heures = Math.ceil(min / 60);
  if (heures < 24) return 'clos dans ' + heures + ' h';
  const jours = Math.ceil(heures / 24);
  return 'clos dans ' + jours + (jours > 1 ? ' jours' : ' jour');
}

function statutSondage(sondage) {
  if (sondage.ferme) return 'clos';
  if (sondage.finTimestamp) return libelleDuree(sondage.finTimestamp - Date.now());
  return 'ouvert';
}

// Couronne dorÃ©e simple (Ã©vite les problÃ¨mes de rendu d'emoji dans canvas)
function dessinerCouronne(ctx, x, y, t) {
  ctx.save();
  ctx.fillStyle = '#F5B940';
  ctx.beginPath();
  ctx.moveTo(x, y + t * 0.75);
  ctx.lineTo(x, y + t * 0.25);
  ctx.lineTo(x + t * 0.28, y + t * 0.5);
  ctx.lineTo(x + t * 0.5, y + t * 0.1);
  ctx.lineTo(x + t * 0.72, y + t * 0.5);
  ctx.lineTo(x + t, y + t * 0.25);
  ctx.lineTo(x + t, y + t * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// GÃ©nÃ¨re la carte complÃ¨te. Retourne un Buffer PNG.
async function genererCarteSondage(sondage) {
  const L = 1200, H = 540;
  const M = 40; // marge extÃ©rieure
  const LARG_VIGNETTE = 360; // zone droite
  const LARG_TEXTE = L - M * 2 - LARG_VIGNETTE - 40;
  const canvas = createCanvas(L, H);
  const ctx = canvas.getContext('2d');

  // ---------- Fond : dÃ©gradÃ© gris foncÃ© -> gris anthracite ----------
  const degrade = ctx.createLinearGradient(0, 0, L, H);
  degrade.addColorStop(0, '#33343A');
  degrade.addColorStop(1, '#222328');
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, L, H);

  // ---------- Contour de carte trÃ¨s arrondi ----------
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  arrondi(ctx, M - 12, M - 12, L - (M - 12) * 2, H - (M - 12) * 2, 36);
  ctx.stroke();

  // ---------- Surtitre Â« VOTE Â» ----------
  ctx.fillStyle = '#8A8C94';
  ctx.font = police(26, '600');
  ctx.textBaseline = 'top';
  const surtitre = (sondage.titre ? String(sondage.titre).toUpperCase() : 'VOTE');
  ctx.fillText(surtitre.slice(0, 24), M, M);

  // ---------- Question ----------
  ctx.fillStyle = '#FFFFFF';
  ctx.font = police(38, '700');
  const lignesQ = decouperTexte(ctx, sondage.question, LARG_TEXTE, 2);
  let y = M + 46;
  for (const ligne of lignesQ) {
    ctx.fillText(ligne, M, y);
    y += 46;
  }
  y += 18;

  // ---------- Options : libellÃ© + pourcentage + barre ----------
  const totalVotes = sondage.options.reduce((s, o) => s + o.voters.length, 0);
  const HAUT_OPT = 74;
  const maxAffichables = Math.max(2, Math.min(sondage.options.length, Math.floor((H - y - 120) / HAUT_OPT)));
  for (let i = 0; i < maxAffichables; i++) {
    const o = sondage.options[i];
    const votes = o.voters.length;
    const pct = totalVotes ? Math.round(votes / totalVotes * 100) : 0;
    const gagnante = totalVotes > 0 && votes === Math.max(...sondage.options.map(op => op.voters.length));
    const couleurTexte = gagnante ? '#FFFFFF' : '#9A9CA4';

    ctx.font = police(28, '600');
    const libelle = (i + 1) + ' Â· ' + o.label;
    const gauche = M;
    const pctTxt = pct + '% (' + votes + ')';
    ctx.textAlign = 'left';
    ctx.fillStyle = couleurTexte;
    ctx.fillText(decouperTexte(ctx, libelle, LARG_TEXTE - 130, 1)[0], gauche, y);
    ctx.textAlign = 'right';
    ctx.fillText(pctTxt, M + LARG_TEXTE, y);
    ctx.textAlign = 'left';

    // Barre de progression (pilule)
    const BARRE_Y = y + 42;
    const BARRE_H = 14;
    arrondi(ctx, M, BARRE_Y, LARG_TEXTE, BARRE_H, BARRE_H / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fill();
    if (pct > 0) {
      const w = Math.max(BARRE_H, Math.round(LARG_TEXTE * (totalVotes ? votes / totalVotes : 0)));
      arrondi(ctx, M, BARRE_Y, Math.min(w, LARG_TEXTE), BARRE_H, BARRE_H / 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
    y += HAUT_OPT;
  }

  // ---------- Compteur total : grand Â« 2 votes Â» ----------
  y += 14;
  ctx.font = police(64, '800');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(totalVotes), M, y);
  const wChiffre = ctx.measureText(String(totalVotes)).width;
  ctx.font = police(26, '500');
  ctx.fillStyle = '#B9BAC1';
  ctx.fillText(totalVotes > 1 ? 'votes' : 'vote', M + wChiffre + 14, y + 38);

  // ---------- Pied : Â« CoreLab Â· Vote Â· clos dans X Â» ----------
  ctx.font = police(22, '500');
  ctx.fillStyle = '#9A9CA4';
  const statut = statutSondage(sondage);
  ctx.fillText('CoreLab Â· Vote Â· ' + statut, M, H - M - 24);

  // ---------- Vignettes Ã  droite ----------
  const images = sondage.imageUrls || [];
  const nb = Math.min(images.length, maxAffichables);
  const VX = L - M - LARG_VIGNETTE;
  const VH = Math.min(200, (H - M * 2 - 20 * (nb > 1 ? 1 : 0)) / Math.max(1, nb));
  for (let i = 0; i < nb; i++) {
    const img = await chargerImageSecurisee(images[i]);
    const VY = M + i * (VH + 20);
    arrondi(ctx, VX, VY, LARG_VIGNETTE, VH, 22);
    ctx.save();
    ctx.clip();
    if (img) {
      // cover
      const echelle = Math.max(LARG_VIGNETTE / img.width, VH / img.height);
      const w = img.width * echelle, h = img.height * echelle;
      ctx.drawImage(img, VX + (LARG_VIGNETTE - w) / 2, VY + (VH - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#3A3B41';
      ctx.fillRect(VX, VY, LARG_VIGNETTE, VH);
      ctx.fillStyle = '#8A8C94';
      ctx.font = police(24, '600');
      ctx.fillText('Photo ' + (i + 1), VX + 24, VY + VH / 2 - 12);
    }
    ctx.restore();

    // Badge numÃ©ro (cercle noir semi-transparent, chiffre blanc)
    ctx.beginPath();
    ctx.arc(VX + 34, VY + 34, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = police(24, '700');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), VX + 34, VY + 35);

    // Badge Â« En tÃªte Â» (pilule blanche + couronne dorÃ©e) sur l'option en tÃªte
    const estEnTete = totalVotes > 0 && i === 0 && sondage.options[0] && sondage.options[0].voters.length === Math.max(...sondage.options.map(op => op.voters.length)) && sondage.options[0].voters.length > 0;
    if (estEnTete) {
      ctx.font = police(22, '700');
      const libelle = 'En tÃªte';
      const wTxt = ctx.measureText(libelle).width;
      const pw = wTxt + 60, ph = 38, px = VX + LARG_VIGNETTE - pw - 16, py = VY + 16;
      arrondi(ctx, px, py, pw, ph, ph / 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      dessinerCouronne(ctx, px + 14, py + ph / 2 - 9, 18);
      ctx.fillStyle = '#111114';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(libelle, px + 40, py + ph / 2 + 1);
    }
  }

  return canvas.encode('png');
}

module.exports = { genererCarteSondage };