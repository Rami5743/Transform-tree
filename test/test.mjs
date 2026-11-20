/*
 * בדיקות ל־convert.js. הרצה:  node test/test.mjs
 */
import { FT_TILES, MZ_TILES, DIRS, DIR_DIGIT, MZ_C2_DEFAULT } from '../assets/tiles.js';
import { convert, splitTopLevel, parseRow, tileWiki, extractRows } from '../assets/convert.js';
import { renderPreview } from '../assets/preview.js';

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

/* =============== 3ב. סוגריים צמודים בסוף שורה =============== */
{
  // "}}}}" בסוף שורה הוא שתי סגירות של "{{", לא סגירה של "{{{" ועוד סוגר
  const src = '{{עץ משפחה|א|א={{ללא גלישה|שם}}}}\n{{עץ משפחה|ב|ב=שני}}';
  eq(extractRows(src).rows.length, 2, 'שורה המסתיימת בתבנית מקוננת אינה בולעת את הבאה אחריה');
  const r = convert(src);
  ok(r.wiki.includes('טקסט={{ללא גלישה|שם}}'), 'תוכן התיבה נשמר', r.wiki);
  ok(r.wiki.includes('טקסט=שני'), 'השורה הבאה לא אבדה', r.wiki);
}
{
  // שלוש רמות של קינון
  const src = "{{עץ משפחה|א|א={{ללא גלישה|[[ד]] {{אנ|D}}}}}}\n{{עץ משפחה|ב|ב=שני}}";
  eq(extractRows(src).rows.length, 2, 'גם שלוש רמות של קינון נסגרות נכון');
}
eq(extractRows('{{עץ משפחה|א={{{פרמטר|ברירה}}}}}').rows.length, 1, 'הפניה לפרמטר עם שלושה סוגריים');

/* =============== 3ג. שורה חדשה בתוך טקסט תיבה =============== */
{
  const w = convert('{{עץ משפחה|א|א=שורה\nשנייה}}').wiki;
  ok(w.includes('טקסט=שורה שנייה'), 'שורה חדשה בטקסט תיבה מתאחדת לרווח', w);
  ok(!/טקסט=שורה\n/.test(w), 'ואינה שוברת את תא הטבלה', w);
}

/* =============== 3ד. עץ העטוף בתבנית =============== */
{
  const plain = '{{עץ משפחה/התחלה}}\n{{עץ משפחה|א|א=ט}}\n{{עץ משפחה/סוף}}';
  const wrapped = '{{כתב מוקטן|{{כתב מוקטן|' + plain + '}}}}\n{{מקרא|#aaf|הסבר}}';
  const r = convert(wrapped);
  eq(r.wiki, convert(plain + '\n{{מקרא|#aaf|הסבר}}').wiki, 'עטיפה בתבנית מוסרת והפלט זהה');
  ok(r.warnings.some((w) => w.includes('כתב מוקטן')), 'והעטיפה שהוסרה מדווחת');
  ok(!r.wiki.includes('כתב מוקטן'), 'ואינה נשארת בפלט', r.wiki);
}

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

