// ponytail: run with `npx tsx lib/jira.test.ts`. Only the JQL escaping and the
// comment parser are worth testing — everything else is a fetch wrapper.
import assert from 'node:assert/strict';
import {
  appsToIssues,
  jqlString,
  parseIssueApps,
  releaseApps,
  refKey,
  type Issue,
} from './jira';

// --- jqlString -------------------------------------------------------------

assert.equal(jqlString('Realease Rick'), '"Realease Rick"');
assert.equal(jqlString('He said "hi"'), String.raw`"He said \"hi\""`);
assert.equal(jqlString('back\\slash'), String.raw`"back\\slash"`);
// The injection case: a quote in the version name must not escape the literal.
assert.equal(jqlString('" OR project = X'), String.raw`"\" OR project = X"`);

console.log('jqlString ok');

// --- app parsing -----------------------------------------------------------

let n = 0;
const issue = (comments: string[], key = `HAC-${++n}`): Issue => ({
  key,
  type: 'Story',
  summary: '',
  status: 'To Do',
  done: false,
  description: '',
  components: [],
  labels: [],
  priority: '',
  comments,
  url: '',
});

// The real HAC-7 comment, including its "Outsytems" typo, as REST v2 returns it.
const real = [
  'Outsytems apps in release:',
  '',
  '-Hackathon Rick&Fran - Library',
  '-Hackathon Rick&Fran - Restaurants',
  '-Hackathon Rick&Fran - Reviews',
  '-Hackathon Rick&Fran - App',
  '',
].join('\n');

// No versions in today's data — app names must survive intact, including " - ".
assert.deepEqual(parseIssueApps(issue([real], 'HAC-7')), [
  { app: 'Hackathon Rick&Fran - Library' },
  { app: 'Hackathon Rick&Fran - Restaurants' },
  { app: 'Hackathon Rick&Fran - Reviews' },
  { app: 'Hackathon Rick&Fran - App' },
]);

// A ticket with no comment references no apps.
assert.deepEqual(parseIssueApps(issue([])), []);

// A bulleted comment with no header is not an app list.
assert.deepEqual(parseIssueApps(issue(['- Not an app list'])), []);

// Trailing-version forms (guessed convention).
assert.deepEqual(parseIssueApps(issue(['OutSystems apps:\n- MyApp 1.2'])), [
  { app: 'MyApp', version: '1.2' },
]);
assert.deepEqual(parseIssueApps(issue(['OutSystems apps:\n- MyApp v1.2.3'])), [
  { app: 'MyApp', version: '1.2.3' },
]);
assert.deepEqual(parseIssueApps(issue(['OutSystems apps:\n- A - B @ 2.0'])), [
  { app: 'A - B', version: '2.0' },
]);
// A lone integer is not a version — too likely to be part of a name.
assert.deepEqual(parseIssueApps(issue(['OutSystems apps:\n- Portal 2'])), [
  { app: 'Portal 2' },
]);

// releaseApps dedupes across tickets: two tickets, same app version, one entry.
const shared = 'OutSystems apps:\n- Lib 1.0';
assert.deepEqual(
  releaseApps([issue([shared], 'HAC-20'), issue([shared], 'HAC-21')]),
  [{ app: 'Lib', version: '1.0' }]
);

// ...but the same app at different versions stays distinct.
assert.equal(
  releaseApps([
    issue(['OutSystems apps:\n- Lib 1.0'], 'HAC-22'),
    issue(['OutSystems apps:\n- Lib 2.0'], 'HAC-23'),
  ]).length,
  2
);

// A ticket referencing several apps contributes all of them.
assert.equal(
  releaseApps([issue(['OutSystems apps:\n- Lib 1.0\n- Web 3.1'], 'HAC-24')]).length,
  2
);

// Traceability runs the other way: app version -> the tickets touching it.
const trace = appsToIssues([
  issue([shared], 'HAC-30'),
  issue([shared], 'HAC-31'),
  issue(['OutSystems apps:\n- Other 9.9'], 'HAC-32'),
]);
assert.deepEqual(
  trace.get(refKey({ app: 'Lib', version: '1.0' }))?.map((i) => i.key),
  ['HAC-30', 'HAC-31']
);
assert.deepEqual(
  trace.get(refKey({ app: 'Other', version: '9.9' }))?.map((i) => i.key),
  ['HAC-32']
);

// Survives the markdown-escaped bullet form.
assert.deepEqual(
  parseIssueApps(issue(['Outsystems apps in release:\n\\-A - B'])),
  [{ app: 'A - B' }]
);

console.log('app parsing ok');
