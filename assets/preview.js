/*
 * preview.js — תצוגה מקדימה של התרשים בתוך הדפדפן.
 *
 * התצוגה נבנית מתוך **קוד הפלט** ולא מתוך הקלט: היא מפענחת את קריאות
 * {{מרצפת}}, {{קטע}} ו{{פינה}} שהכלי הפיק, ומציירת אותן לפי הגאומטריה של
 * גיליון הסגנונות של תבנית תרשים. כך היא בודקת את התוצאה ולא את ההבנה
 * של הקלט.
 *
 * היא אינה מריצה תבניות ויקי, ולכן תוכן תיבות הטקסט מוצג בקירוב.
 */

import { MZ_TILES, MZ_C2_DEFAULT } from './tiles.js';
import { splitTopLevel } from './convert.js';
import { toCss, PRESETS } from './colors.js';

/* ------------------------------------------------------------------ *
 *  תרגום ערכים
 * ------------------------------------------------------------------ */

const UNITS = { 'סמ': 'cm', 'ממ': 'mm', 'אנ': 'in', 'פק': 'px', 'נק': 'pt', 'פכ': 'pc',
  'את': 'em', 'אמ': 'em', 'אם': 'em', 'אק': 'ex', 'אפ': 'ch', 'שר': 'rem',
  'רח': 'vw', 'גב': 'vh', 'קט': 'vmin', 'גד': 'vmax' };

const STYLES = { 'מוצק': 'solid', 'רצוף': 'solid', 'מלא': 'solid', 'רגיל': 'solid',
  'נסתר': 'hidden', 'ללא': 'none', 'מנוקד': 'dotted', 'מקוטע': 'dashed',
  'מקווקו': 'dashed', 'כפול': 'double', 'חריץ': 'groove', 'רכס': 'ridge',
  'שקוע': 'inset', 'בולט': 'outset' };

/** תרגום אורך בכתיב עברי ליחידות CSS, כמו {{תרגום אורך}}. */
function len(value, fallback) {
  const v = (value === undefined || value === null ? '' : String(value)).trim();
  if (!v) return fallback;
  const m = /^(-?[\d.]+)\s*(\S*)$/.exec(v);
  if (!m) return v;
  if (!m[2]) return m[1] + 'px';
  return m[1] + (UNITS[m[2]] || m[2]);
}

const style = (v, fallback) => (v ? STYLES[String(v).trim()] || String(v).trim() : fallback);

/* ------------------------------------------------------------------ *
 *  פענוח קוד הוויקי שבפלט
 * ------------------------------------------------------------------ */

/** מאתר את קריאות התבנית שברמה העליונה של מחרוזת. */
function templates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (!text.startsWith('{{', i)) { i++; continue; }
    let depth = 0, j = i;
    while (j < text.length) {
      if (text.startsWith('{{', j)) { depth++; j += 2; }
      else if (text.startsWith('}}', j)) { depth--; j += 2; if (!depth) break; }
      else j++;
    }
    const parts = splitTopLevel(text.slice(i + 2, j - 2), '|');
    const args = {};
    const pos = [];
    for (const part of parts.slice(1)) {
      const e = part.indexOf('=');
      if (e > 0) args[part.slice(0, e).trim()] = part.slice(e + 1).trim();
      else pos.push(part.trim());
    }
    out.push({ name: parts[0].trim(), pos, args });
    i = j;
  }
  return out;
}

