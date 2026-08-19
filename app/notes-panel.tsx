'use client';

import { useEffect, useState } from 'react';
import { Markdown } from './markdown';

// ponytail: edits live in component state, mirrored to sessionStorage so the
// approved text survives the navigation to the deploy step — which is the only
// reason it's stored at all. Still no server persistence and no draft history: one
// key per persona per release, overwritten on every keystroke, gone with the tab.
export function NotesPanel({
  title,
  body,
  storageKey,
}: {
  title: string;
  body: string;
  /** Where the deploy step reads this text from. `jr:<release>:technical|business`. */
  storageKey: string;
}) {
  const [text, setText] = useState(body);
  const [editing, setEditing] = useState(false);
  const edited = text !== body;

  useEffect(() => {
    sessionStorage.setItem(storageKey, text);
  }, [storageKey, text]);

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
