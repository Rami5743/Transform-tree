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

const SEG_CODES = ['2', '4', '6', '8', '28', '46'];
const CORNER_OF = { dl: '1', dr: '3', ul: '7', ur: '9' };

const line = (code, a, fallbackStyle) => ({
  kind: 'seg', code,
  s: style(a.סגנון, fallbackStyle || 'solid'),
  w: len(a.עובי, '2px'),
  c: toCss(a.צבע, 'black'),
  gap: a.רווח ? len(a.רווח, '0px') : ''
});

/** רכיבי הציור של מרצפת בעלת שם מתבנית {{מרצפת}}. */
function namedTile(name, a) {
  if (!name || name === 'ריקה') return [];

  // מרצפות עם גדם קצר, שאינן מצויות ברשימת המרצפות בעלות השם
  if (name === '+מעל' || name === '+מתחת') {
    const base = { s: style(a.סגנון, 'solid'), w: len(a.עובי, '2px'), c: toCss(a.צבע, 'black') };
    const g = len(a.רווח, '2px');
    return name === '+מעל'
      ? [{ kind: 'seg', code: '46', gap: '', ...base },
         { kind: 'seg', code: '8', gap: g, ...base },
         { kind: 'seg', code: '2', gap: g, ...base }]
      : [{ kind: 'seg', code: '4', gap: g, ...base },
         { kind: 'seg', code: '6', gap: g, ...base },
         { kind: 'seg', code: '28', gap: '', ...base }];
  }

  if (name === 'אוניברסלית' || name === 'אוניברסליתע') {
    const keys = name.endsWith('ע') ? ['1', '3', '7', '9'] : ['8', '2', '4', '6'];
    const out = [];
    for (const k of keys) {
      const w = a['עובי' + k];
      if (!w || parseFloat(w) === 0) continue;
      const common = { s: style(a['סגנון' + k], 'solid'), w: len(w, '2px'), c: toCss(a['צבע' + k], 'black') };
      if (name.endsWith('ע')) out.push({ kind: 'corner', n: k, r: len(a['עיגול' + k], '10px'), ...common });
      else out.push({ kind: 'seg', code: k, gap: a['רווח' + k] ? len(a['רווח' + k], '0px') : '', ...common });
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

  const V = present.filter((d) => d === 'u' || d === 'd');
  const H = present.filter((d) => d === 'l' || d === 'r');

  if (!rounded) {
    // המרצפות שבתבנית בנויות מקטע מלא כשהזוג זהה, ומחצאים אחרת; פינה
    // ברדיוס אפס משמשת כשיש בדיוק קטע אנכי אחד וקטע מאוזן אחד.
    const same = (x, y) => style(a.סגנון, def.segs[x].s) === style(a.סגנון, def.segs[y].s) &&
      colorOf(def.segs[x].slot) === colorOf(def.segs[y].slot);
    if (V.length === 1 && H.length === 1 && same(V[0], H[0])) {
      return [{ kind: 'corner', n: CORNER_OF[V[0] + H[0]], r: len(a.עיגול, '0px'), w,
        s: style(a.סגנון, def.segs[V[0]].s), c: colorOf(def.segs[V[0]].slot) }];
    }
    const out = [];
    const emit = (code, d) => out.push({ kind: 'seg', code, w, gap: '',
      s: style(a.סגנון, def.segs[d].s), c: colorOf(def.segs[d].slot) });
    if (H.length === 2 && same('l', 'r')) emit('46', 'l');
    else H.forEach((d) => emit(d === 'l' ? '4' : '6', d));
    if (V.length === 2 && same('u', 'd')) emit('28', 'u');
    else V.forEach((d) => emit(d === 'u' ? '8' : '2', d));
    return out;
  }
  // מרצפת מעוגלת בנויה מפינה לכל צמד של קטע אנכי וקטע מאוזן
  const out = [];
  const r = len(a.עיגול, '10px');
  for (const v of V) {
    for (const h of H) {
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
    else if (t.name === 'קטע' && SEG_CODES.includes(t.pos[0] || '6')) out.push(line(t.pos[0] || '6', t.args));
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

/** תבניות שתפקידן לסמן קישור לוויקיפדיה בשפה אחרת. */
const LANG_LINK = /^(?:אנ|אנ2|אנג|גר|צר|ספ|רו|ער|en|Interlanguage link)$/i;
/** תבניות שאין להן תוכן נראה בתוך תיבה. */
const INVISIBLE = /^(?:הערה|ref|מיון רגיל|קטגוריה|DEFAULTSORT)$/i;

/**
 * פורש תבניות שבתוך טקסט של תיבה, מבפנים כלפי חוץ.
 *
 * תבנית עוטפת כמו {{ללא גלישה|טקסט}} או {{כתב מוקטן|טקסט}} מוחלפת בתוכנה,
 * ולא נמחקת: מחיקתה מרוקנת את התיבה. הכלל הכללי הוא שתבנית בעלת פרמטר
 * ממוספר יחיד היא עוטפת.
 */
function expandTemplates(t) {
  for (let pass = 0; pass < 8; pass++) {
    const next = t.replace(/\{\{([^{}]*)\}\}/g, (all, inner) => {
      const parts = splitTopLevel(inner, '|');
      const name = parts[0].trim();
      if (/^(?:ש|break|br)$/i.test(name)) return '\u0001BR\u0001';
      if (LANG_LINK.test(name)) return '\u0001LANG\u0001';
      if (INVISIBLE.test(name)) return '';
      const positional = parts.slice(1).filter((x) => !/^[^=]{1,30}=/.test(x));
      return positional.length === 1 ? positional[0] : '';
    });
    if (next === t) return t;
    t = next;
  }
  return t;
}

/** רינדור גס של קוד ויקי לתצוגה. קבצים מוחלפים בסימן מקום. */
function wikiText(text) {
  let t = expandTemplates(String(text || ''));
  t = t.replace(/<br\s*\/?>/gi, '\u0001BR\u0001');
  t = t.replace(/\[\[\s*(?:תמונה|קובץ|File|Image)\s*:[^\]]*\]\]/gi, '\u0001IMG\u0001');
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = esc(t);
  t = t.replace(/'''(.*?)'''/g, '<b>$1</b>').replace(/''(.*?)''/g, '<i>$1</i>');
  return t.split('\u0001IMG\u0001').join('<span class="pv-img" title="קובץ"></span>')
    .split('\u0001LANG\u0001').join('<span class="pv-lang">(אנ)</span>')
    .split('\u0001BR\u0001').join('<br>');
}

/*
 * הגאומטריה מועתקת כלשונה מתבנית:קטע, מתבנית:פינה ומגיליון הסגנונות של
 * תבנית תרשים. בפרט: הקו אינו ממורכז על קו האמצע של התא אלא צמוד לו מצדו
 * האחד, וזה מה שמביא קטעים ופינות שכנים לחפוף בדיוק.
 */
function segStyle(p) {
  const b = `${p.w} ${p.s} ${p.c}`;
  const g = p.gap;
  switch (p.code) {
    case '46': return `bottom:0;left:0;right:0;height:50%;border-top:${b}`;
    case '28': return `bottom:0;right:0;width:50%;height:100%;border-left:${b}`;
    case '8': return `top:0;right:0;width:50%;height:${g ? `calc(50% - ${g} + ${p.w})` : '50%'};border-left:${b}`;
    case '2': return `bottom:0;right:0;width:50%;height:${g ? `calc(50% + ${p.w} - ${g})` : `calc(50% + ${p.w} / 2)`};border-left:${b}`;
    case '4': return `bottom:0;left:0;right:${g ? `calc(50% + ${g} + ${p.w})` : '50%'};height:50%;border-top:${b}`;
    default: return `bottom:0;right:0;width:${g ? `calc(50% - ${g})` : '50%'};height:50%;border-top:${b}`;
  }
}

function cornerStyle(p) {
  const b = `${p.w} ${p.s} ${p.c}`;
  switch (String(p.n)) {
    case '1': return `bottom:0;left:0;right:50%;height:50%;border-right:${b};border-top:${b};border-radius:0 ${p.r} 0 0`;
    case '3': return `bottom:0;right:0;width:50%;height:50%;border-left:${b};border-top:${b};border-radius:${p.r} 0 0 0`;
    case '7': return `top:0;left:0;right:50%;bottom:50%;border-right:${b};border-bottom:${b};border-radius:0 0 ${p.r} 0`;
    default: return `top:0;right:0;width:50%;bottom:50%;border-left:${b};border-bottom:${b};border-radius:0 0 0 ${p.r}`;
  }
}

/**
 * תיבת טקסט: {{תרשים/תיבה}} על פרמטריה.
 *
 * המבנה מועתק מן התבנית עצמה: שכבת מסגרת הממוקמת מיקום מוחלט ונפרשת על כל
 * התא, ומעליה שכבת התוכן בזרימה. זה מה שמביא את הקווים שבתאים הסמוכים לגעת
 * בדיוק בגבול התיבה; תיבה שהיא div בזרימה משאירה רווח.
 */
function boxCell(text, span) {
  const t = templates(text).find((x) => /^תרשים\/תיבה/.test(x.name));
  const a = t ? t.args : {};
  const border = len(a['עובי מסגרת'], '2px');
  const frame = [
    'background-color:' + toCss(a['צבע רקע'], PRESETS['רקע']),
    'border:' + border + ' ' + style(a['סגנון מסגרת'], 'solid') + ' ' + toCss(a['צבע מסגרת'], 'black'),
    'border-radius:' + len(a['עיגול פינות'], '5px')
  ].join(';') + ';' + (a['עיצוב'] || '');
  const pad = `padding:calc(${border} + 2px)`;
  return `<td colspan="${span}" class="pv-boxcell">` +
    `<div class="pv-frame" style="${esc(frame)}"></div>` +
    `<div class="pv-content" style="${pad}">${wikiText(a['טקסט'] || '')}</div></td>`;
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
      // {{ממלא מקום}} — div בזרימה שקובע את הגודל המזערי של התא
      return `<td class="pv-tilecell"><i class="pv-spacer"></i>${prims}</td>`;
    });
    return '<tr>' + cells.join('') + '</tr>';
  });
  return '<table class="pv-table">' + html.join('') + '</table>';
}
