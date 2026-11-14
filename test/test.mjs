/*
 * בדיקות ל־convert.js. הרצה:  node test/test.mjs
 */
import { FT_TILES, MZ_TILES, DIRS, DIR_DIGIT, MZ_C2_DEFAULT } from '../assets/tiles.js';
import { convert, splitTopLevel, parseRow, tileWiki, extractRows } from '../assets/convert.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; } else { fail++; console.error('✗ ' + name + (extra ? '\n    ' + extra : '')); }
};
const eq = (a, b, name) => ok(a === b, name, `got:      ${JSON.stringify(a)}\n    expected: ${JSON.stringify(b)}`);

/* ---------- מפענח הפוך: מקוד {{מרצפת}} בחזרה לקטעים ---------- */
const STYLE_BACK = { 'רצוף': 'solid', 'מוצק': 'solid', 'solid': 'solid', 'מקווקו': 'dashed', 'מקוטע': 'dashed', 'dashed': 'dashed' };
function parseTile(wiki) {
  const m = /^\{\{מרצפת(?:\|([\s\S]*))?\}\}$/.exec(wiki);
  if (!m) throw new Error('קוד מרצפת לא תקין: ' + wiki);
  const parts = m[1] === undefined ? [] : splitTopLevel(m[1], '|');
  const name = parts.length ? parts[0] : '';
  const p = {};
  for (const s of parts.slice(1)) {
    const i = s.indexOf('=');
    p[s.slice(0, i)] = s.slice(i + 1);
  }
  const segs = { u: null, d: null, l: null, r: null };
  if (name === '' || name === 'ריקה') return segs;
  if (name === 'אוניברסלית') {
    for (const d of DIRS) {
      const n = DIR_DIGIT[d];
      if (!p['עובי' + n] || p['עובי' + n] === '0px') continue;
      segs[d] = { s: STYLE_BACK[p['סגנון' + n]] || 'solid', col: p['צבע' + n] !== undefined ? p['צבע' + n] : null };
    }
    return segs;
  }
  const base = name.replace(/ע$/, '');
  const def = MZ_TILES.find((t) => t.name === name || t.round === name || t.name === base);
  if (!def) throw new Error('מרצפת לא מוכרת: ' + name);
  for (const d of DIRS) {
    const s = def.segs[d];
    if (!s) continue;
    const slot = s.slot;
    let col;
    if (slot === 'צבע2') col = p['צבע2'] !== undefined ? p['צבע2'] : MZ_C2_DEFAULT;
    else col = p['צבע'] !== undefined ? p['צבע'] : null;
    if (col === 'black') col = null;
    segs[d] = { s: p['סגנון'] ? (STYLE_BACK[p['סגנון']] || p['סגנון']) : s.s, col };
  }
  return segs;
}
const segKey = (segs) => DIRS.map((d) => (segs[d] ? `${d}:${segs[d].s}:${segs[d].col === null || segs[d].col === undefined ? '-' : segs[d].col}` : '')).filter(Boolean).join(' ');

/* =============== 1. פיצול ברמה העליונה =============== */
eq(splitTopLevel('a|b|c').join('/'), 'a/b/c', 'פיצול פשוט');
eq(splitTopLevel('a|{{ת|x}}|c').length, 3, 'פיצול מתעלם מתבנית מקוננת');
eq(splitTopLevel('a|[[ד|כ]]|c').length, 3, 'פיצול מתעלם מקישור מקונן');
eq(splitTopLevel('a|<ref name="x|y">ז</ref>|c').length, 3, 'פיצול מתעלם מתגית HTML');
eq(splitTopLevel('a|<nowiki>|||</nowiki>|c').length, 3, 'פיצול מתעלם מ-nowiki');
eq(splitTopLevel('a|<!-- | -->|c').length, 3, 'פיצול מתעלם מהערת HTML');
eq(splitTopLevel('a|{{{פ|ב}}}|c').length, 3, 'פיצול מתעלם מהפניה לפרמטר');

/* =============== 2. פירוק שורה =============== */
{
  const { positional, named } = parseRow("א|-|ב|א=טקסט עם = בתוכו|ב=[[ד|כ]]");
  eq(positional.join('/'), 'א/-/ב', 'פרמטרים ממוספרים');
  eq(named['א'], 'טקסט עם = בתוכו', 'ערך שמי המכיל סימן שווה');
  eq(named['ב'], '[[ד|כ]]', 'ערך שמי המכיל קישור');
}

/* =============== 3. איתור שורות =============== */
eq(extractRows('{{עץ משפחה/התחלה}}{{עץ משפחה|א}}{{עץ משפחה/סוף}}').rows.length, 1, 'התחלה וסוף אינן שורות');
eq(extractRows('{{עץ_משפחה|א}}').rows.length, 1, 'שם התבנית עם קו תחתון');
eq(extractRows('{{ עץ משפחה |א}}').rows.length, 1, 'שם התבנית עם רווחים');
eq(extractRows('{{עץ משפחה|א={{עץ משפחה|ב}}}}').rows.length, 1, 'תבנית מקוננת אינה נספרת פעמיים');

/* =============== 4. כל מרצפת מתורגמת נכון =============== */
for (const [ch, def] of Object.entries(FT_TILES)) {
  if (def.blank || def.special) continue;
  const target = {};
  for (const d of DIRS) {
    const s = def.segs[d];
    target[d] = s ? { s: s.s, col: s.slot === 'צבע2' ? 'red' : null } : null;
  }
  const wiki = tileWiki(target, { round: false, replaceDashes: false });
  let back;
  try { back = parseTile(wiki); } catch (e) { ok(false, `מרצפת "${ch}" — ${e.message}`); continue; }
  ok(segKey(back) === segKey(target), `מרצפת "${ch}" משמרת את הגאומטריה`,
    `${wiki}\n    got:      ${segKey(back)}\n    expected: ${segKey(target)}`);
  ok(!/\{\{מרצפת\|[^|]*\}[^|}]/.test(wiki) && (wiki.match(/\{\{/g) || []).length === (wiki.match(/\}\}/g) || []).length,
    `מרצפת "${ch}" מפיקה קוד ויקי מאוזן`, wiki);
}

