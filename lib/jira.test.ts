// ponytail: run with `npx tsx lib/jira.test.ts`. Only the JQL escaping and the
// comment parser are worth testing — everything else is a fetch wrapper.
import assert from 'node:assert/strict';
import {
  appsToIssues,
  jqlString,
  parseIssueApps,
  releaseApps,
  toPlainText,

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

// --- toPlainText: the agent writes markdown, Jira gets prose ---
assert.equal(toPlainText('## Business Release Notes'), 'Business Release Notes');
assert.equal(toPlainText('### What We Fixed'), 'What We Fixed');
assert.equal(toPlainText('# Top'), 'Top');
// Emphasis markers go, the words stay. No stray asterisk left behind.
assert.equal(toPlainText('**Track Restaurants You Love**'), 'Track Restaurants You Love');
assert.equal(toPlainText('a **b** c **d** e'), 'a b c d e');
assert.equal(toPlainText('***all three***'), 'all three');
assert.equal(toPlainText('_ital_ and __bold__'), '_ital_ and bold');
assert.equal(toPlainText('use `npm run dev`'), 'use npm run dev');
// Bullets keep their marker — a list with no markers stops reading as a list — but
// normalise to "-" so nothing survives that wiki markup would read as bold.
assert.equal(toPlainText('- **Search** by name'), '- Search by name');
assert.equal(toPlainText('* star bullet'), '- star bullet');
// Indentation of a nested bullet survives — mid-document, which is the only place
// it can occur. The document-level trim owns the first and last line.
assert.equal(toPlainText('- top\n  - nested'), '- top\n  - nested');
// Numbered lists are already plain text.
assert.equal(toPlainText('1. first'), '1. first');
// Rules carry no words, so they vanish and don't leave a blank-line run.
assert.equal(toPlainText('a\n\n---\n\nb'), 'a\n\nb');
// A heading marker only counts at the start of a line.
assert.equal(toPlainText('not # a heading'), 'not # a heading');
// Links keep the URL — dropping it would lose information.
assert.equal(toPlainText('see [the docs](https://x.dev)'), 'see the docs (https://x.dev)');
// Multi-line stays line-oriented, and the whole thing is trimmed.
assert.equal(toPlainText('## H\n- one\n- two\n'), 'H\n- one\n- two');

console.log('plain text ok');
