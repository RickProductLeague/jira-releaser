import type { ReactNode } from 'react';

// ponytail: a ~60-line renderer for the exact subset the release-notes agent emits —
// headings, bullets (one nesting level), **bold**, `code`, --- rules, paragraphs.
// No react-markdown: one dependency avoided, and output is React elements so there
// is no dangerouslySetInnerHTML and nothing the agent (or a quoted Jira comment)
// writes can inject markup. Ceiling: no tables, links, images or blockquotes — they
// render as their literal text. Upgrade path: if the agent starts emitting those,
// install react-markdown and delete this file.

// Italics require non-space either side, so "2 * 3 * 4" stays arithmetic.
const INLINE = /(\*\*[^*]+\*\*|\*(?!\s)[^*\n]*[^\s*]\*|`[^`]+`)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className="rounded bg-black/5 px-1 font-mono text-[0.9em] dark:bg-white/10">
          {part.slice(1, -1)}
        </code>
      );
    if (part.length > 1 && part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const SIZE = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm'];

export function Markdown({ children }: { children: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] | null = null;
  let para: string[] = [];

  const flush = () => {
    if (list) out.push(<ul key={out.length} className="my-2 space-y-1">{list}</ul>);
    if (para.length)
      out.push(
        <p key={out.length} className="my-2">
          {inline(para.join(' '))}
        </p>
      );
    list = null;
    para = [];
  };

  for (const line of children.split(/\r?\n/)) {
    const heading = line.match(HEADING);
    const bullet = line.match(BULLET);

    if (RULE.test(line)) {
      flush();
      out.push(<hr key={out.length} className="my-4 border-black/10 dark:border-white/10" />);
    } else if (heading) {
      flush();
      const level = heading[1].length;
      out.push(
        <p key={out.length} className={`mt-4 mb-1 font-semibold ${SIZE[level - 1]}`}>
          {inline(heading[2])}
        </p>
      );
    } else if (bullet) {
      if (para.length) flush();
      list ??= [];
      list.push(
        <li key={list.length} className={bullet[1].length >= 2 ? 'ml-5 list-disc' : 'ml-4 list-disc'}>
          {inline(bullet[2])}
        </li>
      );
    } else if (line.trim() === '') {
      flush();
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();

  return <div className="text-sm leading-relaxed">{out}</div>;
}
