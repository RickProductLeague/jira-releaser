'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { launchDeploy, pollDeploy, writeChangelogToJira, type DeployOp } from './deploy';

/**
 * Re-run the pre-flight checks. `router.refresh()` re-renders the server
 * component with the same URL, so the analysis is asked for again.
 * Wraps the results it refreshes: while the transition is pending the stale
 * checks are gone, because a passed check from a minute ago is not an answer.
 * ponytail: no URL nonce, no state, no skeleton rows — one server render, and
 * `isPending` stays true until it lands.
 */
export function RefreshChecks({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => router.refresh())}
          className="rounded border border-black/20 px-3 py-1 text-sm disabled:opacity-40 dark:border-white/20"
        >
          {pending ? 'Re-checking…' : 'Re-run checks'}
        </button>
        <span className="text-sm opacity-60">
          {pending
            ? 'ODC is re-analysing each revision against its consumers.'
            : 'Asks ODC for a fresh analysis of the same revisions.'}
        </span>
      </div>

      {pending ? (
        <p
          role="status"
          aria-busy="true"
          className="mt-4 rounded border border-black/15 p-3 text-sm opacity-60 dark:border-white/15"
        >
          Running pre-flight checks…
        </p>
      ) : (
        children
      )}
    </>
  );
}

/**
 * Let the human set the deploy order on the pre-flight step. The rows are rendered
 * by the server component and handed over as nodes — this only shuffles them and
 * writes the resulting key list into the approve form, which carries it to the
 * deploy step as `?order=`.
 * Drag a row to move it, or use ▲▼ — the buttons are the keyboard path, so the
 * ordering isn't mouse-only. Both are off in parallel mode, where ODC decides the
 * order and a list the human arranged would be a lie.
 * ponytail: the browser's own HTML5 drag events, no `@dnd-kit` and no pointer-move
 * maths. That buys no touch support (mobile fires no drag events) and no animated
 * reflow — the buttons cover the first, and a release has four rows, not four
 * hundred. Swap in a real DnD library if either starts to matter.
 * The `form` attribute is how a hidden input joins a form it isn't inside.
 */
export function Reorder({
  formId,
  items,
}: {
  formId: string;
  items: { key: string; node: React.ReactNode }[];
}) {
  const [order, setOrder] = useState(items.map((i) => i.key));
  /** One at a time in list order, or all at once and let ODC queue them. Sequential
   *  by default: it's the mode where the order on screen is the order that happens. */
  const [sequential, setSequential] = useState(true);
  /** Row being dragged, and the row it is currently hovering — both indices. */
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const byKey = new Map(items.map((i) => [i.key, i.node]));

  /** Lift row `from` out and drop it back in at `to` — the one primitive both the drag
   *  and the buttons use, so they can't disagree. */
  const move = (from: number, to: number) =>
    setOrder((o) => {
      if (to < 0 || to >= o.length || from === to) return o;
      const next = [...o];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });

  return (
    <>
      <div className="mt-4 flex flex-wrap items-baseline gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(e) => setSequential(e.target.checked)}
          />
          Deploy one at a time
        </label>
        <span className="opacity-60">
          {sequential
            ? 'Top to bottom — drag a row, or use ▲▼, to put a producer above the apps that consume it. A failure stops the rest.'
            : 'All at once, in whatever order ODC gets to them. Faster, and no way to land a producer first.'}
        </span>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {order.map((key, i) => (
          <li
            key={key}
            // The whole row is the drag surface and the drop target — a small handle
            // is a small target. Cost: text inside a row is no longer selectable by
            // dragging across it. The buttons and links in it still work.
            draggable={sequential}
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox won't start a drag without payload on the transfer.
              e.dataTransfer.setData('text/plain', key);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (drag === null || !sequential) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
              setOver(null);
            }}
            className={`flex items-start gap-2 rounded transition-opacity ${
              sequential ? 'cursor-grab active:cursor-grabbing' : ''
            } ${
              drag === i ? 'opacity-40' : ''
            } ${over === i && drag !== null && drag !== i ? 'outline outline-2 outline-sky-500/60' : ''}`}
          >
            <div className="flex flex-col items-center pt-2">
              {/* ponytail: order is 1-based for the human, index for the code. */}
              <button
                type="button"
                aria-label={`Deploy earlier (position ${i + 1})`}
                disabled={!sequential || i === 0}
                onClick={() => move(i, i - 1)}
                className="px-1 text-xs leading-none opacity-60 disabled:opacity-20"
              >
                ▲
              </button>
              {/* No position to show when they all go at once. */}
              <span className="px-1 text-xs tabular-nums opacity-40">
                {sequential ? i + 1 : '·'}
              </span>
              <button
                type="button"
                aria-label={`Deploy later (position ${i + 1})`}
                disabled={!sequential || i === order.length - 1}
                onClick={() => move(i, i + 1)}
                className="px-1 text-xs leading-none opacity-60 disabled:opacity-20"
              >
                ▼
              </button>
            </div>
            <div className="min-w-0 flex-1">{byKey.get(key)}</div>
          </li>
        ))}
      </ul>
      <input type="hidden" form={formId} name="order" value={order.join(',')} />
      {/* Sequential is the default, so only the other choice needs a param. */}
      {!sequential && <input type="hidden" form={formId} name="parallel" value="1" />}
    </>
  );
}

