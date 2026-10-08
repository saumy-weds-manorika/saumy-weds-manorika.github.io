import { test } from 'node:test';
import assert from 'node:assert/strict';

// Live mode (CONFIG.apiUrl is set and there is no ?mock=1), with fetch stubbed so nothing leaves this machine.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { search: '' };

const { findGuests, getGuest, isMock, warmUp } = await import('../js/api.js');

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test('runs in live mode for these tests', () => {
  assert.equal(isMock(), false);
});

test('an aborted request shows the friendly timeout message, never the raw browser text', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    // What Chrome throws when a fetch is aborted: a DOMException whose numeric `code` is 20.
    throw new DOMException('signal is aborted without reason', 'AbortError');
  };
  await assert.rejects(findGuests('rudraksh'), (err) => {
    assert.equal(err.code, 'timeout');
    assert.match(err.message, /taking too long/);
    assert.doesNotMatch(err.message, /signal is aborted/);
    return true;
  });
  assert.equal(calls, 2, 'one quiet retry before giving up');
});

test("a transient Google error page (404) is retried once and the search still succeeds", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 404, text: async () => '<html>Page not found</html>' };
    return json({ ok: true, matches: [{ id: 'k7m2', label: 'Rahul Sharma & Priya Sharma' }] });
  };
  assert.deepEqual(await findGuests('rahul'), [{ id: 'k7m2', label: 'Rahul Sharma & Priya Sharma' }]);
  assert.equal(calls, 2);
});

test('an "unknown guest" answer is not retried and getGuest returns null', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ ok: false, code: 'unknown_guest', error: 'unknown guest' }); };
  assert.equal(await getGuest('zzzz'), null);
  assert.equal(calls, 1);
});

test('warmUp pings in the background and never throws', async () => {
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); throw new TypeError('offline'); };
  assert.doesNotThrow(() => warmUp());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /action=ping/);
  warmUp(); // throttled: no second ping within a few minutes
  assert.equal(urls.length, 1);
});