/* =============== 5. הסוגריים — הבאג שמייצר קוד שבור =============== */
for (const ch of ['}', '{', ']', '[']) {
  const out = convert(`{{עץ משפחה|${ch}}}`, { replaceDashes: false }).wiki;
  ok(!/\|\}\}\}/.test(out) && !/\|\{\}\}/.test(out), `המרצפת "${ch}" אינה מייצרת קוד ויקי שבור`, out);
}

/* =============== 6. יישור עמודות =============== */
{
  const r = convert('{{עץ משפחה|א|א=טקסט}}\n{{עץ משפחה|-|-|-|-}}');
  eq(r.stats.columns, 4, 'רוחב הטבלה = המרבי שבין השורות');
  for (const row of r.grid) eq(row.reduce((a, c) => a + c.width, 0), 4, 'כל השורות באותו רוחב');
  eq(r.grid[0].length, 2, 'תיבה תופסת שלוש עמודות ולכן נוסף תא ריק אחד');
}

/* =============== 7. & — רווח ברוחב תיבה =============== */
eq(convert('{{עץ משפחה|&}}').stats.columns, 3, 'המרצפת & ברוחב שלוש מרצפות');

/* =============== 8. אסימון שאינו מרצפת הוא תיבה =============== */
{
  const r = convert('{{עץ משפחה|שם כלשהו}}');
  ok(r.wiki.includes('תרשים/תיבה'), 'אסימון לא מוכר מתורגם לתיבה ולא למרצפת');
  ok(r.warnings.some((w) => w.includes('אין טקסט מוגדר')), 'אזהרה על תיבה בלי טקסט');
}

/* =============== 9. שם תיבה עטוף ברווחים =============== */
ok(convert('{{עץ משפחה| אבא |אבא=יוסי}}').wiki.includes('טקסט=יוסי'), 'שם תיבה עם רווחים מזוהה');

/* =============== 10. פרמטרים ברמת השורה =============== */
{
  const w = convert('{{עץ משפחה|גבול=0|עיצוב=background:#dfd|א|א=ט|עיצוב_א=border-radius:8px}}').wiki;
  ok(w.includes('עיצוב=background:#dfd; border-radius:8px'), 'עיצוב השורה ועיצוב התיבה מחוברים', w);
  ok(w.includes('עובי מסגרת=0px'), 'הפרמטר גבול מתורגם לעובי מסגרת', w);
}
eq(convert('{{עץ משפחה|-|עובי_קו=3px}}').wiki.includes('עובי=3px'), true, 'הפרמטר עובי_קו מתורגם');
eq(convert('{{עץ משפחה|-2|צבע2=blue}}').wiki.includes('צבע=blue'), true, 'הפרמטר צבע2 מתורגם');
eq(convert('{{עץ משפחה|+ש2|צבע2=red}}').wiki.includes('{{מרצפת|*1|צבע2=red}}'), true, 'המרצפת +ש2 מתורגמת ל-*1');
eq(convert('{{עץ משפחה|+2ש|צבע2=red}}').wiki.includes('{{מרצפת|#1|צבע2=red}}'), true, 'המרצפת +2ש מתורגמת ל-#1');

/* =============== 11. עיגול פינות =============== */
eq(convert('{{עץ משפחה|.}}', { round: true }).wiki.includes('{{מרצפת|.ע}}'), true, 'עיגול פינה פשוטה');
eq(convert('{{עץ משפחה|^}}', { round: true }).wiki.includes('{{מרצפת|^ע}}'), true, 'עיגול מרצפת ^ (שהסקריפט המקורי פספס)');
eq(convert('{{עץ משפחה|!}}', { round: true }).wiki.includes('{{מרצפת|!}}'), true, 'קו ישר אינו מעוגל');

/* =============== 12. החלפת קו מקוטע =============== */
eq(convert('{{עץ משפחה|~}}', { replaceDashes: true, newColor: 'gray' }).wiki.includes('{{מרצפת|-|צבע=gray}}'), true, 'קו מקוטע מוחלף בקו צבוע');
eq(convert('{{עץ משפחה|~}}', { replaceDashes: false }).wiki.includes('{{מרצפת|~}}'), true, 'בלי החלפה — המרצפת נשמרת');

/* =============== 13. טקסט תיבה מורכב =============== */
{
  const w = convert("{{עץ משפחה|א|א=ג'וק {{ש}}([[ד (שחקן)|ד]])}}").wiki;
  ok(w.includes("טקסט=ג'וק {{ש}}([[ד (שחקן)|ד]])"), 'טקסט תיבה עם תבנית וקישור נשמר כמות שהוא', w);
}

/* =============== 14. קלט ריק =============== */
ok(convert('').warnings.length === 1 && convert('').wiki === '', 'קלט ריק מחזיר אזהרה ולא קורס');

/* =============== 15. אפשרויות התיבה =============== */
{
  const w = convert('{{עץ משפחה|א|א=ט}}', { changeBoxColor: true, boxColor: 'לבן', changeBoxBoundary: true, boundaryColor: 'blue' }).wiki;
  ok(w.includes('צבע רקע=לבן') && w.includes('צבע מסגרת=blue'), 'אפשרויות צבע התיבה', w);
}

console.log(`\n${pass} בדיקות עברו, ${fail} נכשלו.`);
process.exit(fail ? 1 : 0);
