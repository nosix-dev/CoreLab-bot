'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Carte calendrier (/agenda) — même style vert que les autres cartes du bot.
//   • generateAgendaMonth(o) : grille du mois
//   • generateAgendaWeek(o)  : liste de la semaine
// Les événements sont passés déjà "aplatis" (jour/heure Europe/Paris).
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'AgendaBold');
    GlobalFonts.registerFromPath(r, 'AgendaRegular');
    FONT = 'AgendaRegular';
    FONT_BOLD = 'AgendaBold';
  }
} catch { /* police système */ }

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAYS_SHORT = ['LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.', 'DIM.'];
const DAYS_LOWER = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const C = {
  bg: '#0a1a12',
  card: '#0e2218',
  border: '#1e4630',
  pill: '#122c1e',
  pillBorder: '#204c34',
  cell: '#0f241a',
  cellBorder: '#173a28',
  cellOther: '#0b1b13',
  green: '#2ecc71',
  greenLight: '#78eba0',
  text: '#ebf5ee',
  muted: '#82aa91',
  dim: '#52705f'
};
const TYPE_COLOR = { convoi: '#2ecc71', reunion: '#4c8dff', event: '#f5a524' };
const TYPE_LABEL = { convoi: 'Convoi', reunion: 'Réunion', event: 'Événement' };

const W = 900;   // largeur logique : plus étroit = texte plus gros une fois affiché dans Discord
const PAD = 22;
const SCALE = 2; // rendu 2x pour rester net