/* =============== 11ב. מרצפת T של קו אחים =============== */
{
  // הפיצול ^ נמצא במקום מאוחר יותר במערך, כלומר משמאל על המסך → פינה 1
  const w = convert('{{עץ משפחה|.|-|ז|-|^|-|,}}', { round: true }).wiki;
  ok(w.includes('{{קטע|46}}{{ממלא מקום|גובה=2את|רוחב=2את}}{{פינה|1|עובי=2פק}}'),
    'מרצפת ז שהפיצול משמאלה מקבלת פינה 1', w);
  ok(!w.includes('זע'), 'המרצפת זע אינה מופיעה: היא שוברת את הקו המאוזן', w);
}
{
  // תמונת ראי: הפיצול מימין → פינה 3
  const w = convert('{{עץ משפחה|.|-|^|-|ז|-|,}}', { round: true }).wiki;
  ok(w.includes('{{פינה|3|עובי=2פק}}'), 'מרצפת ז שהפיצול מימינה מקבלת פינה 3', w);
}
{
  // פיצול משני הצדדים: שתי כניסות ויציאה אחת, והמיזוג כלפי מטה הוא הנכון
  const w = convert('{{עץ משפחה|^|-|ז|-|-|-|^}}', { round: true }).wiki;
  ok(w.includes('{{מרצפת|זע}}'), 'שתי כניסות ויציאה אחת ממוזגות כלפי מטה', w);
}
{
  // קו בין בני זוג: שני הקצוות מגיעים לתיבות ואין צד יחיד
  const r = convert('{{עץ משפחה|א|-|-|ז|-|-|ב|א=מינה|ב=הירשל}}', { round: true });
  ok(r.wiki.includes('{{מרצפת|ז}}'), 'קו בין בני זוג נשאר חד', r.wiki);
  ok(r.warnings.some((w) => w.includes('לא ניתן היה לקבוע')), 'ומדווחת אזהרה');
}
{
  const w = convert('{{עץ משפחה|.|-|ז|-|^|-|,}}', { round: false }).wiki;
  ok(w.includes('{{מרצפת|ז}}') && !w.includes('קטע'), 'בלי עיגול פינות — מרצפת ז רגילה', w);
}
{
  // תיבה חוסמת את הסריקה לאורך הקו
  const w = convert('{{עץ משפחה|.|-|ז|תיבה|^|-|,|תיבה=ט}}', { round: true }).wiki;
  ok(w.includes('{{מרצפת|ז}}'), 'תיבה חוסמת את המעבר אל הפיצול', w);
}
{
  // עובי קו וצבע עוברים גם למרצפת המורכבת
  const w = convert('{{עץ משפחה|.|-|ה|-|^|-|,|עובי_קו=3px}}', { round: true, replaceDashes: true, newColor: 'gray' }).wiki;
  ok(w.includes('{{קטע|46|עובי=3px|צבע=gray}}') && w.includes('{{פינה|1|עובי=3px|צבע=gray}}'),
    'עובי וצבע עוברים למרצפת המורכבת', w);
}

/* =============== 11ג. מרצפת שקו אנכי עובר דרכה =============== */
{
  // הקו מגיע מלמעלה → הענף המאוזן מתעגל כלפי מעלה
  const w = convert('{{עץ משפחה|!}}\n{{עץ משפחה|)|-|,}}', { round: true }).wiki;
  ok(w.includes('{{קטע|28}}{{ממלא מקום|גובה=2את|רוחב=2את}}{{פינה|7|עובי=2פק}}'),
    'מרצפת ) שהקו מגיע אליה מלמעלה מקבלת פינה 7', w);
  ok(!w.includes(')ע'), 'המרצפת )ע אינה מופיעה: היא שוברת את הקו האנכי', w);
}
eq(convert('{{עץ משפחה| | |!}}\n{{עץ משפחה|,|-|(}}', { round: true }).wiki.includes('{{פינה|9|עובי=2פק}}'),
  true, 'מרצפת ( מקבלת פינה 9');
{
  const w = convert('{{עץ משפחה| | |!}}\n{{עץ משפחה|.|-|+|-|,}}', { round: true }).wiki;
  ok(w.includes('{{קטע|28}}{{ממלא מקום|גובה=2את|רוחב=2את}}{{פינה|7|עובי=2פק}}{{פינה|9|עובי=2פק}}'),
    'מרצפת + מקבלת קו אנכי ישר ושתי פינות כלפי מעלה', w);
}
{
  // תיבה מעל נחשבת מקור, כמו מרצפת עם קו יורד
  const w = convert('{{עץ משפחה|א|א=ט}}\n{{עץ משפחה| |)|-|,}}', { round: true }).wiki;
  ok(w.includes('{{פינה|7|עובי=2פק}}'), 'תיבה מעל המרצפת נחשבת מקור הקו', w);
}
{
  // המקור מלמטה בלבד → הענף מתעגל כלפי מטה
  const w = convert('{{עץ משפחה|)|-|,}}\n{{עץ משפחה|!}}', { round: true }).wiki;
  ok(w.includes('{{פינה|1|עובי=2פק}}'), 'מקור מלמטה — פינה 1', w);
}
{
  // שתי כניסות — מלמעלה ומן הקו המאוזן — ויציאה אחת כלפי מטה:
  // הענף המאוזן מתעגל כלפי היציאה ולא כלפי המקור
  const w = convert("{{עץ משפחה| | |'|-|-|(}}", { round: true }).wiki;
  ok(w.includes('{{פינה|3'), 'ענף מאוזן שמגיע ממקור מתעגל כלפי היציאה', w);
  ok(!w.includes('{{פינה|9'), 'ואינו מתעגל כלפי המקור', w);
}
eq(convert('{{עץ משפחה|!}}\n{{עץ משפחה|)|-|,}}', { round: false }).wiki.includes('{{מרצפת|)}}'),
  true, 'בלי עיגול פינות — מרצפת ) רגילה');
{
  // קטעים בצבעים שונים אינם מעוגלים, כדי לא לאבד את ההבחנה ביניהם
  const w = convert('{{עץ משפחה|!}}\n{{עץ משפחה|]|-|,}}', { round: true, replaceDashes: false }).wiki;
  ok(!w.includes('פינה'), 'מרצפת בעלת קטעים שונים נשארת כמות שהיא', w);
}