// ponytail: the deploy runs for minutes on ODC's side, so the action starts it and
// returns operation keys; this polls every 3s until nothing is Running. Blocking a
// server action until Finished would just hit the function timeout with a spinner.
const POLL_MS = 3000;

export function DeployPanel({
  v,
  target,
  picks,
  blocked,
  parallel,
}: {
  v: string;
  target: string;
  /** `{ [assetKey]: revision }` — what step 4 selected. Re-validated server-side. */
  picks: Record<string, number>;
  blocked: boolean;
  /** All at once, as chosen on the pre-flight step. Sequential is the default. */
  parallel: boolean;
}) {
  const [ops, setOps] = useState<DeployOp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const running = ops?.some((o) => o.status === 'Running') ?? false;
  // Apps go out one at a time, so a failure leaves the rest of the queue parked.
  const halted =
    (ops?.some((o) => o.status === 'FinishedWithError' || o.error) ?? false) &&
    ops!.some((o) => o.status === 'Queued');

  useEffect(() => {
    if (!running || !ops) return;
    const t = setTimeout(async () => setOps(await pollDeploy(ops)), POLL_MS);
    return () => clearTimeout(t);
  }, [ops, running]);

  const count = Object.keys(picks).length;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={blocked || pending || count === 0 || ops !== null}
          onClick={() =>
            confirm(`Deploy ${count} app${count === 1 ? '' : 's'} to ${target}? This is live.`) &&
            start(async () => {
              // The approved technical notes, as edited in step 3. sessionStorage is
              // the only thing that survives the navigation between steps.
              const notes = sessionStorage.getItem(`jr:${v}:technical`) ?? undefined;
              const run = await launchDeploy(v, picks, notes, parallel);
              setError(run.error ?? null);
              setOps(run.ops.length > 0 ? run.ops : null);
            })
          }
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {pending
            ? 'Starting…'
            : `Deploy ${count} app${count === 1 ? '' : 's'} to ${target}`}
        </button>
        <span className="text-sm opacity-60">
          {blocked
            ? 'Blocked: fix the errors above first.'
            : count === 0
              ? 'Nothing to do — every selected revision is already live there.'
            : running
              ? parallel
                ? 'Deploying all apps at once — polling ODC every 3s.'
                : 'Deploying one app at a time, in the order you set — polling ODC every 3s.'
              : halted
                ? 'Stopped: the rest of the queue was not started.'
              : ops
                ? 'Done. Reload the page to run it again.'
                : 'Checks passed. This writes to ODC for real.'}
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
          Deploy failed to start: {error}
        </p>
      )}

      {ops && (
        <ul className="mt-4 flex flex-col gap-2">
          {ops.map((o) => (
            <li key={o.assetKey} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium">{o.app}</span>
              <span className="font-mono text-xs opacity-60">
                rev {o.revision}
                {o.tag ? ` · ${o.tag}` : ''}
              </span>
              <span
                className={
                  o.status === 'Finished'
                    ? 'rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400'
                    : o.status === 'Running' ||
                        o.status === 'AlreadyLive' ||
                        o.status === 'Queued'
                      ? 'rounded bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10'
                      : 'rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400'
                }
              >
                {o.status === 'Running'
                  ? 'deploying…'
                  : o.status === 'Finished'
                    ? `live in ${target}`
                    : o.status === 'AlreadyLive'
                      ? 'skipped — already live'
                      : o.status === 'Queued'
                        ? // The queue stops on a failure, so a still-queued app after
                          // one has broken is never going to start on its own.
                          halted
                          ? 'not started — an earlier deploy failed'
                          : 'waiting its turn'
                        : (o.status ?? 'not started')}
              </span>
              {o.notesWritten && (
                <span className="text-xs opacity-60">release notes written</span>
              )}
              {o.tagError && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  version/notes not written: {o.tagError}
                </span>
              )}
              {o.error && <span className="text-red-700 dark:text-red-400">{o.error}</span>}
              {o.messages && o.messages.length > 0 && (
                <ul className="w-full pl-4 text-xs opacity-70">
                  {o.messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

/**
 * Put the customer changelog on the Jira release, from the review step — the text is
 * on screen there, so the write happens where a human can see what they're writing.
 * Sends whatever is in sessionStorage for this release, edits included.
 */
export function JiraChangelog({
  v,
  jiraUrl,
  changelog,
}: {
  v: string;
  jiraUrl?: string;
  /** The generated changelog as the server rendered it — the fallback when
   *  sessionStorage is empty. Edits in the panel below still win. */
  changelog: string;
}) {
  const [written, setWritten] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  // sessionStorage holds the edited text, but only once NotesPanel has mounted and
  // only in the tab that generated it — a reload, or a click before the panels
  // hydrate, used to send "" and fail with "No changelog text to write." The
  // server-rendered text is the floor, so the button can never have nothing to send.
  const text = () => {
    const stored = sessionStorage.getItem(`jr:${v}:business`);
    return stored && stored.trim() ? stored : changelog;
  };

  return (
    <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          // Not disabled once written: the text is editable below, so a second
          // write after an edit is a thing a human will reasonably want.
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await writeChangelogToJira(v, text());
              setError(res.error ?? null);
              setWritten(res.url ?? null);
            })
          }
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {pending
            ? 'Writing…'
            : written
              ? 'Written — write again'
              : 'Write release notes to Jira'}
        </button>
        {/* The release page's named custom section takes no API write — Jira exposes
            no endpoint for it at all — so pasting is the only way text reaches that
            exact spot. This makes it one click instead of a scroll-and-select. */}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text());
              setCopied(true);
            } catch (e) {
              // Clipboard needs a secure context and a user gesture; if the browser
              // refuses, say so rather than failing silently on a click.
              setError(e instanceof Error ? e.message : 'Clipboard was blocked.');
            }
          }}
          className="rounded border border-black/20 px-4 py-2 text-sm dark:border-white/20"
        >
          {copied ? 'Copied — paste into the section' : 'Copy changelog'}
        </button>
        {(written ?? jiraUrl) && (
          <a
            href={written ?? jiraUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline decoration-dotted"
          >
            Open {v} in Jira
          </a>
        )}
        <span className="text-sm opacity-60">
          {written
            ? 'The customer changelog is now the release description.'
            : 'Writes the customer changelog onto the release description.'}
        </span>
      </div>
      {error && (
        <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
          Jira write failed: {error}
        </p>
      )}
    </div>
  );
}
