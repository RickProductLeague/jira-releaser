import {
  getIssues,
  getVersions,
  parseIssueApps,
  refKey,
  releaseApps,
} from '@/lib/jira';

// ponytail: hardcoded to the Top Restaurants Tracker board. One const to change
// when a second project matters.
const PROJECT = 'HAC';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;

  let versions: Awaited<ReturnType<typeof getVersions>> = [];
  let issues: Awaited<ReturnType<typeof getIssues>> = [];
  let error: string | null = null;

  try {
    versions = await getVersions(PROJECT);
    if (v) issues = await getIssues(PROJECT, v);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const notDone = issues.filter((i) => !i.done).length;
  const odcApps = releaseApps(issues);
  const unmapped = issues.filter((i) => parseIssueApps(i).length === 0).length;

  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Jira Releaser</h1>
      <p className="mt-1 text-sm opacity-60">
        Top Restaurants Tracker &middot; project {PROJECT}
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">Release (fixVersion)</span>
          <select
            name="v"
            defaultValue={v ?? ''}
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
          Load issues
        </button>
      </form>

      {error && (
        <p className="mt-6 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {error}
        </p>
      )}

      {v && !error && (
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
                                <span className="ml-1 opacity-60">{ref.version}</span>
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
                        title={i.done ? undefined : 'Not in a Done status — may not actually ship'}
                      >
                        {i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
