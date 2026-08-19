'use client';

import { useState } from 'react';
import { Markdown } from './markdown';

// ponytail: edits live in component state for the session — no persistence, no API
// route, no draft history, per the project decisions. Regenerating or reloading
// throws them away. Ceiling: the edited text is what milestone 6 must POST to ODC,
// so when that lands the approved text has to be lifted into a form field the
// deploy action reads.
export function NotesPanel({ title, body }: { title: string; body: string }) {
  const [text, setText] = useState(body);
  const [editing, setEditing] = useState(false);
  const edited = text !== body;

  return (
    <section className="rounded border border-black/15 p-4 dark:border-white/15">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">
          {title}
          {edited && <span className="ml-2 text-xs font-normal opacity-60">edited</span>}
        </h3>
        <div className="flex gap-2 text-xs">
          {edited && !editing && (
            <button
              type="button"
              onClick={() => setText(body)}
              className="underline decoration-dotted opacity-70"
            >
              Revert
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="rounded border border-black/20 px-2 py-1 dark:border-white/20"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="mt-3 h-96 w-full resize-y rounded border border-black/15 bg-transparent p-3 font-mono text-xs leading-relaxed dark:border-white/15"
        />
      ) : text.trim() ? (
        <Markdown>{text}</Markdown>
      ) : (
        <p className="mt-2 text-sm opacity-70">
          The agent returned nothing for this persona.
        </p>
      )}
    </section>
  );
}
