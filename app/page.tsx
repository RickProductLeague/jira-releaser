import {
  findVersion,
  getIssues,
  getVersions,
  parseIssueApps,
  PROJECT,
  refKey,
  releaseApps,
  versionUrl,
} from '@/lib/jira';
import { generateNotes } from '@/lib/notes';
import {
  deployable,
  listApps,
  nextStage,
  deployedRevision,
  odcMock,
  preflight,
  releasableRevision,
  revisions,
  stages,
  type Asset,
  type Preflight,
  type Revision,
  type Stage,
} from '@/lib/odc';
import { DeployPanel, JiraChangelog, Reorder, RefreshChecks } from './deploy-panel';
import { NotesPanel } from './notes-panel';

export const dynamic = 'force-dynamic';

// ponytail: the wizard step is DERIVED from the URL, not stored. No step param to
// keep in sync, no client state, and every step is a shareable link. Back is the
// browser's back button plus one explicit link per step.
const STEPS = [
  'Pick release',
  'Review Jira work',
  'Release notes',
  'Confirm revisions',
  'Pre-flight',
  'Deploy',
] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 && <span className="opacity-30">→</span>}
          <span
            className={
              i === current
                ? 'rounded bg-foreground px-2 py-1 text-background'
                : 'rounded px-2 py-1 opacity-50'
            }
            aria-current={i === current ? 'step' : undefined}
          >
            {i + 1}. {label}
          </span>
        </li>
      ))}
      {/* Start over. The step is derived from the URL, so "/" is the start and a
          plain link is the whole feature — no client state to reset. */}
      {current > 0 && (
        <li className="ml-auto">
          <a href="/" className="rounded px-2 py-1 underline decoration-dotted opacity-70">
            Start over
          </a>
        </li>
      )}
    </ol>
  );
}

