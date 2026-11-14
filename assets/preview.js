/*
 * preview.js — תצוגה מקדימה של התרשים בתוך הדפדפן.
 *
 * התצוגה נבנית ממודל הקטעים של convert.js, ולכן היא משקפת בדיוק את מה
 * שהכלי הבין מן הקלט. היא אינה מריצה תבניות ויקי, ולכן היא קירוב ולא
 * תחליף לתצוגה המקדימה של ויקיפדיה.
 */

import { toCss } from './colors.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** רינדור גס של קוד ויקי לטקסט תצוגה. */
function renderWikiText(text) {
  let t = String(text || '');
  t = t.replace(/\{\{\s*(?:ש|break|br)\s*\}\}/g, '\u0001BR\u0001');
  t = t.replace(/<br\s*\/?>/gi, '\u0001BR\u0001');
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = esc(t);
  t = t.replace(/'''(.*?)'''/g, '<b>$1</b>').replace(/''(.*?)''/g, '<i>$1</i>');
  return t.split('\u0001BR\u0001').join('<br>');
}

function segStyle(seg, dir) {
  const color = toCss(seg.col, 'var(--line)');
  const style = seg.s === 'solid' ? 'solid' : seg.s;
  const side = dir === 'u' || dir === 'd' ? 'left' : 'top';
  // חפיפה של חצי עובי הקו אל מעבר למרכז, כדי שהצמתים ייראו רציפים
  const len = seg.stub ? '28%' : 'calc(50% + 1px)';
  const size = dir === 'u' || dir === 'd' ? `height:${len}` : `width:${len}`;
  return `${size};border-${side}:2px ${style} ${color}`;
}

/** בונה את ה-HTML של התצוגה המקדימה מתוך ה-grid שמחזירה convert(). */
export function renderPreview(grid, opts = {}) {
  if (!grid.length) return '<p class="muted">אין מה להציג.</p>';
  const rows = grid.map((row) => {
    const cells = row.map((cell) => {
      if (cell.type === 'box') {
        const extra = [];
        if (opts.changeBoxColor) extra.push('background:' + toCss(opts.boxColor, '#fff'));
        if (opts.changeBoxBoundary) extra.push('border-color:' + toCss(opts.boundaryColor, '#000'));
        return `<td colspan="3" class="pv-boxcell"><div class="pv-box" style="${extra.join(';')}">${renderWikiText(cell.text)}</div></td>`;
      }
      const segs = cell.segs || {};
      const inner = ['u', 'd', 'l', 'r']
        .filter((d) => segs[d])
        .map((d) => `<i class="pv-seg pv-${d}" style="${segStyle(segs[d], d)}"></i>`)
        .join('');
      return `<td class="pv-tilecell">${inner}</td>`;
    });
    return '<tr>' + cells.join('') + '</tr>';
  });
  return '<table class="pv-table">' + rows.join('') + '</table>';
}
