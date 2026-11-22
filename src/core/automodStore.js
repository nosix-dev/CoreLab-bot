// src/core/automodStore.js : réglages de la page « Automodération » du dashboard
// (règles, automod intelligent, filtre de liens, nouveaux membres, limite de publication).
// Stockés dans bot_config.json (automod_rules, automod_smart, automod_links, automod_newmembers,
// automod_ratelimit, automod_stats). Les règles qui existaient déjà dans le bot restent liées à leur
// interrupteur historique (/protect) : le dashboard et /protect affichent donc toujours la même chose.

const ACTIONS = ['delete', 'warn', 'timeout', 'alert'];
// Règle du dashboard → réglage historique du bot qui l'applique déjà
const FLAG = { scam_image: 'anti_scam_image', phishing: 'anti_phishing', spam: 'antispam', mentions: 'antieveryone' };
const BASE = [
  { id: 'scam_image', name: 'Arnaques en image', desc: 'Supprime les fausses promos de casino, cadeaux crypto et faux concours publiés en image.', action: 'delete', heat: 2 },
  { id: 'insults', name: 'Insultes et injures', desc: 'Supprime les messages contenant des insultes ou des injures courantes.', action: 'warn', heat: 1 },
  { id: 'spam', name: 'Spam et répétitions', desc: 'Détecte les caractères, mots ou lignes répétés à la chaîne.', action: 'delete', heat: 1 },
  { id: 'caps', name: 'Majuscules abusives', desc: 'Supprime les messages écrits presque entièrement en majuscules.', action: 'delete', heat: 1 },
  { id: 'mentions', name: 'Mentions de masse', desc: 'Bloque les messages qui mentionnent beaucoup de membres ou @everyone.', action: 'timeout', heat: 3 },
  { id: 'invites', name: 'Invitations Discord', desc: 'Supprime les invitations vers d’autres serveurs.', action: 'delete', heat: 1 },
  { id: 'phishing', name: 'Phishing et faux Nitro', desc: 'Supprime les faux cadeaux Nitro, faux liens Steam et domaines imitant Discord.', action: 'delete', heat: 3 }
];
const MAX_RULES = 40;
const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'goo.gl', 't.co', 'ow.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy'];

const TESTS = {
  insults: t => /(?<![\p{L}\p{N}])(?:connard|connasse|salope|enfoir[ée]|pute|fdp|ntm|encul[ée]|abruti|d[ée]bile|idiot|merde)s?(?![\p{L}\p{N}])/iu.test(t),
  caps: t => { const l = t.replace(/[^A-Za-zÀ-ÿ]/g, ''); if (l.length < 10) return false; return l.replace(/[^A-ZÀ-Ý]/g, '').length / l.length > 0.7; },
  invites: t => /(discord\.gg|discord(?:app)?\.com\/invite)\/\w+/i.test(t)
};
function customHit(r, t) {
  const p = String(r.pattern || '');
  if (!p.trim()) return false;
  if (r.type === 'regex') { try { return new RegExp(p, 'i').test(t.slice(0, 2000)); } catch { return false; } }
  const low = t.toLowerCase();
  return p.split(/[\n,]+/).map(x => x.trim().toLowerCase()).filter(Boolean).some(w => low.includes(w));
}
function matchRule(r, text) {
  text = String(text || '').slice(0, 4000);
  if (r.custom) return customHit(r, text);
  return TESTS[r.id] ? TESTS[r.id](text) : false;
}

const idList = (a, max = 25) => Array.isArray(a) ? [...new Set(a.map(String))].slice(0, max) : [];
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const act = (v, d) => ACTIONS.includes(v) ? v : d;

