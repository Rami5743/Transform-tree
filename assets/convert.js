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

/**
 * מאתר את ה-}} הסוגר של תבנית שמתחילה ב-start (האינדקס של "{{").
 *
 * הסגירה נבדקת מול מה שנפתח, ולא לפי מספר הסוגריים הרצופים. רצף כמו
 * "}}}}" בסוף "{{א|{{ב|ג}}}}" הוא שתי סגירות של "{{", ולא סגירה של
 * "{{{" ועוד סוגר בודד; ספירה תמימה שלו מחליקה מעבר לסוף התבנית ובולעת
 * את מה שבא אחריה.
 */
function matchTemplateEnd(text, start) {
  const stack = [];
  let i = start;
  while (i < text.length) {
    if (text.startsWith('{{{', i)) { stack.push(3); i += 3; continue; }
    if (text.startsWith('{{', i)) { stack.push(2); i += 2; continue; }
    if (stack.length) {
      if (stack[stack.length - 1] === 3 && text.startsWith('}}}', i)) {
        stack.pop(); i += 3;
        if (!stack.length) return i;
        continue;
      }
      if (text.startsWith('}}', i)) {
        stack.pop(); i += 2;
        if (!stack.length) return i;
        continue;
      }
    }
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
  let first = Infinity, last = 0;

  for (const m of [...text.matchAll(RE_START)]) {
    const end = matchTemplateEnd(text, m.index);
    if (end === -1) continue;
    const inner = text.slice(m.index + m[0].length, end - 2);
    wrappers.push({ kind: m[1], inner: inner.replace(/^\|/, '') });
    taken.push([m.index, end]);
    first = Math.min(first, m.index);
    last = Math.max(last, end);
  }

  // קריאה לתבנית בתוך פרמטר של שורה אחרת אינה שורה בפני עצמה
  let consumedTo = 0;
  for (const m of [...text.matchAll(RE_ROW)]) {
    if (m.index < consumedTo) continue;
    if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const end = matchTemplateEnd(text, m.index);
    if (end === -1) continue;
    consumedTo = end;
    let inner = text.slice(m.index + m[0].length, end - 2);
    inner = inner.replace(/^\|/, '');
    rows.push(inner);
    first = Math.min(first, m.index);
    last = Math.max(last, end);
  }
  // הטקסט שעוטף את העץ — מקרא, קטגוריות, תיעוד — נשמר כדי שלא יאבד בהמרה
  const before = rows.length ? text.slice(0, first) : '';
  const after = rows.length ? text.slice(last) : '';
  return { rows, wrappers, before, after };
}

/**
 * מאתר תבניות שנפתחו לפני העץ ולא נסגרו עד אחריו, ומסיר אותן.
 *
 * טבלת {{תרשים}} נכתבת בתחביר טבלה של ויקי, ותחביר כזה אינו יכול לשבת
 * בתוך פרמטר של תבנית. עץ העטוף בתבנית כמו {{כתב מוקטן}} היה מפיק פלט
 * שבור, ולכן העטיפה מוסרת ומדווחת.
 */
export function unwrap(before, after) {
  const stack = [];
  let i = 0;
  while (i < before.length) {
    if (before.startsWith('{{{', i)) { stack.push({ d: 3, i }); i += 3; continue; }
    if (before.startsWith('{{', i)) { stack.push({ d: 2, i }); i += 2; continue; }
    if (stack.length) {
      if (stack[stack.length - 1].d === 3 && before.startsWith('}}}', i)) { stack.pop(); i += 3; continue; }
      if (before.startsWith('}}', i)) { stack.pop(); i += 2; continue; }
    }
    i++;
  }
  if (!stack.length) return { before, after, wrappers: [] };

  const names = stack.map((t) => {
    const m = /^\{\{+\s*([^|{}\n]{1,60})/.exec(before.slice(t.i));
    return m ? m[1].trim() : '';
  });
  let rest = after;
  for (let k = stack.length - 1; k >= 0; k--) {
    const m = new RegExp('^\\s*' + (stack[k].d === 3 ? '\\}\\}\\}' : '\\}\\}')).exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return { before: before.slice(0, stack[0].i), after: rest, wrappers: names.filter(Boolean) };
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

/** בונה קריאה ל{{קטע}} עם סגנון, עובי וצבע לפי הקטע המבוקש. */
function segCall(dir, seg, opts) {
  const parts = ['קטע', dir];
  if (seg.s !== 'solid') parts.push('סגנון=' + styleName(seg.s));
  if (opts.lineWidth) parts.push('עובי=' + opts.lineWidth);
  if (seg.col != null) parts.push('צבע=' + seg.col);
  return '{{' + parts.join('|') + '}}';
}

/** בונה קריאה ל{{פינה}}. */
function cornerCall(n, seg, opts) {
  const parts = ['פינה', n];
  if (seg.s !== 'solid') parts.push('סגנון=' + styleName(seg.s));
  parts.push('עובי=' + (opts.lineWidth || '2פק'));
  if (seg.col != null) parts.push('צבע=' + seg.col);
  if (opts.cornerRadius) parts.push('עיגול=' + opts.cornerRadius);
  return '{{' + parts.join('|') + '}}';
}

const SPACER = '{{ממלא מקום|גובה=2את|רוחב=2את}}';

/** האם כל קטעי המרצפת זהים בסגנונם ובצבעם. */
function uniform(t) {
  const segs = DIRS.map((d) => t[d]).filter(Boolean);
  return segs.every((x) => x.s === segs[0].s && x.col === segs[0].col);
}

/**
 * מרצפת מתפצלת: הקו העובר נשאר ישר, וכל ענף מתעגל אל עבר הקטע היחיד
 * שבצדו השני של הפיצול.
 *
 * המרצפות המעוגלות המוכנות אינן מתאימות לכל מקרה, משום שהן תמיד ממזגות
 * את כל הקטעים מצד אחד אל כל הקטעים מהצד האחר. כשיש יותר מקטע אחד בכל
 * אחד משני הצדדים, המיזוג שובר את הקו העובר.
 */
function composedJunction(target, one, opts) {
  const V = ['u', 'd'].filter((d) => target[d]);
  const H = ['l', 'r'].filter((d) => target[d]);
  const vertical = one === 'u' || one === 'd';
  const out = [];
  if (vertical && V.length === 2) out.push(segCall('28', target.u, opts));
  if (!vertical && H.length === 2) out.push(segCall('46', target.l, opts));
  out.push(SPACER);
  for (const d of vertical ? H : V) {
    out.push(cornerCall(CORNER_OF[vertical ? one + d : d + one], target[d], opts));
  }
  return out.join('');
}

const CORNER_OF = { dl: '1', dr: '3', ul: '7', ur: '9' };

/** מספר הקטעים היוצאים מן המרצפת. */
const armCount = (t) => DIRS.filter((d) => t[d]).length;

/** מרצפת שיוצאים ממנה שלושה קטעים או יותר, כולם באותו סגנון ובאותו צבע. */
function isJunction(t) {
  return armCount(t) >= 3 && uniform(t);
}

/**
 * האם הקו המאוזן היוצא מן המרצפת בכיוון הנתון מגיע אל מרצפת שיוצא ממנה
 * קטע כלפי מעלה — כלומר אל מקור של הקו.
 *
 * הסריקה עוברת לאורך הקו בלבד ונעצרת בכל נתק ובכל תיבה. שימו לב:
 * במערך התאים האינדקס גדל שמאלה, משום שהטבלה היא מימין לשמאל.
 */
function horizontalLeadsUp(cells, i, dir) {
  const step = dir === 'l' ? 1 : -1;
  const back = dir === 'l' ? 'r' : 'l';
  const segsOf = (c) => (c && c.segs ? c.segs : null);
  let j = i;
  for (;;) {
    const here = segsOf(cells[j]), next = segsOf(cells[j + step]);
    if (!here || !next || !here[dir] || !next[back]) return false;
    j += step;
    if (next.u) return true;
    if (!next[dir]) return false;
  }
}

/**
 * הקטע היחיד שבצדו האחד של הפיצול, שאליו מתעגלים כל האחרים — או null
 * כשאין צד כזה.
 *
 * בעץ משפחה הקו האנכי זורם מלמעלה למטה, ולכן קטע כלפי מעלה הוא כניסה
 * וקטע כלפי מטה הוא יציאה. יוצא מן הכלל: אם אין כלום מעל המרצפת ויש
 * חיבור מתחתיה, הכיוון מתהפך. קטע מאוזן נבדק בסריקה לאורכו.
 */
function junctionPivot(cells, i, above, below) {
  const t = cells[i].segs;
  const ins = [], outs = [];
  if (t.u && t.d) {
    const flipped = !above && below;
    ins.push(flipped ? 'd' : 'u');
    outs.push(flipped ? 'u' : 'd');
  } else if (t.u) ins.push('u');
  else if (t.d) outs.push('d');
  for (const h of ['l', 'r']) {
    if (t[h]) (horizontalLeadsUp(cells, i, h) ? ins : outs).push(h);
  }
  if (ins.length === 1) return ins[0];
  if (outs.length === 1) return outs[0];
  return null;
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
  keepSurrounding: true,
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

  const { rows: rawRows, wrappers, before: rawBefore, after: rawAfter } = extractRows(input || '');
  const { before, after, wrappers: outerTemplates } = unwrap(rawBefore, rawAfter);
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
        // מרצפות שצורתן המעוגלת תלויה בהקשר מקבלות כאן צורה לא מעוגלת,
        // והן מוכרעות שוב לאחר שכל הטבלה נבנתה
        const junction = opts.round && isJunction(target);
        cells.push({
          type: 'tile', width: 1, segs: target, junction,
          tileOpts: junction ? tileOpts : undefined,
          wiki: tileWiki(target, junction ? { ...tileOpts, round: false } : tileOpts)
        });
        nTiles++;
      } else {
        // ----- תיבה -----
        const key = trimmed;
        // שורה חדשה בתוך ערך של פרמטר מוצגת ברווח בלבד, אך בתוך תא של
        // טבלת ויקי היא עלולה לשבור את התא. איחודה לרווח אינו משנה דבר
        // בתצוגה ומייצב את הפלט.
        const text = (boxes[key] !== undefined ? boxes[key] : '').replace(/\s*\n\s*/g, ' ');
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

  // --- הכרעת המרצפות המעוגלות התלויות בהקשר ---
  // מפת עמודות: לכל שורה, איזה תא מכסה כל עמודה (תיבה מכסה שלוש)
  const byColumn = grid.map((row) => {
    const map = [];
    for (const cell of row) for (let k = 0; k < cell.width; k++) map.push(cell);
    return map;
  });
  /** האם התא מזין קו בכיוון הנתון — תיבה מזינה תמיד. */
  const feeds = (cell, dir) => Boolean(cell && (cell.type === 'box' || (cell.segs && cell.segs[dir])));

  for (let r = 0; r < grid.length; r++) {
    let col = 0;
    for (let i = 0; i < grid[r].length; i++) {
      const cell = grid[r][i];
      if (!cell.junction) { col += cell.width; continue; }
      const one = junctionPivot(
        grid[r], i,
        feeds(r > 0 ? byColumn[r - 1][col] : null, 'd'),
        feeds(r < grid.length - 1 ? byColumn[r + 1][col] : null, 'u')
      );
      if (!one) {
        warn('מרצפת מתפצלת נותרה ללא עיגול פינות, משום שלא ניתן היה לקבוע לאיזה צד להטות את הפינה בלי לשבור את הקו העובר.');
      } else {
        const V = ['u', 'd'].filter((d) => cell.segs[d]).length;
        const H = ['l', 'r'].filter((d) => cell.segs[d]).length;
        const vertical = one === 'u' || one === 'd';
        // כשיש קטע אחד בלבד בצדו של הציר, המרצפת המעוגלת המוכנה מדויקת
        cell.wiki = (vertical ? V : H) === 1
          ? tileWiki(cell.segs, { ...cell.tileOpts, round: true })
          : composedJunction(cell.segs, one, cell.tileOpts);
        cell.corner = one;
      }
      col += cell.width;
    }
  }

  // --- בניית קוד הוויקי ---
  const lines = [];
  if (opts.wrap) lines.push('{{תרשים}}');
  for (const name of outerTemplates) {
    warn(`העץ היה עטוף בתבנית "${name}". טבלת תרשים אינה יכולה לשבת בתוך פרמטר של תבנית, ולכן העטיפה הושמטה מהפלט.`);
  }
  const lead = (before || '').trim();
  const tail = (after || '').trim();
  if (opts.keepSurrounding && lead) lines.push(lead);
  lines.push('{| class="DiagramTable"');
  for (const row of grid) {
    lines.push('|-');
    for (const cell of row) lines.push('| ' + cell.wiki);
  }
  lines.push('|}');
  if (opts.wrap) lines.push('<noinclude>{{נוצר באמצעות תרשים}}</noinclude>');
  if (opts.keepSurrounding && tail) lines.push(tail);
  if (opts.keepSurrounding && (lead || tail)) {
    warn('טקסט שנמצא מחוץ לעץ — מקרא, קטגוריות וכיוצא בהם — הועתק לפלט כמות שהוא.');
  } else if (!opts.keepSurrounding && (lead || tail)) {
    warn('טקסט שנמצא מחוץ לעץ הושמט מהפלט (האפשרות "שמירת טקסט שמחוץ לעץ" כבויה).');
  }

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
