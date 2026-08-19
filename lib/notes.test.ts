// ponytail: run with `npx tsx lib/notes.test.ts`. Only the split is worth testing —
// the rest is a fetch wrapper.
import assert from 'node:assert/strict';
import { splitNotes } from './notes';

// What the agent actually returns today: one field, both personas inside it.
const real = [
  '# Release Notes: Release Rick',
  '',
  '## Technical Release Notes',
  '',
  '- **HAC-7**: implemented top restaurants',
  '',
  '---',
  '',
  '## Business Release Notes',
  '',
  "### What's New",
  'Users can now browse top-rated restaurants.',
].join('\n');

const split = splitNotes({ TechnicalReleaseNotes: real });
assert.match(split.technical, /HAC-7/);
assert.doesNotMatch(split.technical, /browse top-rated/);
assert.match(split.business, /^## Business Release Notes/);
assert.match(split.business, /browse top-rated/);

// When the agent is fixed to populate both fields, the split gets out of the way.
assert.deepEqual(
  splitNotes({ TechnicalReleaseNotes: 'tech', FriendlyReleaseNotes: 'friendly' }),
  { technical: 'tech', business: 'friendly' }
);

// No business heading at all: everything stays technical, nothing is lost.
assert.deepEqual(splitNotes({ TechnicalReleaseNotes: '# Just tech' }), {
  technical: '# Just tech',
  business: '',
});

// Heading wording drifts ("Customer Release Notes") — still splits.
assert.equal(
  splitNotes({ TechnicalReleaseNotes: 'a\n\n### Customer Release Notes\nb' }).business,
  '### Customer Release Notes\nb'
);

// The field got renamed mid-hackathon (TechnicalReleaseNotes -> ReleaseNotes) while
// the swagger kept the old name. Whatever it's called, the split still works.
const renamed = splitNotes({ ReleaseNotes: real });
assert.match(renamed.technical, /HAC-7/);
assert.match(renamed.business, /browse top-rated/);

// A response with junk alongside the notes picks the notes, not the junk.
assert.match(
  splitNotes({ StatusCode: 'OK', ReleaseNotes: real }).technical,
  /HAC-7/
);

// Empty response doesn't throw.
assert.deepEqual(splitNotes({}), { technical: '', business: '' });

console.log('notes split ok');
