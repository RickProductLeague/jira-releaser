// ponytail: run with `npx tsx app/markdown.test.tsx`. Renders to a string and checks
// the blocks the agent actually emits — plus the escaping, which is the reason this
// renderer builds React elements instead of an HTML string.
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown';

const html = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

const out = html(
  [
    '# Release Notes: Release Rick',
    '',
    '---',
    '',
    '## Technical Release Notes',
    '',
    '**HAC-7: Add Restaurant Entry**',
    '- Implemented core creation',
    '  - Nested detail',
    '',
    'A closing paragraph with `code` in it.',
  ].join('\n')
);

assert.match(out, /Release Notes: Release Rick<\/p>/);
assert.match(out, /<hr/);
assert.match(out, /<strong>HAC-7: Add Restaurant Entry<\/strong>/);
assert.match(out, /<ul[^>]*>[\s\S]*Implemented core creation[\s\S]*Nested detail[\s\S]*<\/ul>/);
assert.match(out, /<code[^>]*>code<\/code>/);
assert.match(out, /<p[^>]*>A closing paragraph/);

// Two bullet lists separated by a paragraph don't merge into one.
assert.equal((html('- a\n\ntext\n\n- b').match(/<ul/g) ?? []).length, 2);

// The whole point of rendering elements: agent text can't inject markup.
assert.match(html('<img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html('**<script>alert(1)</script>**'), /<script>/);

// Unmatched asterisks stay literal rather than eating the rest of the line.
assert.match(html('2 * 3 * 4'), /2 \* 3 \* 4/);

console.log('markdown ok');