function makeCanvas(w, h, guildId) {
  const canvas = createCanvas(w * SCALE, h * SCALE);
  const raw = canvas.getContext('2d');
  raw.scale(SCALE, SCALE);
  return { canvas, ctx: themedCtx(raw, guildId) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

const hhmm = e => `${String(e.hh).padStart(2, '0')}h${String(e.mm).padStart(2, '0')}`;
const pad2 = n => String(n).padStart(2, '0');
const dowMon = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = lundi

function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const keyOf = (y, m, d) => `${y}-${m}-${d}`;

function groupByDay(events) {
  const map = new Map();
  for (const e of events) {
    const k = keyOf(e.y, e.m, e.d);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

function drawFrame(ctx, w, h) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  roundRect(ctx, 12, 12, w - 24, h - 24, 24);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.border;
  ctx.stroke();
}

function drawHeader(ctx, title, subtitle, today) {
  // Pastille check
  const cx = 72, cy = 66, r = 28;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy);
  ctx.lineTo(cx - 3, cy + 11);
  ctx.lineTo(cx + 15, cy - 11);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = `38px ${FONT_BOLD}`;
  ctx.fillText(title, 118, 70);
  ctx.fillStyle = C.muted;
  ctx.font = `20px ${FONT}`;
  ctx.fillText(subtitle, 120, 98);

  // Badge AUJOURD'HUI
  const badge = `AUJOURD'HUI ${pad2(today.d)}/${pad2(today.m)}`;
  ctx.font = `17px ${FONT_BOLD}`;
  const bw = ctx.measureText(badge).width + 56;
  const bx = W - PAD - bw, by = 44, bh = 40;
  roundRect(ctx, bx, by, bw, bh, 20);
  ctx.fillStyle = '#14462a';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.green;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + 22, by + bh / 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  ctx.fillStyle = C.greenLight;
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, bx + 36, by + bh / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawStats(ctx, y, stats, compact) {
  const gap = 14;
  const pw = Math.floor((W - 2 * PAD - 3 * gap) / 4);
  const ph = compact ? 60 : 76;
  stats.forEach((s, i) => {
    const x = PAD + i * (pw + gap);
    roundRect(ctx, x, y, pw, ph, 14);
    ctx.fillStyle = C.pill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = s.border || C.pillBorder;
    ctx.stroke();
    // pastille couleur + label
    ctx.beginPath();
    ctx.arc(x + 20, y + (compact ? 19 : 22), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = `14px ${FONT_BOLD}`;
    ctx.fillText(s.label, x + 32, y + (compact ? 24 : 27));
    // valeur
    ctx.fillStyle = s.valueColor || C.text;
    let size = s.small ? (compact ? 20 : 22) : (compact ? 26 : 32);
    ctx.font = `${size}px ${FONT_BOLD}`;
    while (ctx.measureText(s.value).width > pw - 32 && size > 14) {
      size -= 2;
      ctx.font = `${size}px ${FONT_BOLD}`;
    }
    ctx.fillText(s.value, x + 18, y + (compact ? 51 : 62));
  });
}

function drawLegendAndFooter(ctx, y, botName) {
  ctx.font = `16px ${FONT}`;
  let x = PAD + 6;
  for (const k of ['convoi', 'reunion', 'event']) {
    ctx.beginPath();
    ctx.arc(x + 5, y - 5, 5, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLOR[k];
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.fillText(TYPE_LABEL[k], x + 18, y);
    x += 18 + ctx.measureText(TYPE_LABEL[k]).width + 26;
  }
  ctx.fillStyle = C.dim;
  ctx.font = `15px ${FONT}`;
  const t = botName || 'CoreLab';
  ctx.fillText(t, W - PAD - 6 - ctx.measureText(t).width, y);
}

function drawChip(ctx, x, y, w, h, ev, dim) {
  const col = TYPE_COLOR[ev.type] || TYPE_COLOR.event;
  roundRect(ctx, x, y, w, h, 7);
  ctx.fillStyle = col + (dim ? '1a' : '33');
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = col + (dim ? '66' : 'cc');
  ctx.stroke();
  ctx.fillStyle = col;
  roundRect(ctx, x, y, 4, h, 2);
  ctx.fill();
  // deux lignes : heure (gras) puis nom
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dim ? C.muted : C.text;
  ctx.font = `13px ${FONT_BOLD}`;
  ctx.fillText(hhmm(ev), x + 10, y + h * 0.32);
  ctx.font = `14px ${FONT}`;
  ctx.fillText(truncate(ctx, ev.name, w - 16), x + 10, y + h * 0.72);
  ctx.textBaseline = 'alphabetic';
}

/**
 * Grille du mois.
 * @param {object} o
 * @param {string} [o.guildId]
 * @param {string} [o.botName]
 * @param {number} o.year
 * @param {number} o.month         1-12
 * @param {{y:number,m:number,d:number}} o.today
 * @param {Array<{y,m,d,hh,mm,name,type}>} o.events   événements visibles sur la grille (jours voisins inclus)
 * @param {number} o.monthCount    nb d'événements dans le mois affiché
 * @param {string} o.next          texte « prochain événement » (ou 'Aucun')
 * @returns {Buffer} PNG
 */

// ── Style unifié (même rendu que les logs) ──
function agendaCompact(o, title, sub, list, max) {
  const cc = require('../core/compactCard');
  const counts = { convoi: 0, reunion: 0, event: 0 };
  for (const e of list) if (counts[e.type] !== undefined) counts[e.type]++;
  const shown = list.slice(0, max);
  return cc.renderCompactSync({
    guildId: o.guildId, theme: 'cyan', title: `📅 ${title}`, sub,
    grid: 1, valueMax: 36,
    blocks: shown.length
      ? shown.map(e => ({ label: `${pad2(e.d)}/${pad2(e.m)} · ${hhmm(e)}`, value: `${e.name}${e.place ? ` · ${e.place}` : ''}`, dot: TYPE_COLOR[e.type] }))
      : [{ label: '', value: 'Aucun événement' }],
    pills: [
      { text: `${counts.convoi} convoi${counts.convoi > 1 ? 's' : ''}`, tone: 'accent' },
      { text: `${counts.reunion} réunion${counts.reunion > 1 ? 's' : ''}`, tone: 'accent' },
      { text: `${counts.event} événement${counts.event > 1 ? 's' : ''}`, tone: 'accent' }
    ],
    footerLeft: `Prochain : ${o.next || 'Aucun'}`,
    footerRight: list.length > max ? `+ ${list.length - max} autre${list.length - max > 1 ? 's' : ''}` : (o.botName || undefined)
  });
}

function generateAgendaMonth(o) {
  if (require('../core/compactCard').isCompact(o.guildId)) {
    const list = o.events.filter(e => e.m === o.month && e.y === o.year);
    return agendaCompact(o, `${MONTHS[o.month - 1]} ${o.year}`, `Vue du mois · ${o.monthCount} événement${o.monthCount > 1 ? 's' : ''}`, list, 12);
  }
  const { year, month, today } = o;
  const first = dowMon(year, month, 1);
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((first + dim) / 7);

  const gap = 6;
  const cw = Math.floor((W - 2 * PAD - 6 * gap) / 7);
  const ch = 84;
  const gridTop = 210;
  const H = gridTop + rows * (ch + gap) + 46;

  const { canvas, ctx } = makeCanvas(W, H, o.guildId);
  drawFrame(ctx, W, H);

  const counts = { convoi: 0, reunion: 0, event: 0 };
  for (const e of o.events) {
    if (e.m === month && e.y === year && counts[e.type] !== undefined) counts[e.type]++;
  }
  drawHeader(ctx, `${MONTHS[month - 1]} ${year}`,
    `Vue du mois · ${o.monthCount} événement${o.monthCount > 1 ? 's' : ''}`, today);
  drawStats(ctx, 118, [
    { label: 'CONVOIS', value: counts.convoi ? String(counts.convoi) : 'Aucun', color: TYPE_COLOR.convoi, small: !counts.convoi, valueColor: counts.convoi ? C.text : C.muted },
    { label: 'RÉUNIONS', value: counts.reunion ? String(counts.reunion) : 'Aucun', color: TYPE_COLOR.reunion, small: !counts.reunion, valueColor: counts.reunion ? C.text : C.muted },
    { label: 'ÉVÉNEMENTS', value: counts.event ? String(counts.event) : 'Aucun', color: TYPE_COLOR.event, small: !counts.event, valueColor: counts.event ? C.text : C.muted, border: counts.event ? '#3d8f5c' : undefined },
    { label: 'PROCHAIN', value: o.next || 'Aucun', color: C.green, small: true, valueColor: C.greenLight, border: '#3d8f5c' }
  ], true);

  // En-têtes des jours
  ctx.font = `15px ${FONT_BOLD}`;
  ctx.fillStyle = C.muted;
  DAYS_SHORT.forEach((d, i) => {
    const x = PAD + i * (cw + gap);
    ctx.fillText(d, x + 8, 200);
  });

  const byDay = groupByDay(o.events);
  const start = addDays(year, month, 1, -first);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const cur = addDays(start.y, start.m, start.d, r * 7 + c);
      const inMonth = cur.m === month && cur.y === year;
      const isToday = cur.y === today.y && cur.m === today.m && cur.d === today.d;
      const x = PAD + c * (cw + gap);
      const y = gridTop + r * (ch + gap);

      roundRect(ctx, x, y, cw, ch, 12);
      ctx.fillStyle = isToday ? '#12331f' : (inMonth ? C.cell : C.cellOther);
      ctx.fill();
      ctx.lineWidth = isToday ? 2.5 : 1.5;
      ctx.strokeStyle = isToday ? C.greenLight : C.cellBorder;
      ctx.stroke();

      // numéro du jour
      if (isToday) {
        roundRect(ctx, x + 6, y + 6, 32, 26, 8);
        ctx.fillStyle = C.green;
        ctx.fill();
        ctx.fillStyle = C.bg;
        ctx.font = `16px ${FONT_BOLD}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(cur.d), x + 22, y + 25);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = inMonth ? C.text : C.dim;
        ctx.font = `19px ${FONT_BOLD}`;
        ctx.fillText(String(cur.d), x + 12, y + 26);
      }

      // événements
      const list = byDay.get(keyOf(cur.y, cur.m, cur.d)) || [];
      if (list.length) {
        // une seule puce (2 lignes) ; s'il y en a d'autres, badge « +N » en haut à droite
        drawChip(ctx, x + 5, y + 31, cw - 10, 46, list[0], !inMonth);
        if (list.length > 1) {
          const t = `+${list.length - 1}`;
          ctx.font = `13px ${FONT_BOLD}`;
          const bw = ctx.measureText(t).width + 14;
          roundRect(ctx, x + cw - bw - 6, y + 8, bw, 20, 10);
          ctx.fillStyle = '#ffffff1f';
          ctx.fill();
          ctx.fillStyle = C.text;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t, x + cw - bw / 2 - 6, y + 19);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
      }
    }
  }

  drawLegendAndFooter(ctx, H - 22, o.botName);
  return canvas.toBuffer('image/png');
}

/**
 * Vue semaine : une ligne par jour.
 * @param {object} o   mêmes champs que generateAgendaMonth + { start:{y,m,d} } (lundi) et { place(ev) }
 */
function generateAgendaWeek(o) {
  if (require('../core/compactCard').isCompact(o.guildId)) {
    const s0 = addDays(o.start.y, o.start.m, o.start.d, 0), e0 = addDays(o.start.y, o.start.m, o.start.d, 6);
    return agendaCompact(o, 'Agenda de la semaine', `Du ${pad2(s0.d)}/${pad2(s0.m)} au ${pad2(e0.d)}/${pad2(e0.m)} · ${o.weekCount} événement${o.weekCount > 1 ? 's' : ''}`, o.events, 12);
  }
  const { today } = o;
  const days = Array.from({ length: 7 }, (_, i) => addDays(o.start.y, o.start.m, o.start.d, i));
  const byDay = groupByDay(o.events);

  const MAX_SHOWN = 4;
  const rowH = days.map(dd => {
    const n = (byDay.get(keyOf(dd.y, dd.m, dd.d)) || []).length;
    const shown = Math.min(n, MAX_SHOWN + (n > MAX_SHOWN ? 1 : 0));
    return Math.max(64, 16 + shown * 34);
  });
  const gridTop = 232;
  const gap = 8;
  const H = gridTop + rowH.reduce((a, b) => a + b + gap, 0) + 54;

  const { canvas, ctx } = makeCanvas(W, H, o.guildId);
  drawFrame(ctx, W, H);

  const end = days[6];
  const title = days[0].m === end.m
    ? `${days[0].d} – ${end.d} ${MONTHS[end.m - 1]}`
    : `${days[0].d} ${MONTHS[days[0].m - 1].slice(0, 4)}. – ${end.d} ${MONTHS[end.m - 1].slice(0, 4)}.`;
  drawHeader(ctx, title, `Vue semaine · ${o.weekCount} événement${o.weekCount > 1 ? 's' : ''}`, today);

  const counts = { convoi: 0, reunion: 0, event: 0 };
  for (const e of o.events) if (counts[e.type] !== undefined) counts[e.type]++;
  drawStats(ctx, 128, [
    { label: 'CONVOIS', value: counts.convoi ? String(counts.convoi) : 'Aucun', color: TYPE_COLOR.convoi, small: !counts.convoi, valueColor: counts.convoi ? C.text : C.muted },
    { label: 'RÉUNIONS', value: counts.reunion ? String(counts.reunion) : 'Aucun', color: TYPE_COLOR.reunion, small: !counts.reunion, valueColor: counts.reunion ? C.text : C.muted },
    { label: 'ÉVÉNEMENTS', value: counts.event ? String(counts.event) : 'Aucun', color: TYPE_COLOR.event, small: !counts.event, valueColor: counts.event ? C.text : C.muted },
    { label: 'PROCHAIN', value: o.next || 'Aucun', color: C.green, small: true, valueColor: C.greenLight, border: '#3d8f5c' }
  ]);

  let y = gridTop;
  days.forEach((dd, i) => {
    const h = rowH[i];
    const isToday = dd.y === today.y && dd.m === today.m && dd.d === today.d;
    roundRect(ctx, PAD, y, W - 2 * PAD, h, 12);
    ctx.fillStyle = isToday ? '#12331f' : C.cell;
    ctx.fill();
    ctx.lineWidth = isToday ? 2.5 : 1.5;
    ctx.strokeStyle = isToday ? C.greenLight : C.cellBorder;
    ctx.stroke();

    // bloc jour
    const mid = y + h / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = isToday ? C.greenLight : C.muted;
    ctx.font = `14px ${FONT_BOLD}`;
    ctx.fillText(DAYS_SHORT[i], PAD + 52, mid - 6);
    ctx.fillStyle = isToday ? C.greenLight : C.text;
    ctx.font = `28px ${FONT_BOLD}`;
    ctx.fillText(String(dd.d), PAD + 52, mid + 26);
    ctx.textAlign = 'left';

    // séparateur vertical
    ctx.fillStyle = C.cellBorder;
    ctx.fillRect(PAD + 104, y + 10, 2, h - 20);

    const list = byDay.get(keyOf(dd.y, dd.m, dd.d)) || [];
    const cx = PAD + 122;
    const cwid = W - PAD - 14 - cx;
    if (!list.length) {
      ctx.fillStyle = C.dim;
      ctx.font = `16px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Rien de prévu', cx, mid + 1);
      ctx.textBaseline = 'alphabetic';
    } else {
      const show = list.length <= MAX_SHOWN ? list : list.slice(0, MAX_SHOWN);
      show.forEach((ev, k) => {
        const cy = y + 10 + k * 34;
        const col = TYPE_COLOR[ev.type] || TYPE_COLOR.event;
        roundRect(ctx, cx, cy, cwid, 28, 7);
        ctx.fillStyle = col + '33';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col + 'cc';
        ctx.stroke();
        ctx.fillStyle = col;
        roundRect(ctx, cx, cy, 5, 28, 2);
        ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.text;
        ctx.font = `16px ${FONT_BOLD}`;
        const time = hhmm(ev);
        ctx.fillText(time, cx + 16, cy + 15);
        const tw = ctx.measureText(time).width;
        ctx.font = `16px ${FONT}`;
        const tail = ev.place ? `  ·  ${ev.place}` : '';
        ctx.fillText(truncate(ctx, `${ev.name}${tail}`, cwid - 36 - tw), cx + 16 + tw + 12, cy + 15);
        ctx.textBaseline = 'alphabetic';
      });
      if (list.length > MAX_SHOWN) {
        ctx.fillStyle = C.muted;
        ctx.font = `14px ${FONT_BOLD}`;
        ctx.fillText(`+${list.length - MAX_SHOWN} autres`, cx + 4, y + 10 + MAX_SHOWN * 34 + 14);
      }
    }
    y += h + gap;
  });

  drawLegendAndFooter(ctx, H - 28, o.botName);
  return canvas.toBuffer('image/png');
}

/**
 * Vue « tout » : tous les événements à venir, groupés par mois.
 * @param {object} o  { guildId, botName, today, events:[{y,m,d,hh,mm,name,type,place}], next }
 */
function generateAgendaAll(o) {
  if (require('../core/compactCard').isCompact(o.guildId)) {
    return agendaCompact(o, 'Agenda', `Tous les événements à venir · ${o.events.length}`, o.events, 12);
  }
  const { today } = o;
  const MAX = 20;
  const shown = o.events.slice(0, MAX);
  const groups = [];
  for (const e of shown) {
    const last = groups[groups.length - 1];
    if (last && last.y === e.y && last.m === e.m) last.list.push(e);
    else groups.push({ y: e.y, m: e.m, list: [e] });
  }
  const monthH = 42, rowH = 40, gridTop = 232;
  const body = groups.length
    ? groups.reduce((a, g) => a + monthH + g.list.length * rowH + 10, 0) + (o.events.length > MAX ? 34 : 0)
    : 90;
  const H = gridTop + body + 54;

  const { canvas, ctx } = makeCanvas(W, H, o.guildId);
  drawFrame(ctx, W, H);
  drawHeader(ctx, 'Agenda', `Tous les événements à venir · ${o.events.length}`, today);

  const counts = { convoi: 0, reunion: 0, event: 0 };
  for (const e of o.events) if (counts[e.type] !== undefined) counts[e.type]++;
  drawStats(ctx, 128, [
    { label: 'CONVOIS', value: counts.convoi ? String(counts.convoi) : 'Aucun', color: TYPE_COLOR.convoi, small: !counts.convoi, valueColor: counts.convoi ? C.text : C.muted },
    { label: 'RÉUNIONS', value: counts.reunion ? String(counts.reunion) : 'Aucun', color: TYPE_COLOR.reunion, small: !counts.reunion, valueColor: counts.reunion ? C.text : C.muted },
    { label: 'ÉVÉNEMENTS', value: counts.event ? String(counts.event) : 'Aucun', color: TYPE_COLOR.event, small: !counts.event, valueColor: counts.event ? C.text : C.muted },
    { label: 'PROCHAIN', value: o.next || 'Aucun', color: C.green, small: true, valueColor: C.greenLight, border: '#3d8f5c' }
  ]);

  let y = gridTop;
  if (!groups.length) {
    roundRect(ctx, PAD, y, W - 2 * PAD, 70, 12);
    ctx.fillStyle = C.cell;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.cellBorder;
    ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.font = `18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aucun événement à venir', W / 2, y + 36);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  for (const g of groups) {
    ctx.fillStyle = C.greenLight;
    ctx.font = `22px ${FONT_BOLD}`;
    ctx.fillText(`${MONTHS[g.m - 1]} ${g.y}`, PAD + 6, y + 28);
    ctx.fillStyle = C.border;
    ctx.fillRect(PAD + 6 + ctx.measureText(`${MONTHS[g.m - 1]} ${g.y}`).width + 16, y + 21, W - 2 * PAD - 6 - ctx.measureText(`${MONTHS[g.m - 1]} ${g.y}`).width - 22, 2);
    y += monthH;
    for (const ev of g.list) {
      const isToday = ev.y === today.y && ev.m === today.m && ev.d === today.d;
      roundRect(ctx, PAD, y, W - 2 * PAD, rowH - 6, 10);
      ctx.fillStyle = isToday ? '#12331f' : C.cell;
      ctx.fill();
      ctx.lineWidth = isToday ? 2 : 1.5;
      ctx.strokeStyle = isToday ? C.greenLight : C.cellBorder;
      ctx.stroke();

      const mid = y + (rowH - 6) / 2;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isToday ? C.greenLight : C.muted;
      ctx.font = `15px ${FONT_BOLD}`;
      ctx.fillText(`${DAYS_LOWER[dowMon(ev.y, ev.m, ev.d)]} ${ev.d}`, PAD + 16, mid + 1);

      const cx = PAD + 112;
      const cwid = W - PAD - 10 - cx;
      const col = TYPE_COLOR[ev.type] || TYPE_COLOR.event;
      roundRect(ctx, cx, y + 4, cwid, rowH - 14, 7);
      ctx.fillStyle = col + '33';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = col + 'cc';
      ctx.stroke();
      ctx.fillStyle = col;
      roundRect(ctx, cx, y + 4, 5, rowH - 14, 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      ctx.font = `16px ${FONT_BOLD}`;
      const time = hhmm(ev);
      ctx.fillText(time, cx + 16, mid + 1);
      const tw = ctx.measureText(time).width;
      ctx.font = `16px ${FONT}`;
      const tail = ev.place ? `  ·  ${ev.place}` : '';
      ctx.fillText(truncate(ctx, `${ev.name}${tail}`, cwid - 36 - tw), cx + 16 + tw + 12, mid + 1);
      ctx.textBaseline = 'alphabetic';
      y += rowH;
    }
    y += 10;
  }
  if (o.events.length > MAX) {
    ctx.fillStyle = C.muted;
    ctx.font = `15px ${FONT_BOLD}`;
    ctx.fillText(`+${o.events.length - MAX} autres événements plus tard`, PAD + 10, y + 16);
  }

  drawLegendAndFooter(ctx, H - 28, o.botName);
  return canvas.toBuffer('image/png');
}

module.exports = { generateAgendaMonth, generateAgendaWeek, generateAgendaAll, MONTHS, DAYS_LOWER, TYPE_LABEL, addDays, dowMon };