export default async function Home({
  searchParams,
}: {
  // Open record: steps 4-5 carry one `rev.<assetKey>=<n>` param per app.
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { v, notes, deploy, check, go } = sp;
  const step = !v ? 0 : !notes ? 1 : !deploy ? 2 : !check ? 3 : !go ? 4 : 5;

  let versions: Awaited<ReturnType<typeof getVersions>> = [];
  let issues: Awaited<ReturnType<typeof getIssues>> = [];
  let error: string | null = null;

  // The release's own page in Jira — shown from the notes step on, and the place the
  // customer changelog gets written to.
  let jiraUrl: string | undefined;

  try {
    if (step === 0) versions = await getVersions(PROJECT);
    if (v) issues = await getIssues(PROJECT, v);
    if (step >= 2 && v) {
      const version = await findVersion(PROJECT, v);
      jiraUrl = version && versionUrl(version.id);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // ponytail: generated on the server during the request, no API route and no
  // client state. The browser's own navigation spinner is the loading UI.
  let generated: Awaited<ReturnType<typeof generateNotes>> | null = null;
  let notesError: string | null = null;
  if (step === 2 && v && issues.length > 0) {
    try {
      generated = await generateNotes(issues, v);
    } catch (e) {
      notesError = e instanceof Error ? e.message : String(e);
    }
  }

  const notDone = issues.filter((i) => !i.done).length;
  const odcApps = releaseApps(issues);
  const unmapped = issues.filter((i) => parseIssueApps(i).length === 0).length;
  const reviewUrl = `/?v=${encodeURIComponent(v ?? '')}`;
  const notesUrl = `${reviewUrl}&notes=1`;
  const revisionsUrl = `${notesUrl}&deploy=1`;
  // Back to the checks keeps the revision pins, so it re-checks the same thing.
  const preflightUrl = `${revisionsUrl}&check=1${Object.entries(sp)
    .filter(([k]) => k.startsWith('rev.'))
    .map(([k, val]) => `&${k}=${val}`)
    .join('')}`;

  // Steps 4-5 — the ODC side. One row per app version in the deploy set: which
  // asset it resolves to, which revisions exist, and which one will ship.
  type Row = {
    app: string;
    asset?: Asset;
    revs: Revision[];
    selected: number;
    /** Newer revisions passed over because they have no Release build. */
    skipped: number;
    /** Revision live in the target stage, so the picker can say so. */
    live?: number;
  };
  let rows: Row[] = [];
  let target: Stage | undefined;
  let flights: Preflight[] = [];
  let odcError: string | null = null;
  const assetNames = new Map<string, string>();

  if (step >= 3 && v && issues.length > 0) {
    try {
      const [all, pipeline] = await Promise.all([listApps(), stages()]);
      target = nextStage(pipeline, pipeline[0]?.key);
      // Exact name match, case- and whitespace-insensitive — all four live app
      // names matched exactly, so no fuzzy matching. An unmatched name blocks.
      const byName = new Map(all.map((a) => [a.name.trim().toLowerCase(), a]));
      // Pre-flight names consumer/producer assets by key, and those are usually
      // outside the deploy set — so resolve names against the whole repository.
      for (const a of all) assetNames.set(a.assetKey, a.name);
      rows = odcApps.map((ref) => ({
        app: ref.app,
        asset: byName.get(ref.app.trim().toLowerCase()),
        revs: [] as Revision[],
        selected: 0,
        skipped: 0,
      }));

      await Promise.all(
        rows.map(async (r) => {
          if (!r.asset || !deployable(r.asset)) return;
          const key = r.asset.assetKey;
          const [revs, live] = await Promise.all([
            revisions(key),
            target ? deployedRevision(key, target.key) : undefined,
          ]);
          r.revs = revs;
          r.live = live?.revision;
          // The default is the newest revision with a Release build. The picker
          // exists for the case the default can't cover — Dev has moved past this
          // release, or Production needs rolling back — so a chosen revision that
          // really exists wins, and anything else is ignored rather than trusted.
          const asked = Number(sp[`rev.${key}`]);
          if (revs.some((x) => x.revision === asked)) {
            r.selected = asked;
          } else {
            const pick = await releasableRevision(key, revs);
            r.selected = pick.revision || r.asset.revision;
            r.skipped = pick.skipped;
          }
        })
      );

      if (step === 4 && target)
        flights = await Promise.all(
          rows
            .filter((r) => r.asset && deployable(r.asset))
            .map((r) => preflight(r.app, r.asset!.assetKey, r.selected, target!.key))
        );
    } catch (e) {
      odcError = e instanceof Error ? e.message : String(e);
    }
  }

  const unresolved = rows.filter((r) => !r.asset);
  // A library in the deploy set is a reason the apps ship, not a thing that ships.
  const libraries = rows.filter((r) => r.asset && !deployable(r.asset));
  // The deploy order the pre-flight step approved, `?order=assetKey,assetKey`. An
  // asset that isn't in it (or no param at all) keeps its natural place at the end.
  const order = (sp.order ?? '').split(',').filter(Boolean);
  const rank = (key?: string) => {
    const i = key ? order.indexOf(key) : -1;
    return i < 0 ? order.length : i;
  };
  const toDeploy = rows
    .filter((r) => r.asset && deployable(r.asset))
    .sort((a, b) => rank(a.asset?.assetKey) - rank(b.asset?.assetKey));
  const blocked =
    unresolved.length > 0 ||
    flights.some((f) => f.status !== 'ok' && f.status !== 'warnings');
  const nameOf = (key?: string) => (key ? (assetNames.get(key) ?? key) : key);
  const alreadyLive = flights.filter((f) => f.alreadyLive);
  const willDeploy = flights.filter((f) => !f.alreadyLive);

  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-sans">
      {odcMock() && (
        <p
          role="status"
          className="mb-6 rounded border border-fuchsia-500/50 bg-fuchsia-500/15 p-3 text-sm font-medium text-fuchsia-800 dark:text-fuchsia-300"
        >
          <strong>ODC_MOCK=1</strong> — OutSystems data is canned, not live. Stages,
          apps and any deployment shown here are fake and deploy nothing. Jira data
          is unaffected.
        </p>
      )}

      <h1 className="text-2xl font-semibold">Jira Releaser</h1>
      <p className="mt-1 text-sm opacity-60">
        Top Restaurants Tracker &middot; project {PROJECT}
      </p>

      <Stepper current={step} />

      {error && (
        <p className="mt-6 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {error}
        </p>
      )}

      {/* Step 1 — pick a release. */}
      {step === 0 && !error && (
        <form className="mt-8 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">Release (fixVersion)</span>
            <select
              name="v"
              required
              defaultValue=""
              className="rounded border border-black/20 bg-transparent px-3 py-2 dark:border-white/20"
            >
              <option value="">Select a release…</option>
              {versions.map((ver) => (
                <option key={ver.id} value={ver.name}>
                  {ver.name}
                  {ver.released ? ' (released)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded bg-foreground px-4 py-2 text-sm text-background"
          >
            Next: review the work
          </button>
        </form>
      )}

      {/* Step 2 — review what came back from Jira, then approve. */}
      {step === 1 && !error && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-medium">
              {v} &middot; {issues.length} issue{issues.length === 1 ? '' : 's'}
            </h2>
            {notDone > 0 && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                {notDone} not shipped yet
              </span>
            )}
            <a href="/" className="text-sm underline decoration-dotted opacity-70">
              Change release
            </a>
          </div>

          {issues.length > 0 && (
            <div className="mt-4 rounded border border-black/15 p-3 dark:border-white/15">
              <h3 className="text-sm font-medium">
                Deploy set &middot; {odcApps.length} ODC app version
                {odcApps.length === 1 ? '' : 's'}
              </h3>
              {odcApps.length === 0 ? (
                <p className="mt-1 text-sm opacity-70">
                  None found. Add a comment to an issue listing them, e.g.{' '}
                  <code>OutSystems apps in release:</code> followed by one{' '}
                  <code>-App Name 1.2</code> line per app version.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {odcApps.map((ref) => (
                    <li
                      key={refKey(ref)}
                      className="rounded bg-black/5 px-2 py-1 font-mono text-xs dark:bg-white/10"
                    >
                      {ref.app}
                      {ref.version ? (
                        <span className="ml-1 opacity-60">{ref.version}</span>
                      ) : (
                        <span
                          className="ml-1 text-amber-700 dark:text-amber-400"
                          title="No version parsed from the Jira comment"
                        >
                          no version
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {unmapped > 0 && (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                  {unmapped} of {issues.length} issue
                  {issues.length === 1 ? '' : 's'} reference no ODC app.
                </p>
              )}
            </div>
          )}

          {issues.length === 0 ? (
            <p className="mt-4 text-sm opacity-70">
              No issues have <code>fixVersion = {v}</code> yet. Assign issues to
              this version in Jira, then reload.
            </p>
          ) : (
            <>
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/15 text-left dark:border-white/15">
                    <th className="py-2 pr-3 font-medium">Key</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Summary</th>
                    <th className="py-2 pr-3 font-medium">ODC app versions</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i) => (
                    <tr
                      key={i.key}
                      className="border-b border-black/8 align-top dark:border-white/8"
                    >
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted"
                        >
                          {i.key}
                        </a>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap opacity-70">
                        {i.type}
                      </td>
                      <td className="py-2 pr-3">{i.summary}</td>
                      <td className="py-2 pr-3">
                        {parseIssueApps(i).length === 0 ? (
                          <span className="text-xs opacity-50">—</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {parseIssueApps(i).map((ref) => (
                              <li key={refKey(ref)} className="font-mono text-xs">
                                {ref.app}
                                {ref.version && (
                                  <span className="ml-1 opacity-60">
                                    {ref.version}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={
                            i.done
                              ? 'opacity-70'
                              : 'rounded bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400'
                          }
                          title={
                            i.done
                              ? undefined
                              : 'Not in a Done status — may not actually ship'
                          }
                        >
                          {i.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <form className="mt-6 flex items-center gap-3">
                <input type="hidden" name="v" value={v} />
                <input type="hidden" name="notes" value="1" />
                <button
                  type="submit"
                  className="rounded bg-foreground px-4 py-2 text-sm text-background"
                >
                  Looks right — generate release notes
                </button>
                <span className="text-sm opacity-60">
                  Takes a few seconds; the agent reads every ticket.
                </span>
              </form>
            </>
          )}
        </section>
      )}

      {/* Step 3 — the two personas, side by side. */}
      {step === 2 && !error && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-medium">
              {v} &middot; release notes from {issues.length} issue
              {issues.length === 1 ? '' : 's'}
            </h2>
            <a
              href={reviewUrl}
              className="text-sm underline decoration-dotted opacity-70"
            >
              Back to the work
            </a>
          </div>

          {notesError && (
            <p className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
              Release notes agent failed: {notesError}
            </p>
          )}

          {generated && (
            <>
              {/* Write the changelog to Jira from here, where the text is on screen
                  and editable. It writes what's in the panels below, edits included. */}
              <JiraChangelog v={v!} jiraUrl={jiraUrl} changelog={generated.business} />

              <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
                {(
                  [
                    ['Technical release notes', generated.technical, 'technical'],
                    ['Customer changelog', generated.business, 'business'],
                  ] as const
                ).map(([title, body, slot]) => (
                  <NotesPanel
                    key={title}
                    title={title}
                    body={body}
                    // The deploy step reads these two keys back out of sessionStorage:
                    // technical notes go onto each ODC revision, the changelog to Jira.
                    storageKey={`jr:${v}:${slot}`}
                  />
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <form>
                  <input type="hidden" name="v" value={v} />
                  <input type="hidden" name="notes" value="1" />
                  <button
                    type="submit"
                    className="rounded border border-black/20 px-4 py-2 text-sm dark:border-white/20"
                  >
                    Regenerate
                  </button>
                </form>
                {/* ponytail: approving navigates, so edits made above are lost on
                    the way to step 4. Milestone 6 has to carry the edited text
                    into the release-notes write; that's the same open problem the
                    no-persistence decision already parked. */}
                <a
                  href={revisionsUrl}
                  className="rounded bg-foreground px-4 py-2 text-sm text-background"
                >
                  Approve — pick revisions to deploy
                </a>
              </div>
            </>
          )}
        </section>
      )}

      {/* Steps 4, 5 and 6 all work off the same ODC reads. */}
      {step >= 3 && !error && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-medium">
              {step === 3 ? 'Revisions to deploy' : step === 4 ? 'Pre-flight' : 'Deploy'}
              {target && (
                <span className="ml-2 font-normal opacity-60">→ {target.name}</span>
              )}
            </h2>
            <a
              href={step === 3 ? notesUrl : step === 4 ? revisionsUrl : preflightUrl}
              className="text-sm underline decoration-dotted opacity-70"
            >
              {step === 3
                ? 'Back to the notes'
                : step === 4
                  ? 'Back to the revisions'
                  : 'Back to the checks'}
            </a>
          </div>

          {odcError && (
            <p className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
              ODC read failed: {odcError}
            </p>
          )}

          {!odcError && libraries.length > 0 && (
            <p className="mt-4 text-sm opacity-70">
              {libraries.map((r) => r.app).join(', ')} —{' '}
              {libraries.length === 1 ? 'a library, packaged' : 'libraries, packaged'}{' '}
              into the apps that consume{libraries.length === 1 ? 's' : ''} it, so it
              is not deployed to a stage of its own. It is why the apps below need a
              revision that includes it.
            </p>
          )}

          {!odcError && rows.length > 0 && toDeploy.length === 0 && (
            <p className="mt-4 text-sm opacity-70">
              Nothing deployable in this release — the deploy set is libraries only.
            </p>
          )}

          {!odcError && rows.length === 0 && (
            <p className="mt-4 text-sm opacity-70">
              The deploy set is empty — no ODC app versions were parsed from the Jira
              comments, so there is nothing to deploy.
            </p>
          )}

          {unresolved.length > 0 && (
            <p className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
              No ODC asset matches{' '}
              {unresolved.map((r) => (
                <code key={r.app} className="mr-1">
                  {r.app}
                </code>
              ))}
              — fix the name in the Jira comment, or the deploy will be incomplete.
            </p>
          )}

          {/* Step 4 — what will ship. The default is the newest revision with a
              Release build; the picker is for when that default is wrong (Dev moved
              past this release, or Production needs rolling back). */}
          {step === 3 && toDeploy.length > 0 && (
            <form className="mt-4">
              <input type="hidden" name="v" value={v} />
              <input type="hidden" name="notes" value="1" />
              <input type="hidden" name="deploy" value="1" />
              <input type="hidden" name="check" value="1" />
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/15 text-left dark:border-white/15">
                    <th className="py-2 pr-3 font-medium">App</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Revision to deploy</th>
                  </tr>
                </thead>
                <tbody>
                  {toDeploy.map((r) => (
                      <tr
                        key={r.app}
                        className="border-b border-black/8 align-middle dark:border-white/8"
                      >
                        <td className="py-2 pr-3">{r.app}</td>
                        <td className="py-2 pr-3 whitespace-nowrap opacity-70">
                          {r.asset?.assetType ?? (
                            <span className="text-red-600 dark:text-red-400">
                              not in ODC
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            name={`rev.${r.asset!.assetKey}`}
                            defaultValue={String(r.selected)}
                            className="rounded border border-black/20 bg-transparent px-2 py-1 font-mono text-xs dark:border-white/20"
                          >
                            {/* ponytail: newest 10, no paging. Deploying something
                                older than that is a Portal job, not a wizard one. */}
                            {r.revs.slice(0, 10).map((rev, i) => (
                              <option key={rev.revision} value={rev.revision}>
                                rev {rev.revision}
                                {rev.tag ? ` · ${rev.tag}` : ''}
                                {rev.createdAt ? ` · ${rev.createdAt.slice(0, 10)}` : ''}
                                {i === 0 ? ' · latest' : ''}
                                {rev.revision === r.live ? ' · already live' : ''}
                              </option>
                            ))}
                          </select>
                          <span className="ml-2 text-xs opacity-60">
                            {r.selected === r.live
                              ? 'already live — will be skipped'
                              : r.skipped > 0
                                ? `default: newest with a Release build (skipped ${r.skipped} newer)`
                                : r.selected === r.revs[0]?.revision
                                  ? 'default: latest'
                                  : 'chosen'}
                          </span>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded bg-foreground px-4 py-2 text-sm text-background"
                >
                  Run pre-flight checks
                </button>
                <span className="text-sm opacity-60">
                  ODC checks each revision against its consumers and producers; takes
                  a few seconds per app.
                </span>
              </div>
            </form>
          )}

          {/* Step 5 — ODC's own impact analysis, as a deploy gate. */}
          {step === 4 && flights.length > 0 && (
            <RefreshChecks>
              <Reorder
                formId="approve"
                items={flights.map((f) => {
                  const head = (
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium">{f.app}</span>
                      <span className="font-mono text-xs opacity-60">
                        rev {f.revision}
                        {f.tag ? ` · ${f.tag}` : ' · untagged'}
                      </span>
                      <span
                        className={
                          f.status === 'ok'
                            ? 'rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400'
                            : f.status === 'warnings'
                              ? 'rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400'
                              : 'rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400'
                        }
                      >
                        {f.status === 'ok'
                          ? 'no issues'
                          : f.status === 'warnings'
                            ? `${f.issues.length} warning${f.issues.length === 1 ? '' : 's'}`
                            : f.status === 'no-release-build'
                              ? 'no Release build'
                              : f.status === 'failed'
                                ? 'analysis failed'
                                : `${f.issues.length} error${f.issues.length === 1 ? '' : 's'}`}
                      </span>
                      {f.buildKey && (
                        <span className="font-mono text-xs opacity-40">
                          build {f.buildKey.slice(0, 8)}
                        </span>
                      )}
                      {/* What the target stage is running right now. ODC has no
                          "deployed where" read, so this is its deploy history. */}
                      <span
                        className={
                          f.alreadyLive
                            ? 'rounded bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-400'
                            : 'text-xs opacity-60'
                        }
                        title={f.deployedAt ? `Deployed ${f.deployedAt}` : undefined}
                      >
                        {f.deployed === undefined
                          ? `not in ${target?.name ?? 'the target stage'} yet`
                          : f.alreadyLive
                            ? `rev ${f.deployed} is already live — nothing to deploy`
                            : `live now: rev ${f.deployed}${f.deployedTag ? ` (${f.deployedTag})` : ''} → rev ${f.revision}`}
                      </span>
                      {/* Version, from ODC's highest *tagged* revision. `nextTag` is
                          the patch bump this release would carry. */}
                      <span className="text-xs opacity-60">
                        {f.highestTag
                          ? `version ${f.highestTag} → ${f.nextTag}`
                          : `never versioned → ${f.nextTag}`}
                      </span>
                    </div>
                  );
                  const detail = (
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {f.issues.map((i, n) => (
                        <li key={n} className="flex gap-2">
                          <span
                            className={
                              i.severity === 'Error'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {i.severity}
                          </span>
                          <span className="opacity-80">
                            {i.assetKey && (
                              <strong className="font-medium">
                                {nameOf(i.assetKey)}:{' '}
                              </strong>
                            )}
                            {i.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  );
                  const node = (
                    <div className="rounded border border-black/15 p-3 dark:border-white/15">
                      {/* ponytail: native <details> — no accordion state, and a check
                          with nothing to say has nothing to expand. Errors open by
                          default because they block the deploy. */}
                      {f.issues.length > 0 ? (
                        <details open={f.status !== 'warnings'}>
                          <summary className="cursor-pointer marker:opacity-50 [&>div]:inline-flex">{head}</summary>
                          {detail}
                        </details>
                      ) : (
                        head
                      )}
                    </div>
                  );
                  return { key: f.assetKey, node };
                })}
              />

              {/* On to step 6. The picks and the chosen order ride along as URL params
                  so the deploy step ships exactly what was checked here, in the order
                  it was approved in — not whatever is newest by then. */}
              <form id="approve" className="mt-6 flex flex-wrap items-center gap-3">
                <input type="hidden" name="v" value={v} />
                <input type="hidden" name="notes" value="1" />
                <input type="hidden" name="deploy" value="1" />
                <input type="hidden" name="check" value="1" />
                <input type="hidden" name="go" value="1" />
                {flights.map((f) => (
                  <input
                    key={f.assetKey}
                    type="hidden"
                    name={`rev.${f.assetKey}`}
                    value={f.revision}
                  />
                ))}
                <button
                  type="submit"
                  disabled={blocked}
                  className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
                >
                  Approve — deploy {willDeploy.length} app
                  {willDeploy.length === 1 ? '' : 's'} to {target?.name ?? 'the next stage'}
                </button>
                <span className="text-sm opacity-60">
                  {blocked
                    ? 'Blocked: fix the errors above first.'
                    : alreadyLive.length > 0
                      ? `${alreadyLive.length} already live and will be skipped.`
                      : 'Nothing is deployed until you press the button on the next step.'}
                </span>
              </form>
            </RefreshChecks>
          )}

          {/* Step 6 — the deploy itself, then the hand-off back to Jira. */}
          {step === 5 && toDeploy.length > 0 && target && (
            <>
              <p className="mt-4 text-sm opacity-60">
                {sp.parallel === '1'
                  ? 'All at once — ODC queues them in its own order.'
                  : 'One at a time, top to bottom. A failure stops the rest.'}
              </p>
              <ul className="mt-4 flex flex-col gap-1 text-sm">
                {toDeploy.map((r, i) => {
                  const rev = r.revs.find((x) => x.revision === r.selected);
                  return (
                    <li key={r.app} className="flex flex-wrap items-baseline gap-2">
                      {/* The list is only an order when they go one at a time. */}
                      {sp.parallel !== '1' && (
                        <span className="tabular-nums opacity-40">{i + 1}.</span>
                      )}
                      <span className="font-medium">{r.app}</span>
                      <span className="font-mono text-xs opacity-60">
                        rev {r.selected}
                        {rev?.tag ? ` · ${rev.tag}` : ''}
                      </span>
                      {r.selected === r.live && (
                        <span className="text-xs opacity-60">already live — skipped</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <DeployPanel
                v={v!}
                target={target.name}
                picks={Object.fromEntries(
                  toDeploy
                    .filter((r) => r.selected !== r.live)
                    .map((r) => [r.asset!.assetKey, r.selected])
                )}
                blocked={false}
                parallel={sp.parallel === '1'}
              />
            </>
          )}
        </section>
      )}
    </main>
  );
}
