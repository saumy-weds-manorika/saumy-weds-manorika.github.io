// Test helper (not a test file): a fake SpreadsheetApp, just enough to run apps-script-shaadi/Code.gs end
// to end: setup, doPost (Responses + People upsert), rebuildPeople and the Summary build. Formulas are
// stored as text, not calculated. Fictional data only.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const A1 = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/;
const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export class Sheet {
  constructor(name, maxCols = 26, maxRows = 1000) {
    this.name = name; this.maxCols = maxCols; this.maxRows = maxRows;
    this.cells = new Map(); // "r,c" -> value (formulas are stored as their text)
    this.frozen = 0;
  }
  key(r, c) { return `${r},${c}`; }
  get(r, c) { return this.cells.has(this.key(r, c)) ? this.cells.get(this.key(r, c)) : ''; }
  set(r, c, v) {
    if (c > this.maxCols) throw new Error(`${this.name}: column ${c} past max ${this.maxCols}`);
    if (r > this.maxRows) throw new Error(`${this.name}: row ${r} past max ${this.maxRows}`);
    if (v === '' || v === null || v === undefined) this.cells.delete(this.key(r, c));
    else this.cells.set(this.key(r, c), typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);
  }
  getName() { return this.name; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  setFrozenRows(n) { this.frozen = n; }
  getFrozenRows() { return this.frozen; }
  setColumnWidth() {}
  clear() { this.cells.clear(); }
  clearConditionalFormatRules() {}
  setConditionalFormatRules(rules) { this.rules = rules; }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.set(r, i + 1, v)); }
  deleteRows(start, n) {
    const next = new Map();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (r < start) next.set(k, v);
      else if (r >= start + n) next.set(`${r - n},${c}`, v);
    }
    this.cells = next;
    this.maxRows -= n;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') {
      const m = A1.exec(r);
      if (!m) throw new Error(`bad A1 ${r}`);
      const c1 = colNum(m[1]);
      const r1 = m[2] ? Number(m[2]) : 1;
      const c2 = m[3] ? colNum(m[3]) : c1;
      const r2 = m[4] ? Number(m[4]) : (m[3] ? this.maxRows : r1);
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    if (c + nc - 1 > this.maxCols) throw new Error(`${this.name}: range past max columns (${c}+${nc - 1} > ${this.maxCols})`);
    return new Range(this, r, c, nr, nc);
  }
  /** The sheet as rows of values, from row 1 to the last row (for assertions). */
  rows(cols = this.getLastColumn()) {
    const out = [];
    for (let r = 1; r <= this.getLastRow(); r++) out.push(Array.from({ length: cols }, (_, j) => this.get(r, j + 1)));
    return out;
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.get(this.r + i, this.c + j)));
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) {
      throw new Error(`setValues shape ${vals.length}x${vals[0] && vals[0].length} into ${this.nr}x${this.nc}`);
    }
    vals.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(f) { return this.setValues([[f]]); }
  setFontWeight() { return this; }
  setFontSize() { return this; }
  setFontColor() { return this; }
  setFontStyle() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
}

export class Spreadsheet {
  constructor(sheets = []) { this.sheets = sheets; this.toasts = []; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.getName() === n) || null; }
  getNumSheets() { return this.sheets.length; }
  insertSheet(name, index = this.sheets.length) { const sh = new Sheet(name); this.sheets.splice(index, 0, sh); return sh; }
  deleteSheet(sh) {
    if (this.sheets.length < 2) throw new Error('cannot delete the last sheet');
    this.sheets = this.sheets.filter((s) => s !== sh);
  }
  setActiveSheet(sh) { this.active = sh; return sh; }
  getId() { return 'fake-id'; }
  toast(msg) { this.toasts.push(msg); }
}

class RuleBuilder {
  whenTextEqualTo(t) { this.t = t; return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setRanges() { return this; }
  build() { return { text: this.t }; }
}

/** Loads apps-script-shaadi/Code.gs into a sandbox that uses `ss` as the active spreadsheet. */
export function load(ss, { lockBusy = false } = {}) {
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      flush() {},
      newConditionalFormatRule: () => new RuleBuilder(),
      getUi() { throw new Error('no ui in tests'); },
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() { if (lockBusy) throw new Error('busy'); },
        tryLock() { return !lockBusy; },
        releaseLock() {},
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return text; } }),
    },
    Logger: { log() {} },
  });
  vm.runInContext(readFileSync(new URL('../apps-script-shaadi/Code.gs', import.meta.url), 'utf8'), ctx, { filename: 'Code.gs' });
  return ctx;
}
