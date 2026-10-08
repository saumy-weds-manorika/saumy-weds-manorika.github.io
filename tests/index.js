// Lets `node --test tests/` keep working on Node 22+, where a directory argument is run as a
// module (and resolves here) instead of being searched for test files. It loads every
// tests/*.test.mjs file. The documented command is `node --test "tests/*.test.mjs"` (or a bare
// `node --test`), and neither of those picks this file up, so no test runs twice.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const name of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, name)).href);
}
