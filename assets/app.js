/*
 * app.js — חיבור הממשק למנוע ההמרה.
 */

import { convert, DEFAULT_OPTIONS } from './convert.js';
import { renderPreview } from './preview.js';
import { PRESETS, PLAIN } from './colors.js';

const $ = (id) => document.getElementById(id);
const CUSTOM = '__custom__';
const STORE_OPTS = 'transform-tree:options';
const STORE_INPUT = 'transform-tree:input';

/* ---------- הגדרת השדות ---------- */

const RADII = [['', 'בררת מחדל (10 פיקסלים)'], ['3px', '3 פיקסלים'], ['5px', '5 פיקסלים'],
  ['8px', '8 פיקסלים'], ['10px', '10 פיקסלים'], ['15px', '15 פיקסלים'], ['20px', '20 פיקסלים']];

const FIELDS = [
  { key: 'changeBoxColor', type: 'bool', label: 'שינוי צבע הרקע של התיבות',
    hint: 'אם לא — נשמר צבע בררת המחדל של תבנית תרשים' },
  { key: 'boxColor', type: 'color', label: 'צבע הרקע של התיבות', needs: 'changeBoxColor' },
  { key: 'changeBoxBoundary', type: 'bool', label: 'שינוי צבע המסגרת של התיבות',
    hint: 'אם לא — נשמר צבע בררת המחדל של תבנית תרשים' },
  { key: 'boundaryColor', type: 'color', label: 'צבע המסגרת של התיבות', needs: 'changeBoxBoundary' },
  { key: 'round', type: 'bool', label: 'עיגול פינות של קווים',
    hint: 'חל על כל מרצפת שיש לה גרסה מעוגלת' },
  { key: 'cornerRadius', type: 'choice', label: 'רדיוס העיגול', options: RADII, needs: 'round' },
  { key: 'replaceDashes', type: 'bool', label: 'החלפת קו מקוטע בקו צבוע' },
  { key: 'newColor', type: 'color', label: 'צבע הקו המחליף', needs: 'replaceDashes' },
  { key: 'keepLineWidth', type: 'bool', label: 'העתקת עובי הקו מהמקור',
    hint: 'הפרמטר עובי_קו של השורה' },
  { key: 'keepRowStyle', type: 'bool', label: 'העתקת עיצוב השורה',
    hint: 'הפרמטרים עיצוב וגבול של השורה' },
  { key: 'keepSurrounding', type: 'bool', label: 'שמירת טקסט שמחוץ לעץ',
    hint: 'מקרא, קטגוריות וכל טקסט שלפני העץ או אחריו' },
  { key: 'wrap', type: 'bool', label: 'עטיפת הפלט בתבנית תרשים',
    hint: 'הוספת {{תרשים}} בראש ו{{נוצר באמצעות תרשים}} בסוף' }
];

let options = { ...DEFAULT_OPTIONS };

/* ---------- בניית הטופס ---------- */

function colorSelect(id, value) {
  const sel = document.createElement('select');
  sel.id = id;
  const g1 = document.createElement('optgroup');
  g1.label = 'צבעים מוסכמים (תרשים/הגדרות)';
  for (const name of Object.keys(PRESETS)) {
    const o = document.createElement('option');
    o.value = `{{תרשים/הגדרות|${name}}}`;
    o.textContent = name;
    g1.appendChild(o);
  }
  const g2 = document.createElement('optgroup');
  g2.label = 'צבעים פשוטים';
  for (const name of Object.keys(PLAIN)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    g2.appendChild(o);
  }
  const other = document.createElement('option');
  other.value = CUSTOM;
  other.textContent = 'אחר…';
  sel.append(g1, g2, other);
  if ([...sel.options].some((o) => o.value === value)) sel.value = value;
  else sel.value = CUSTOM;
  return sel;
}

function buildForm() {
  const root = $('settings');
  root.textContent = '';
  for (const f of FIELDS) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.key = f.key;

    const label = document.createElement('label');
    label.htmlFor = 'f-' + f.key;
    label.textContent = f.label;
    wrap.appendChild(label);

    let input;
    if (f.type === 'bool') {
      input = document.createElement('select');
      for (const [v, t] of [['כן', 'כן'], ['לא', 'לא']]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        input.appendChild(o);
      }
      input.value = options[f.key] ? 'כן' : 'לא';
      input.addEventListener('change', () => { options[f.key] = input.value === 'כן'; onChange(); });
    } else if (f.type === 'choice') {
      input = document.createElement('select');
      for (const [v, t] of f.options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        input.appendChild(o);
      }
      input.value = options[f.key] || '';
      input.addEventListener('change', () => { options[f.key] = input.value; onChange(); });
    } else {
      input = colorSelect('f-' + f.key, options[f.key]);
      const free = document.createElement('input');
      free.type = 'text';
      free.dir = 'ltr';
      free.placeholder = 'קוד צבע או קוד ויקי';
      free.hidden = input.value !== CUSTOM;
      free.value = input.value === CUSTOM ? options[f.key] : '';
      const sync = () => {
        free.hidden = input.value !== CUSTOM;
        options[f.key] = input.value === CUSTOM ? free.value : input.value;
        onChange();
      };
      input.addEventListener('change', sync);
      free.addEventListener('input', sync);
      wrap.append(input, free);
      $('settings').appendChild(wrap);
      continue;
    }
    input.id = 'f-' + f.key;
    wrap.appendChild(input);
    if (f.hint) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = f.hint;
      wrap.appendChild(h);
    }
    root.appendChild(wrap);
  }
  refreshEnabled();
}