/* =============== 11ד. טקסט שמחוץ לעץ =============== */
{
  const src = '{{מקרא|#fff|הסבר}}\n{{עץ משפחה/התחלה}}\n{{עץ משפחה|-}}\n{{עץ משפחה/סוף}}\n' +
    '{{מקרא|#000|עוד}}\n<noinclude>[[קטגוריה:בדיקה]]</noinclude>';
  const r = convert(src);
  ok(r.wiki.includes('{{מקרא|#fff|הסבר}}'), 'טקסט שלפני העץ נשמר', r.wiki);
  ok(r.wiki.includes('[[קטגוריה:בדיקה]]'), 'טקסט שאחרי העץ נשמר', r.wiki);
  ok(r.wiki.indexOf('{{מקרא|#fff|הסבר}}') < r.wiki.indexOf('{| class'), 'והוא נשאר במקומו היחסי');
  ok(r.wiki.indexOf('[[קטגוריה:בדיקה]]') > r.wiki.indexOf('|}'), 'וגם הטקסט שאחרי');
  const off = convert(src, { keepSurrounding: false });
  ok(!off.wiki.includes('קטגוריה:בדיקה'), 'אפשר לכבות את השמירה');
  ok(off.warnings.some((w) => w.includes('הושמט')), 'וכיבוי מדווח באזהרה');
}

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

/* =============== 16. התצוגה המקדימה =============== */
{
  const html = renderPreview(convert('{{עץ משפחה|א|א={{ללא גלישה|טמפרנס גורהם}}}}').wiki);
  ok(html.includes('טמפרנס גורהם'), 'תבנית עוטפת בטקסט התיבה נפרשת ואינה נמחקת', html.slice(0, 300));
}
{
  const html = renderPreview(convert("{{עץ משפחה|א|א=[[ג'ון]] {{אנ|John}}}}").wiki);
  ok(html.includes("ג'ון") && html.includes('pv-lang'), 'קישור בין־לשוני מסומן ואינו מוחק את הטקסט', html.slice(0, 300));
}
{
  const html = renderPreview(convert('{{עץ משפחה|א|-|ב|א=אחד|ב=שתיים}}').wiki);
  ok((html.match(/pv-boxcell/g) || []).length === 2, 'שתי תיבות בתצוגה');
  ok(html.includes('pv-p'), 'והמרצפת שביניהן מצוירת');
}
{
  const html = renderPreview(convert('{{עץ משפחה|א|א=שם{{ש}}<small>(הערה)</small>}}').wiki);
  ok(html.includes('<small>(הערה)</small>'), 'תגית עיצוב פנימית מוצגת ואינה מוברחת', html.slice(0, 300));
  ok(html.includes('<br>'), 'ותבנית ש הופכת לשבירת שורה');
}
{
  const html = renderPreview(convert('{{עץ משפחה|א|א=<script>x</script>}}').wiki);
  ok(!html.includes('<script>'), 'תגית שאינה ברשימה מוברחת', html.slice(0, 300));
}
{
  // תבנית שהטקסט הנראה שלה יושב בפרמטר שמי
  const html = renderPreview(convert('{{עץ משפחה|א|א=שם {{עיצוב גופן|גודל=1|צבע=ירוק|טקסט=הערה}}}}').wiki);
  ok(html.includes('הערה'), 'טקסט שבפרמטר שמי אינו נמחק', html.slice(0, 400));
  ok(html.includes('color:green'), 'ופרמטר הצבע מועבר לתצוגה', html.slice(0, 400));
}
{
  const r = convert('{{עץ משפחה/התחלה|עיצוב=border-collapse:collapse}}\n{{עץ משפחה|-}}\n{{עץ משפחה/סוף}}');
  ok(r.warnings.some((w) => w.includes('אינו נחוץ')), 'border-collapse מדווח כמיותר ולא כדורש הגדרה ידנית', r.warnings.join(' | '));
}
eq(renderPreview('').includes('אין מה להציג'), true, 'פלט ריק אינו מקריס את התצוגה');

console.log(`\n${pass} בדיקות עברו, ${fail} נכשלו.`);
process.exit(fail ? 1 : 0);