/** מפרק את טבלת התרשים שבפלט לשורות ולתאים. */
function parseTable(wiki) {
  const start = wiki.indexOf('{| class="DiagramTable"');
  if (start < 0) return [];
  const rows = [];
  let cur = null;
  for (const line of wiki.slice(start).split('\n').slice(1)) {
    const t = line.trim();
    if (t === '|}') break;
    if (t === '|-') { cur = []; rows.push(cur); }
    else if (cur && line.startsWith('|')) cur.push(line.slice(1).trim());
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 *  מקריאת תבנית לרכיבי ציור
 * ------------------------------------------------------------------ */

const SEG_DIRS = { '2': ['d'], '4': ['l'], '6': ['r'], '8': ['u'], '28': ['u', 'd'], '46': ['l', 'r'] };
const CORNER_OF = { dl: '1', dr: '3', ul: '7', ur: '9' };

const line = (dir, a, fallbackStyle) => ({
  kind: 'seg', dir,
  s: style(a.סגנון, fallbackStyle || 'solid'),
  w: len(a.עובי, '2px'),
  c: toCss(a.צבע, 'black')
});

/** רכיבי הציור של מרצפת בעלת שם מתבנית {{מרצפת}}. */
function namedTile(name, a) {
  if (!name || name === 'ריקה') return [];

  if (name === 'אוניברסלית' || name === 'אוניברסליתע') {
    const keys = name.endsWith('ע') ? ['1', '3', '7', '9'] : ['8', '2', '4', '6'];
    const out = [];
    for (const k of keys) {
      const w = a['עובי' + k];
      if (!w || parseFloat(w) === 0) continue;
      const common = { s: style(a['סגנון' + k], 'solid'), w: len(w, '2px'), c: toCss(a['צבע' + k], 'black') };
      if (name.endsWith('ע')) out.push({ kind: 'corner', n: k, r: len(a['עיגול' + k], '10px'), ...common });
      else out.push({ kind: 'seg', dir: SEG_DIRS[k][0], ...common });
    }
    return out;
  }

  const def = MZ_TILES.find((t) => t.name === name || t.round === name);
  if (!def) return [];
  const rounded = def.round === name;
  const colorOf = (slot) => (slot === 'צבע2'
    ? toCss(a['צבע2'] !== undefined ? a['צבע2'] : MZ_C2_DEFAULT, 'black')
    : toCss(a['צבע'], 'black'));
  const present = ['u', 'd', 'l', 'r'].filter((d) => def.segs[d]);
  const w = len(a.עובי, '2px');

  if (!rounded) {
    return present.map((d) => ({
      kind: 'seg', dir: d, w,
      s: style(a.סגנון, def.segs[d].s),
      c: colorOf(def.segs[d].slot)
    }));
  }
  // מרצפת מעוגלת בנויה מפינה לכל צמד של קטע אנכי וקטע מאוזן
  const out = [];
  const r = len(a.עיגול, '10px');
  for (const v of present.filter((d) => d === 'u' || d === 'd')) {
    for (const h of present.filter((d) => d === 'l' || d === 'r')) {
      out.push({
        kind: 'corner', n: CORNER_OF[v + h], r, w,
        s: style(a.סגנון, def.segs[v].s),
        c: colorOf(def.segs[v].slot)
      });
    }
  }
  return out;
}

/** רכיבי הציור של תא מרצפת שלם — קריאה אחת או הרכבה של כמה תבניות. */
function cellPrims(text) {
  const out = [];
  for (const t of templates(text)) {
    if (t.name === 'מרצפת') out.push(...namedTile(t.pos[0] || '', t.args));
    else if (t.name === 'קטע') for (const d of SEG_DIRS[t.pos[0] || '6'] || []) out.push(line(d, t.args));
    else if (t.name === 'פינה') {
      out.push({ kind: 'corner', n: t.pos[0] || '9', r: len(t.args.עיגול, '10px'),
        s: style(t.args.סגנון, 'solid'), w: len(t.args.עובי, '2px'), c: toCss(t.args.צבע, 'black') });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  ציור
 * ------------------------------------------------------------------ */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** רינדור גס של קוד ויקי לתצוגה. קבצים מוחלפים בסימן מקום. */
function wikiText(text) {
  let t = String(text || '');
  t = t.replace(/\{\{\s*(?:ש|break|br)\s*\}\}/g, '\u0001BR\u0001');
  t = t.replace(/<br\s*\/?>/gi, '\u0001BR\u0001');
  t = t.replace(/\[\[\s*(?:תמונה|קובץ|File|Image)\s*:[^\]]*\]\]/gi, '\u0001IMG\u0001');
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = esc(t);
  t = t.replace(/'''(.*?)'''/g, '<b>$1</b>').replace(/''(.*?)''/g, '<i>$1</i>');
  return t.split('\u0001IMG\u0001').join('<span class="pv-img" title="קובץ"></span>')
    .split('\u0001BR\u0001').join('<br>');
}

/** הקו מצויר כך שמרכזו על קו האמצע של התא, ולכן הצמתים רציפים. */
function segStyle(p) {
  const half = `calc(${p.w} / 2)`;
  const long = `calc(50% + ${half})`;
  const border = `${p.w} ${p.s} ${p.c}`;
  if (p.dir === 'u') return `top:0;left:calc(50% - ${half});width:0;height:${long};border-left:${border}`;
  if (p.dir === 'd') return `bottom:0;left:calc(50% - ${half});width:0;height:${long};border-left:${border}`;
  if (p.dir === 'l') return `left:0;top:calc(50% - ${half});height:0;width:${long};border-top:${border}`;
  return `right:0;top:calc(50% - ${half});height:0;width:${long};border-top:${border}`;
}

function cornerStyle(p) {
  const half = `calc(${p.w} / 2)`;
  const mid = `calc(50% - ${half})`;
  const b = `${p.w} ${p.s} ${p.c}`;
  switch (String(p.n)) {
    case '1': return `left:0;right:${mid};top:${mid};bottom:0;border-right:${b};border-top:${b};border-radius:0 ${p.r} 0 0`;
    case '3': return `right:0;left:${mid};top:${mid};bottom:0;border-left:${b};border-top:${b};border-radius:${p.r} 0 0 0`;
    case '7': return `left:0;right:${mid};top:0;bottom:${mid};border-right:${b};border-bottom:${b};border-radius:0 0 ${p.r} 0`;
    default: return `right:0;left:${mid};top:0;bottom:${mid};border-left:${b};border-bottom:${b};border-radius:0 0 0 ${p.r}`;
  }
}

/** תיבת טקסט: {{תרשים/תיבה}} על פרמטריה. */
function boxCell(text, span) {
  const t = templates(text).find((x) => /^תרשים\/תיבה/.test(x.name));
  const a = t ? t.args : {};
  const css = [
    'background:' + toCss(a['צבע רקע'], PRESETS['רקע']),
    'border:' + len(a['עובי מסגרת'], '2px') + ' ' + style(a['סגנון מסגרת'], 'solid') + ' ' + toCss(a['צבע מסגרת'], 'black'),
    'border-radius:' + len(a['עיגול פינות'], '5px')
  ].join(';') + ';' + (a['עיצוב'] || '');
  return `<td colspan="${span}" class="pv-boxcell"><div class="pv-box" style="${esc(css)}">${wikiText(a['טקסט'] || '')}</div></td>`;
}

/**
 * בונה את ה-HTML של התצוגה המקדימה מתוך קוד הפלט.
 */
export function renderPreview(wiki) {
  const rows = parseTable(wiki || '');
  if (!rows.length) return '<p class="muted">אין מה להציג.</p>';
  const html = rows.map((row) => {
    const cells = row.map((cell) => {
      const m = /^colspan="(\d+)"\s*\|\s*([\s\S]*)$/.exec(cell);
      if (m) return boxCell(m[2], m[1]);
      const prims = cellPrims(cell)
        .map((p) => `<i class="pv-p" style="${p.kind === 'seg' ? segStyle(p) : cornerStyle(p)}"></i>`)
        .join('');
      return `<td class="pv-tilecell">${prims}</td>`;
    });
    return '<tr>' + cells.join('') + '</tr>';
  });
  return '<table class="pv-table">' + html.join('') + '</table>';
}
