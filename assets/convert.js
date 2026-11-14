/*
 * convert.js — המרת קוד {{עץ משפחה}} לקוד {{תרשים}}.
 *
 * המודול חף מתלות בדפדפן וניתן להרצה גם ב-Node (לבדיקות).
 */

import { DIRS, DIR_DIGIT, FT_TILES, MZ_TILES, MZ_C2_DEFAULT } from './tiles.js';

/* ------------------------------------------------------------------ *
 *  1. פיצול טקסט ויקי תוך התעלמות ממה שנמצא בתוך מבנים מקוננים
 * ------------------------------------------------------------------ */

/**
 * סורק טקסט ויקי ומחזיר את המיקומים של כל מופעי התו המפריד שאינם
 * בתוך {{...}}, {{{...}}}, [[...]], <nowiki>, הערת HTML או תגית HTML.
 */
function topLevelPositions(text, sep) {
  const out = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    // הערת HTML
    if (text.startsWith('<!--', i)) {
      const j = text.indexOf('-->', i + 4);
      i = j === -1 ? text.length : j + 3;
      continue;
    }
    // <nowiki> ... </nowiki>
    const nw = /^<nowiki\s*>/i.exec(text.slice(i, i + 12));
    if (nw) {
      const j = text.toLowerCase().indexOf('</nowiki>', i);
      i = j === -1 ? text.length : j + 9;
      continue;
    }
    // תגית HTML בודדת — מדלגים עליה כולל המחרוזות שבתוכה
    if (text[i] === '<' && /[a-zA-Z/]/.test(text[i + 1] || '')) {
      let j = i + 1, q = null;
      while (j < text.length) {
        const c = text[j];
        if (q) { if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === '>') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    if (text.startsWith('{{{', i)) { stack.push('{{{'); i += 3; continue; }
    if (text.startsWith('}}}', i) && stack[stack.length - 1] === '{{{') { stack.pop(); i += 3; continue; }
    if (text.startsWith('{{', i)) { stack.push('{{'); i += 2; continue; }
    if (text.startsWith('}}', i) && stack[stack.length - 1] === '{{') { stack.pop(); i += 2; continue; }
    if (text.startsWith('[[', i)) { stack.push('[['); i += 2; continue; }
    if (text.startsWith(']]', i) && stack[stack.length - 1] === '[[') { stack.pop(); i += 2; continue; }
    if (stack.length === 0 && text.startsWith(sep, i)) { out.push(i); i += sep.length; continue; }
    i++;
  }
  return out;
}

/** פיצול לפי מפריד, תוך התעלמות ממבנים מקוננים. */
export function splitTopLevel(text, sep = '|') {
  const pos = topLevelPositions(text, sep);
  const parts = [];
  let prev = 0;
  for (const p of pos) { parts.push(text.slice(prev, p)); prev = p + sep.length; }
  parts.push(text.slice(prev));
  return parts;
}

/** המיקום של המפריד הראשון שאינו מקונן, או 1- אם אין כזה. */
function firstTopLevel(text, sep) {
  const pos = topLevelPositions(text, sep);
  return pos.length ? pos[0] : -1;
}

/* ------------------------------------------------------------------ *
 *  2. איתור קריאות התבנית בטקסט הקלט
 * ------------------------------------------------------------------ */

const ROW_NAME = String.raw`עץ[ _]+משפחה|family\s*tree`;
const RE_ROW = new RegExp(String.raw`\{\{\s*(?:${ROW_NAME})\s*(?=[|}])`, 'giu');
const RE_START = new RegExp(String.raw`\{\{\s*(?:${ROW_NAME})\s*/\s*(התחלה|סוף|start|end)\s*(?=[|}])`, 'giu');

/** מאתר את ה-}} הסוגר של תבנית שמתחילה ב-start (האינדקס של "{{"). */
function matchTemplateEnd(text, start) {
  let depth = 0, i = start;
  while (i < text.length) {
    if (text.startsWith('{{{', i)) { depth++; i += 3; continue; }
    if (text.startsWith('}}}', i)) { depth--; i += 3; if (depth === 0) return i; continue; }
    if (text.startsWith('{{', i)) { depth++; i += 2; continue; }
    if (text.startsWith('}}', i)) { depth--; i += 2; if (depth === 0) return i; continue; }
    i++;
  }
  return -1;
}

/**
 * מחזיר את תוכנן של כל קריאות {{עץ משפחה|...}} בטקסט (ללא
 * {{עץ משפחה/התחלה}} ו{{עץ משפחה/סוף}}), וכן את הפרמטרים של תבנית
 * ההתחלה אם נמצאה.
 */
export function extractRows(text) {
  const rows = [];
  const wrappers = [];
  const taken = [];

  for (const m of [...text.matchAll(RE_START)]) {
    const end = matchTemplateEnd(text, m.index);
    if (end === -1) continue;
    const inner = text.slice(m.index + m[0].length, end - 2);
    wrappers.push({ kind: m[1], inner: inner.replace(/^\|/, '') });
    taken.push([m.index, end]);
  }

  for (const m of [...text.matchAll(RE_ROW)]) {
    if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const end = matchTemplateEnd(text, m.index);
    if (end === -1) continue;
    let inner = text.slice(m.index + m[0].length, end - 2);
    inner = inner.replace(/^\|/, '');
    rows.push(inner);
  }
  return { rows, wrappers };
}

/* ------------------------------------------------------------------ *
 *  3. פירוק שורה לפרמטרים
 * ------------------------------------------------------------------ */

/** מפרק את תוכן השורה לפרמטרים ממוספרים ולפרמטרים שמיים. */
export function parseRow(inner) {
  const positional = [];
  const named = Object.create(null);
  for (const part of splitTopLevel(inner, '|')) {
    const eq = firstTopLevel(part, '=');
    if (eq >= 0) {
      named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    } else {
      positional.push(part);
    }
  }
  return { positional, named };
}

/* ------------------------------------------------------------------ *
 *  4. התאמת מרצפת {{מרצפת}} לקבוצת קטעים
 * ------------------------------------------------------------------ */

const STYLE_HE = { solid: 'רצוף', dashed: 'מקווקו' };
const styleName = (s) => STYLE_HE[s] || s;
const COLOR_KEY = (c) => (c === null || c === undefined ? '\u0000' : c);

function dirsOf(segs) { return DIRS.filter((d) => segs[d]); }

function samePartition(a, b) {
  const norm = (m) => [...m.values()].map((v) => v.slice().sort().join(',')).sort().join('|');
  return norm(a) === norm(b);
}

function groupBy(dirs, keyFn) {
  const m = new Map();
  for (const d of dirs) {
    const k = keyFn(d);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  return m;
}

/**
 * מנסה להתאים מרצפת בעלת שם מתבנית {{מרצפת}} לקבוצת הקטעים המבוקשת.
 * מחזיר { name, params } או null.
 */
function matchNamed(target, cand, opts) {
  const td = dirsOf(target), cd = dirsOf(cand.segs);
  if (td.length !== cd.length || td.some((d) => !cand.segs[d])) return null;

  // --- סגנון ---
  const styles = new Set(td.map((d) => target[d].s));
  let styleParam = null;
  if (styles.size === 1) {
    const st = [...styles][0];
    if (td.some((d) => cand.segs[d].s !== st)) styleParam = st;
  } else {
    if (td.some((d) => cand.segs[d].s !== target[d].s)) return null;
  }

  // --- צבעים ---
  const colorGroups = groupBy(td, (d) => COLOR_KEY(target[d].col));
  const slotGroups = groupBy(td, (d) => cand.segs[d].slot);
  const assign = {}; // slot -> color
  if (colorGroups.size === 1) {
    const col = target[td[0]].col;
    for (const slot of slotGroups.keys()) assign[slot] = col;
  } else {
    if (colorGroups.size !== slotGroups.size || !samePartition(colorGroups, slotGroups)) return null;
    for (const [slot, dirs] of slotGroups) assign[slot] = target[dirs[0]].col;
  }

  // --- בניית הפרמטרים ---
  const rounded = Boolean(opts.round && cand.round);
  const name = rounded ? cand.round : cand.name;
  const params = [];
  if (styleParam) params.push('סגנון=' + styleName(styleParam));
  if (slotGroups.has('צבע') && assign['צבע'] != null) params.push('צבע=' + assign['צבע']);
  if (slotGroups.has('צבע2')) params.push('צבע2=' + (assign['צבע2'] != null ? assign['צבע2'] : 'black'));
  if (opts.lineWidth) params.push('עובי=' + opts.lineWidth);
  if (rounded && opts.cornerRadius) params.push('עיגול=' + opts.cornerRadius);
  return { name, params };
}

/** מרצפת אוניברסלית — פתרון כללי לכל צירוף קטעים. */
function universal(target, opts) {
  const params = [];
  for (const d of DIRS) {
    const seg = target[d];
    if (!seg) continue;
    const n = DIR_DIGIT[d];
    params.push('עובי' + n + '=' + (opts.lineWidth || '2px'));
    if (seg.s !== 'solid') params.push('סגנון' + n + '=' + styleName(seg.s));
    if (seg.col != null) params.push('צבע' + n + '=' + seg.col);
  }
  return { name: 'אוניברסלית', params };
}

/** בונה את קוד {{מרצפת}} עבור קבוצת קטעים. */
export function tileWiki(target, opts) {
  let best = null;
  for (const cand of MZ_TILES) {
    const m = matchNamed(target, cand, opts);
    if (m && (!best || m.params.length < best.params.length)) best = m;
  }
  const chosen = best || universal(target, opts);
  return '{{מרצפת|' + [chosen.name, ...chosen.params].join('|') + '}}';
}

/* ------------------------------------------------------------------ *
 *  5. ההמרה עצמה
 * ------------------------------------------------------------------ */

export const DEFAULT_OPTIONS = {
  changeBoxColor: false,
  boxColor: 'לבן',
  changeBoxBoundary: false,
  boundaryColor: '{{תרשים/הגדרות|זכר}}',
  round: true,
  cornerRadius: '',
  replaceDashes: true,
  newColor: '{{תרשים/הגדרות|נישואין}}',
  keepLineWidth: true,
  keepRowStyle: true,
  wrap: true
};

/** המרת אורך בפיקסלים שניתן כמספר חשוף. */
function asLength(v) {
  const t = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? t + 'px' : t;
}

const EMPTY_SEGS = { u: null, d: null, l: null, r: null };

/**
 * ממירה קוד {{עץ משפחה}} לקוד {{תרשים}}.
 * מחזירה { wiki, warnings, grid, stats }.
 */
export function convert(input, userOpts = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...userOpts };
  const warnings = [];
  const warn = (msg) => { if (!warnings.includes(msg)) warnings.push(msg); };

  const { rows: rawRows, wrappers } = extractRows(input || '');
  for (const w of wrappers) {
    if ((w.kind === 'התחלה' || w.kind === 'start') && w.inner.trim()) {
      const { named } = parseRow(w.inner);
      for (const k of Object.keys(named)) {
        warn(`הפרמטר "${k}" של {{עץ משפחה/התחלה}} חל על הטבלה כולה ואין לו מקבילה ישירה ב{{תרשים}}; יש להגדיר אותו ידנית.`);
      }
    }
  }
  if (!rawRows.length) {
    return { wiki: '', warnings: ['לא נמצאה אף קריאה לתבנית {{עץ משפחה}} בקלט.'], grid: [], stats: { rows: 0, boxes: 0, tiles: 0 } };
  }

  const grid = [];
  let nBoxes = 0, nTiles = 0;

  for (const inner of rawRows) {
    const { positional, named } = parseRow(inner);

    // --- פרמטרים ברמת השורה ---
    const rowStyle = opts.keepRowStyle ? (named['עיצוב'] || '') : '';
    const rowBorder = opts.keepRowStyle ? named['גבול'] : undefined;
    const c2 = named['צבע2'];
    const lineWidth = opts.keepLineWidth && named['עובי_קו'] ? asLength(named['עובי_קו']) : '';
    const dashStyle = named['סגנון_מקווקו'] || named['סגנון מקווקו'] || '';
    const tileOpts = { ...opts, lineWidth, cornerRadius: opts.cornerRadius };

    if (named['עיצוב'] && !opts.keepRowStyle) warn('הפרמטר "עיצוב" של שורה לא הועתק (האפשרות "העברת עיצוב שורה" כבויה).');
    if (named['עובי_קו'] && !opts.keepLineWidth) warn('הפרמטר "עובי_קו" לא הועתק (האפשרות "העברת עובי קו" כבויה).');

    // --- הגדרות התיבות ---
    const boxes = Object.create(null);
    const boxStyles = Object.create(null);
    const ROW_PARAMS = new Set(['גבול', 'עיצוב', 'צבע2', 'עובי_קו', 'סגנון_מקווקו', 'סגנון מקווקו']);
    for (const [k, v] of Object.entries(named)) {
      if (ROW_PARAMS.has(k)) continue;
      if (k.startsWith('עיצוב_')) boxStyles[k.slice('עיצוב_'.length).trim()] = v;
      else boxes[k] = v;
    }

    if (positional.length > 80) {
      warn(`בשורה אחת יש ${positional.length} מרצפות; התבנית {{עץ משפחה}} תומכת ב-80 לכל היותר, כך שהמקור כנראה שגוי.`);
    }

    const cells = [];
    for (const raw of positional) {
      const trimmed = raw.trim();

      // סיווג: מרצפת או תיבה
      let tileKey = null;
      if (Object.prototype.hasOwnProperty.call(FT_TILES, raw)) tileKey = raw;
      else if (Object.prototype.hasOwnProperty.call(boxes, trimmed)) tileKey = null;
      else if (Object.prototype.hasOwnProperty.call(FT_TILES, trimmed)) {
        tileKey = trimmed;
        if (trimmed !== raw) warn(`הערך "${raw}" עוטף מרצפת ברווחים; הוא תורגם כמרצפת "${trimmed}".`);
      }

      if (tileKey !== null) {
        // ----- מרצפת -----
        const def = FT_TILES[tileKey];
        if (def.approx) warn(def.approx);
        if (def.blank) {
          for (let i = 0; i < (def.width || 1); i++) cells.push({ type: 'blank', width: 1, wiki: '{{מרצפת}}', segs: EMPTY_SEGS });
          nTiles += def.width || 1;
          continue;
        }
        if (def.special) {
          const params = [def.special];
          if (lineWidth) params.push('עובי=' + lineWidth);
          cells.push({ type: 'tile', width: 1, wiki: '{{מרצפת|' + params.join('|') + '}}', segs: specialSegs(def.special), special: def.special });
          nTiles++;
          continue;
        }

        // קביעת הצבע והסגנון של כל קטע
        const target = { u: null, d: null, l: null, r: null };
        let usedC2 = false, hadDash = false;
        for (const d of DIRS) {
          const s = def.segs[d];
          if (!s) continue;
          let style = s.s, col = null;
          if (s.slot === 'צבע2') { usedC2 = true; col = c2 != null ? c2 : MZ_C2_DEFAULT; }
          if (style === 'dashed') {
            hadDash = true;
            if (opts.replaceDashes) { style = 'solid'; col = opts.newColor; }
            else if (dashStyle) style = dashStyle;
          }
          target[d] = { s: style, col };
        }
        if (usedC2 && c2 == null) warn(`המרצפת "${tileKey}" משתמשת בפרמטר "צבע2" שלא הוגדר בשורה; נעשה שימוש בצבע בררת המחדל.`);
        if (hadDash && dashStyle && opts.replaceDashes) {
          warn('הפרמטר "סגנון_מקווקו" נזנח משום שהקווים המקווקווים הוחלפו בקווים צבועים.');
        }
        cells.push({ type: 'tile', width: 1, wiki: tileWiki(target, tileOpts), segs: target });
        nTiles++;
      } else {
        // ----- תיבה -----
        const key = trimmed;
        const text = boxes[key] !== undefined ? boxes[key] : '';
        if (boxes[key] === undefined) warn(`לתיבה "${key}" אין טקסט מוגדר בשורה; נוצרה תיבה ריקה.`);
        const styleBits = [rowStyle, boxStyles[key]].filter((s) => s && s.trim());
        const params = ['טקסט=' + text];
        if (styleBits.length) params.push('עיצוב=' + styleBits.join('; ').replace(/;\s*;/g, ';'));
        if (opts.changeBoxColor) params.push('צבע רקע=' + opts.boxColor);
        if (opts.changeBoxBoundary) params.push('צבע מסגרת=' + opts.boundaryColor);
        if (rowBorder !== undefined) params.push('עובי מסגרת=' + asLength(rowBorder));
        cells.push({
          type: 'box',
          width: 3,
          wiki: 'colspan="3" | {{תרשים/תיבה|' + params.join('|') + '}}',
          text,
          style: styleBits.join('; ')
        });
        nBoxes++;
      }
    }
    grid.push(cells);
  }

  // --- יישור: כל השורות לאותו רוחב ---
  const widthOf = (row) => row.reduce((a, c) => a + c.width, 0);
  const maxW = Math.max(...grid.map(widthOf));
  for (const row of grid) {
    for (let w = widthOf(row); w < maxW; w++) {
      row.push({ type: 'blank', width: 1, wiki: '{{מרצפת}}', segs: EMPTY_SEGS });
    }
  }

  // --- בניית קוד הוויקי ---
  const lines = [];
  if (opts.wrap) lines.push('{{תרשים}}');
  lines.push('{| class="DiagramTable"');
  for (const row of grid) {
    lines.push('|-');
    for (const cell of row) lines.push('| ' + cell.wiki);
  }
  lines.push('|}');
  if (opts.wrap) lines.push('<noinclude>{{נוצר באמצעות תרשים}}</noinclude>');

  return {
    wiki: lines.join('\n'),
    warnings,
    grid,
    stats: { rows: grid.length, boxes: nBoxes, tiles: nTiles, columns: maxW }
  };
}

/** קטעים משוערים עבור המרצפות המיוחדות, לצורך התצוגה המקדימה בלבד. */
function specialSegs(name) {
  if (name === '+מעל') return { u: { s: 'solid', col: null, stub: true }, d: null, l: { s: 'solid', col: null }, r: { s: 'solid', col: null } };
  return { u: { s: 'solid', col: null }, d: { s: 'solid', col: null }, l: { s: 'solid', col: null, stub: true }, r: { s: 'solid', col: null, stub: true } };
}