function refreshEnabled() {
  for (const f of FIELDS) {
    if (!f.needs) continue;
    const on = Boolean(options[f.needs]);
    const wrap = document.querySelector(`.field[data-key="${f.key}"]`);
    if (!wrap) continue;
    for (const el of wrap.querySelectorAll('select, input')) el.disabled = !on;
    wrap.style.opacity = on ? '1' : '0.55';
  }
}

/* ---------- ההמרה ---------- */

let timer = null;
function onChange() {
  refreshEnabled();
  save();
  clearTimeout(timer);
  timer = setTimeout(run, 120);
}

function run() {
  const text = $('input').value;
  let result;
  try {
    result = convert(text, options);
  } catch (err) {
    $('output').value = '';
    $('out-status').textContent = 'אירעה שגיאה בהמרה: ' + err.message;
    return;
  }

  $('output').value = result.wiki;
  const s = result.stats;
  $('in-status').textContent = text.trim()
    ? `נמצאו ${s.rows} שורות, ${s.boxes} תיבות ו-${s.tiles} מרצפות.`
    : '';
  $('out-status').textContent = result.wiki
    ? `הפלט: טבלה של ${s.rows} שורות על ${s.columns} עמודות, ${result.wiki.length} תווים.`
    : '';

  const list = $('warnings');
  list.textContent = '';
  for (const w of result.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    list.appendChild(li);
  }
  $('warn-panel').hidden = result.warnings.length === 0;

  $('preview').innerHTML = renderPreview(result.wiki);
  fitPreview();
}

/**
 * מכווץ את התצוגה כדי שתרשים רחב ייכנס לרוחב הפאנל. בלי זה הטבלה גולשת
 * שמאלה ורק חלקה נראה.
 */
let fitMode = true;
function fitPreview() {
  const wrap = $('preview');
  const table = wrap.querySelector('.pv-table');
  if (!table) return;
  table.style.transform = '';
  table.classList.remove('fit');
  wrap.style.height = '';
  if (!fitMode) return;
  const avail = wrap.clientWidth;
  const full = table.scrollWidth;
  if (avail > 0 && full > avail) {
    const k = avail / full;
    table.classList.add('fit');
    table.style.transform = `scale(${k})`;
    wrap.style.height = Math.ceil(table.offsetHeight * k) + 'px';
  }
}

/* ---------- שמירה מקומית ---------- */

function save() {
  try {
    localStorage.setItem(STORE_OPTS, JSON.stringify(options));
    localStorage.setItem(STORE_INPUT, $('input').value);
  } catch (e) { /* אחסון חסום — אין בכך כלום */ }
}

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_OPTS) || 'null');
    if (o && typeof o === 'object') options = { ...DEFAULT_OPTIONS, ...o };
    const t = localStorage.getItem(STORE_INPUT);
    if (t) $('input').value = t;
  } catch (e) { options = { ...DEFAULT_OPTIONS }; }
}

/* ---------- דוגמה ---------- */

const SAMPLE = `{{עץ משפחה/התחלה}}
{{עץ משפחה|סבתא|~|ד|~|סבא|סבתא=שרה ישראלי{{ש}}(1925–2001)|סבא=ישראל ישראלי{{ש}}(1920–1990)}}
{{עץ משפחה| | | | |!| | | | }}
{{עץ משפחה| |.|-|-|^|-|-|,| }}
{{עץ משפחה|בת|&|בן|בת=רות כהן|בן=דן ישראלי|עיצוב_בת=background-color: #ffe;}}
{{עץ משפחה/סוף}}`;

/* ---------- אתחול ---------- */

function flash(el, msg) {
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) run(); }, 2200);
}

function init() {
  load();
  buildForm();
  if (!$('input').value) $('input').value = SAMPLE;

  $('input').addEventListener('input', onChange);

  $('sample').addEventListener('click', () => { $('input').value = SAMPLE; onChange(); });
  $('clear').addEventListener('click', () => { $('input').value = ''; onChange(); $('input').focus(); });

  $('reset').addEventListener('click', () => {
    options = { ...DEFAULT_OPTIONS };
    buildForm();
    onChange();
  });

  $('copy').addEventListener('click', async () => {
    const text = $('output').value;
    if (!text) { $('out-status').textContent = 'אין מה להעתיק.'; return; }
    try {
      await navigator.clipboard.writeText(text);
      flash($('out-status'), 'הקוד הועתק.');
    } catch (e) {
      const ta = $('output');
      ta.removeAttribute('readonly');
      ta.select();
      const okd = document.execCommand && document.execCommand('copy');
      ta.setAttribute('readonly', '');
      flash($('out-status'), okd ? 'הקוד הועתק.' : 'ההעתקה נכשלה; סמנו והעתיקו ידנית.');
    }
  });

  $('download').addEventListener('click', () => {
    const text = $('output').value;
    if (!text) { $('out-status').textContent = 'אין מה להוריד.'; return; }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'תרשים.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('outdir').addEventListener('change', (e) => { $('output').dir = e.target.value; });

  $('fit').addEventListener('click', (e) => {
    fitMode = !fitMode;
    e.target.textContent = fitMode ? 'גודל מלא' : 'התאמה לרוחב';
    fitPreview();
  });

  window.addEventListener('resize', fitPreview);

  $('toggle-preview').addEventListener('click', (e) => {
    const box = $('preview');
    const open = box.hidden;
    box.hidden = !open;
    e.target.textContent = open ? 'הסתרה' : 'הצגה';
    e.target.setAttribute('aria-expanded', String(open));
  });

  run();
}

init();