/* ---------- Lecture ---------- */
function readRules(cfg) {
  const saved = Array.isArray(cfg.automod_rules) ? cfg.automod_rules : [];
  const out = BASE.map(b => {
    const s = saved.find(x => x && x.id === b.id) || {};
    return {
      id: b.id, name: b.name, desc: b.desc,
      enabled: FLAG[b.id] ? !!cfg[FLAG[b.id]] : s.enabled === true,
      action: act(s.action, b.action), heat: clampInt(s.heat, 0, 10, b.heat),
      ex_channels: idList(s.ex_channels), ex_roles: idList(s.ex_roles)
    };
  });
  for (const s of saved) {
    if (!s || !s.custom || BASE.some(b => b.id === s.id)) continue;
    out.push({ id: String(s.id), name: String(s.name || 'Règle'), desc: String(s.desc || ''), custom: true, type: s.type === 'regex' ? 'regex' : 'words', pattern: String(s.pattern || ''), enabled: s.enabled === true, action: act(s.action, 'delete'), heat: clampInt(s.heat, 0, 10, 1), ex_channels: idList(s.ex_channels), ex_roles: idList(s.ex_roles) });
  }
  return out;
}
function readSmart(cfg) {
  const s = cfg.automod_smart || {};
  return { enabled: !!cfg.anti_scam_ai, level: ['low', 'medium', 'high'].includes(s.level) ? s.level : 'medium', cats: { toxicity: s.cats?.toxicity !== false, harassment: s.cats?.harassment !== false, spam: s.cats?.spam !== false, nsfw: s.cats?.nsfw === true }, channel: s.channel ? String(s.channel) : '', action: act(s.action, 'alert') };
}
function readLinks(cfg) {
  const s = cfg.automod_links || {};
  return { enabled: s.enabled === true, mode: ['blacklist', 'whitelist', 'all'].includes(s.mode) ? s.mode : 'blacklist', domains: String(s.domains || ''), block_invites: s.block_invites !== false, block_shorteners: s.block_shorteners === true, action: act(s.action, 'delete') };
}
function readNewm(cfg) {
  const s = cfg.automod_newmembers || {};
  return { enabled: !!cfg.anti_alt_enabled, min_age_days: clampInt(cfg.anti_alt_min_days, 0, 365, 7), restrict_hours: clampInt(s.restrict_hours, 0, 168, 24), restrict: ['links', 'media', 'all'].includes(s.restrict) ? s.restrict : 'links', action: ['alert', 'quarantine', 'kick'].includes(s.action) ? s.action : 'alert', channel: s.channel ? String(s.channel) : '', restrict_enabled: s.restrict_enabled === true };
}
function readRate(cfg) {
  const s = cfg.automod_ratelimit || {};
  return { enabled: s.enabled === true, max: clampInt(s.max, 2, 50, 5), window: clampInt(s.window, 1, 60, 5), action: act(s.action, 'timeout'), timeout_min: clampInt(s.timeout_min, 1, 1440, 10) };
}
function readStats(cfg) { return cfg.automod_stats && typeof cfg.automod_stats === 'object' ? cfg.automod_stats : {}; }
const READERS = { amrules: readRules, amsmart: readSmart, amlinks: readLinks, amnewm: readNewm, amrate: readRate, amstats: readStats };
function read(type, cfg) { return READERS[type](cfg || {}); }

