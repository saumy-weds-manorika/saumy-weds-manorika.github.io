// Test helper (not a test file): a fake SpreadsheetApp/Sheet/Range, just enough for ensureListHeaders_,
// fillIds_, fillLinks_ and readAllGuests_ in apps-script/Code.gs. Fictional data only.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const log = [];

class RichText {
  constructor(text, url) { this.text = text; this.url = url; }
  getText() { return this.text; }
  getLinkUrl() { return this.url; }
}
class RTBuilder {
  constructor() { this.text = undefined; this.url = null; }
  setText(t) { if (typeof t !== 'string') throw new Error('setText needs string'); this.text = t; return this; }
  setLinkUrl(a, b, c) {
    if (arguments.length === 1) {
      if (this.text === undefined) throw new Error('setLinkUrl before setText');
      if (this.text === '') throw new Error('setLinkUrl on empty text'); // mimic: can't link empty text
      this.url = a;
    } else this.url = c;
    return this;
  }
  build() { if (this.text === undefined) throw new Error('build without text'); return new RichText(this.text, this.url); }
}

export class Sheet {
  constructor(name, rows, maxCols = 26, maxRows = 1000) {
    this.name = name; this.maxCols = maxCols; this.maxRows = maxRows;
    this.cells = {}; // "r,c" -> {v, rt, note, wrap, bold}
    rows.forEach((row, i) => row.forEach((v, j) => { if (v !== '' && v !== undefined) this.cell(i + 1, j + 1).v = v; }));
    this.writes = [];
  }
  cell(r, c) { const k = r + ',' + c; return this.cells[k] || (this.cells[k] = { v: '' }); }
  peek(r, c) { return this.cells[r + ',' + c]; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  insertColumnsAfter(after, n) { this.maxCols += n; log.push(`insertColumnsAfter(${after},${n})`); }
  hasContent(c) { return c && ((c.v !== '' && c.v !== null && c.v !== undefined)); }
  getLastRow() { let m = 0; for (const k in this.cells) { if (this.hasContent(this.cells[k])) m = Math.max(m, +k.split(',')[0]); } return m; }
  getLastColumn() { let m = 0; for (const k in this.cells) { if (this.hasContent(this.cells[k])) m = Math.max(m, +k.split(',')[1]); } return m; }
  setFrozenRows() {}
  setRowHeightsForced(r, n, h) { this.rowHeights = { r, n, h }; }
  getColumnWidth() { return 100; }
  setColumnWidth() {}
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') throw new Error('A1 not supported in fake: ' + r);
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    if (c + nc - 1 > this.maxCols) throw new Error(`range past max columns: ${c}+${nc} > ${this.maxCols}`);
    if (r + nr - 1 > this.maxRows) throw new Error(`range past max rows`);
    return new Range(this, r, c, nr, nc);
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sh.cell(this.r + i, this.c + j), i, j); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const c = this.sh.peek(this.r + i, this.c + j); row.push(c ? c.v : ''); } out.push(row); }
    return out;
  }
  check(vals) {
    if (!Array.isArray(vals) || vals.length !== this.nr) throw new Error(`rows mismatch: data ${vals && vals.length} range ${this.nr}`);
    vals.forEach((row) => { if (!Array.isArray(row) || row.length !== this.nc) throw new Error(`cols mismatch: data ${row && row.length} range ${this.nc}`); });
  }
  setValues(vals) {
    this.check(vals);
    this.sh.writes.push({ op: 'setValues', r: this.r, c: this.c, nr: this.nr, nc: this.nc });
    this.each((cell, i, j) => { let v = vals[i][j]; if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); cell.v = v; delete cell.rt; });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setRichTextValues(vals) {
    this.check(vals);
    vals.forEach((row) => row.forEach((x) => { if (!(x instanceof RichText)) throw new Error('not a RichTextValue'); }));
    this.sh.writes.push({ op: 'setRichTextValues', r: this.r, c: this.c, nr: this.nr, nc: this.nc });
    this.each((cell, i, j) => { cell.v = vals[i][j].text; cell.rt = vals[i][j]; });
    return this;
  }
  setFontWeight() { return this; }
  setNote(n) { this.each((cell) => { cell.note = n; }); return this; }
  setWrap(w) { this.each((cell) => { cell.wrap = w; }); return this; }
  setWrapStrategy(s) { this.each((cell) => { cell.wrapStrategy = s; }); return this; }
}

export class Spreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find((s) => s.getName() === n) || null; }
  toast() {}
}

export function load(ss) {
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: {
      newRichTextValue: () => new RTBuilder(),
      getActiveSpreadsheet: () => ss,
      flush() {},
      WrapStrategy: { CLIP: 'CLIP', WRAP: 'WRAP', OVERFLOW: 'OVERFLOW' },
      getUi() { throw new Error('no ui'); },
    },
    Logger: { log: (m) => log.push('LOG ' + m) },
    CacheService: { getScriptCache: () => ({ remove() {}, get() { return null; }, putAll() {}, getAll() { return {}; } }) },
  });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx, { filename: 'Code.gs' });
  return ctx;
}

export function dump(sh, maxC = 14) {
  const lr = sh.getLastRow();
  for (let r = 1; r <= lr; r++) {
    const row = [];
    for (let c = 1; c <= maxC; c++) {
      const cell = sh.peek(r, c);
      let s = cell ? String(cell.v) : '';
      if (cell && cell.rt && cell.rt.url) s = `[${s}](${cell.rt.url.slice(0, 40)}...)`;
      s = s.replace(/\n/g, '⏎');
      row.push(s.length > 28 ? s.slice(0, 28) + '…' : s);
    }
    console.log(r, row.join(' | '));
  }
}
