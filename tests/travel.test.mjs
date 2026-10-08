import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRPORTS, JUNCTIONS, BHILWARA_STATION, HIGHWAYS, BUS_FACTS } from '../js/travel-data.js';

const ascending = (list) => list.every((x, i) => i === 0 || list[i - 1].km <= x.km);

test('travel data: the four airports Saumy named, nearest first', () => {
  assert.deepEqual(AIRPORTS.map((a) => a.code).sort(), ['AMD', 'JAI', 'KQH', 'UDR']);
  assert.ok(ascending(AIRPORTS));
  for (const a of AIRPORTS) assert.ok(/^[A-Z]{3}$/.test(a.code) && a.km > 0 && /h/.test(a.drive) && a.name && a.city);
});

test('travel data: the six junctions Saumy named, nearest first', () => {
  assert.deepEqual(JUNCTIONS.map((j) => j.name).sort(), ['Ajmer', 'Chittaurgarh', 'Jaipur', 'Kota', 'Ratlam', 'Udaipur City']);
  assert.ok(ascending(JUNCTIONS));
  for (const j of JUNCTIONS) assert.ok(/^[A-Z]{2,5}$/.test(j.code) && j.km > 0 && /h/.test(j.drive));
});

test('travel data: Bhilwara station and road/bus lines', () => {
  assert.deepEqual(BHILWARA_STATION, { code: 'BHL', name: 'Bhilwara' });
  assert.ok(HIGHWAYS.length >= 1 && BUS_FACTS.length >= 1);
  for (const s of [...HIGHWAYS, ...BUS_FACTS]) assert.ok(typeof s === 'string' && s.length <= 160);
});

// index.html carries a few static samples for ?preview=all (app.js replaces them for guests). They
// must never drift from travel-data.js, which is the only source of the numbers.
test('travel data: the ?preview=all samples in index.html match travel-data.js', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const byCode = new Map([...AIRPORTS, ...JUNCTIONS].map((h) => [h.code, h]));
  const chips = [...html.matchAll(/data-value="([A-Z]{2,5})"><span class="chip__label">([^<]+)<\/span>.*?<span class="hub-code">([A-Z]{2,5})<\/span> · (\d+) km/g)];
  assert.ok(chips.length >= 2, 'hub chip samples found');
  for (const [, value, name, code, km] of chips) {
    const hub = byCode.get(code);
    assert.ok(hub && value === code, `${code} is a real hub`);
    assert.equal(name, hub.name, `${code} name`);
    assert.equal(Number(km), hub.km, `${code} km`);
  }
  const rows = [...html.matchAll(/<span class="gt-row__name">([^<]+)<\/span> <span class="gt-row__code hub-code">\(([A-Z]{2,5})\)<\/span>.*?<span class="gt-row__km">(\d+) km<\/span><span class="gt-row__drive">([^<]+)<\/span>/g)];
  assert.ok(rows.length >= 2, 'panel row samples found');
  for (const [, name, code, km, drive] of rows) {
    const hub = byCode.get(code);
    assert.ok(hub, `${code} is a real hub`);
    assert.deepEqual([name, Number(km), drive], [hub.name, hub.km, hub.drive], `${code} row`);
  }
  const lede = /id="gt-rail-lede">([^<]+)</.exec(html);
  assert.equal(lede && lede[1], `${BHILWARA_STATION.name} (${BHILWARA_STATION.code}) has its own station. Big junctions nearby:`);
  const road = [...html.matchAll(/<li data-sample>([^<]+)<\/li>/g)].map((m) => m[1]);
  assert.ok(road.length >= 1, 'road samples found');
  for (const line of road) assert.ok([...HIGHWAYS, ...BUS_FACTS].includes(line), `road sample "${line}"`);
});
