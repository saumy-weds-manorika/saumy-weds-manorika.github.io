import { test } from 'node:test';
import assert from 'node:assert/strict';
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