/* ---------- Validation (PUT) ---------- */
function regexRisky(p) { return p.length > 200 || /(\+|\*|\})\)?\s*(\+|\*|\{)/.test(p); }
function check(type, v, cur, ctx) {
  const bad = reason => ({ err: reason });
  const chanOk = id => !id || ctx.chanIds.has(id) || (cur && JSON.stringify(cur).includes(id));
  const roleOk = id => ctx.guild.roles.cache.has(id) || (cur && JSON.stringify(cur).includes(id));
  if (type === 'amrules') {
    if (!Array.isArray(v) || v.length > MAX_RULES) return bad(`${MAX_RULES} règles maximum`);
    const seen = new Set(), out = [];
    for (const r of v) {
      if (!r || typeof r !== 'object') return bad('règle invalide');
      const id = String(r.id || '');
      if (!/^[a-z0-9_]{1,40}$/.test(id) || seen.has(id)) return bad('identifiant de règle invalide');
      seen.add(id);
      const isBase = BASE.some(b => b.id === id);
      if (!isBase && !(r.custom && id.startsWith('custom_'))) return bad('règle inconnue');
      const ex_channels = idList(r.ex_channels), ex_roles = idList(r.ex_roles);
      if (!ex_channels.every(chanOk)) return bad('salon exclu introuvable');
      if (!ex_roles.every(roleOk)) return bad('rôle exclu introuvable');
      const o = { id, enabled: r.enabled === true, action: act(r.action, 'delete'), heat: clampInt(r.heat, 0, 10, 1), ex_channels, ex_roles };
      if (!isBase) {
        o.custom = true; o.name = String(r.name || '').trim().slice(0, 60); o.desc = String(r.desc || '').slice(0, 200);
        o.type = r.type === 'regex' ? 'regex' : 'words'; o.pattern = String(r.pattern || '').slice(0, 1000);
        if (!o.name) return bad('nom de règle manquant');
        if (!o.pattern.trim()) return bad(`motif manquant (${o.name})`);
        if (o.type === 'regex') { try { new RegExp(o.pattern, 'i'); } catch { return bad(`expression régulière invalide (${o.name})`); } if (regexRisky(o.pattern)) return bad(`expression trop complexe (${o.name})`); }
      }
      out.push(o);
    }
    return { value: out };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('format invalide');
  if (type === 'amsmart') {
    if (v.channel && !chanOk(String(v.channel))) return bad('salon introuvable');
    return { value: { enabled: v.enabled === true, level: ['low', 'medium', 'high'].includes(v.level) ? v.level : 'medium', cats: { toxicity: v.cats?.toxicity !== false, harassment: v.cats?.harassment !== false, spam: v.cats?.spam !== false, nsfw: v.cats?.nsfw === true }, channel: v.channel ? String(v.channel) : '', action: act(v.action, 'alert') } };
  }
  if (type === 'amlinks') {
    const domains = String(v.domains || '').slice(0, 3000);
    return { value: { enabled: v.enabled === true, mode: ['blacklist', 'whitelist', 'all'].includes(v.mode) ? v.mode : 'blacklist', domains, block_invites: v.block_invites !== false, block_shorteners: v.block_shorteners === true, action: act(v.action, 'delete') } };
  }
  if (type === 'amnewm') {
    if (v.channel && !chanOk(String(v.channel))) return bad('salon introuvable');
    return { value: { enabled: v.enabled === true, min_age_days: clampInt(v.min_age_days, 0, 365, 7), restrict_hours: clampInt(v.restrict_hours, 0, 168, 24), restrict: ['links', 'media', 'all'].includes(v.restrict) ? v.restrict : 'links', action: ['alert', 'quarantine', 'kick'].includes(v.action) ? v.action : 'alert', channel: v.channel ? String(v.channel) : '', restrict_enabled: v.restrict_hours > 0 } };
  }
  if (type === 'amrate') {
    return { value: { enabled: v.enabled === true, max: clampInt(v.max, 2, 50, 5), window: clampInt(v.window, 1, 60, 5), action: act(v.action, 'timeout'), timeout_min: clampInt(v.timeout_min, 1, 1440, 10) } };
  }
  return bad('type inconnu');
}

/* Après une écriture : recopie les interrupteurs dans les réglages historiques du bot */
function syncFlags(cfg) {
  if (Array.isArray(cfg.automod_rules)) for (const r of cfg.automod_rules) if (FLAG[r.id]) cfg[FLAG[r.id]] = r.enabled === true;
  if (cfg.automod_smart) cfg.anti_scam_ai = cfg.automod_smart.enabled === true;
  if (cfg.automod_newmembers) { cfg.anti_alt_enabled = cfg.automod_newmembers.enabled === true; cfg.anti_alt_min_days = cfg.automod_newmembers.min_age_days; }
}

module.exports = { ACTIONS, FLAG, BASE, SHORTENERS, read, check, syncFlags, readRules, readLinks, readNewm, readRate, matchRule };