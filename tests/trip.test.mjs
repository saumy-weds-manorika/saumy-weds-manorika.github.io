import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, DESTINATIONS } from '../js/trip-data.js';

const REQUIRED = ['Udaipur', 'Jaipur', 'Pushkar', 'Mount Abu', 'Kumbhalgarh', 'Ranakpur', 'Chittaurgarh', 'Nathdwara'];
const inRajasthan = (p) => p.lat > 23 && p.lat < 30.5 && p.lon > 69 && p.lon < 78.5;

test('trip data: Bhilwara origin and exactly the eight requested destinations', () => {
  assert.equal(ORIGIN.name, 'Bhilwara');
  assert.ok(inRajasthan(ORIGIN));
  assert.deepEqual(DESTINATIONS.map((d) => d.name).sort(), [...REQUIRED].sort());
});

test('trip data: every destination has coordinates, road km, car time and a <=250-char note', () => {
  for (const d of DESTINATIONS) {
    assert.ok(/^[a-z-]+$/.test(d.id), `${d.name} id`);
    assert.ok(inRajasthan(d), `${d.name} coords`);
    assert.ok(Number.isInteger(d.km) && d.km > 20 && d.km < 500, `${d.name} km`);
    assert.ok(typeof d.drive === 'string' && /h|min/.test(d.drive), `${d.name} drive`);
    assert.ok(typeof d.note === 'string' && d.note.length >= 60 && d.note.length <= 250, `${d.name} note length ${d.note.length}`);
  }
});
