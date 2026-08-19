# CLAUDE.md

Working agreements for this repo. Read `pm/architecture.md` for how the code is put
together and `pm/milestones.md` for scope and status — don't duplicate them here.

## What this is

A hackathon build: a "custom LifeTime" for OutSystems teams. Pull the Jira tickets in
a release, generate technical release notes and a customer-friendly changelog, review
and approve them in a dashboard, then deploy the release to the next ODC stage via the
CI/CD APIs.

## Scope, fixed

- **Jira project `HAC`** ("HackTeamNL") = the Top Restaurants Tracker board. No other
  project. `PROJECT` is a const in `lib/jira.ts` — the deploy action needs it too.
- **OutSystems ODC only.** No OutSystems 11 — the bonus feature is ODC-specific, so
  O11 scores nothing and costs a LifeTime environment plus key juggling.
- Ship milestones 1–3 and make them look good. 4 and 6 are the differentiator. 5 and 7
  are garnish, cut them under time pressure.

## Commands

```bash
npm run dev                    # http://localhost:3000
npx tsx lib/jira.test.ts       # expects "jqlString ok" / "app parsing ok"
npx tsx lib/notes.test.ts      # expects "notes split ok"
npx tsx lib/odc.test.ts        # expects "preflight report ok"
npx tsx app/markdown.test.tsx  # expects "markdown ok"
npx tsc --noEmit
```

Env vars live in `.env.local` (see `.env.example`): `JIRA_BASE_URL`, `JIRA_EMAIL`,
`JIRA_API_TOKEN`. Server-only — never add `NEXT_PUBLIC_` to a credential.

## How to build here

The governing instinct is **stop at the first solution that works**. Every rule below
is a thing we decided not to build. Don't quietly reintroduce them.

- **No persistence at all.** Not Postgres, not Prisma, not a JSON file under
  `.data/`. Issues come from Jira per request, notes from the ODC agent per request,
  and approval is client state in the review page: generate → edit → approve →
  deploy, all in one session. A reload starts over, and that's fine for the demo.
  The one exception is `sessionStorage` under `jr:<release>:technical|business`, which
  exists only so the *approved note text* survives the walk from step 3 to the deploy
  step — per tab, overwritten on every keystroke, gone when the tab closes. Not a
  store: nothing reads it except the two actions that write notes out to ODC and Jira.
- **No adapter interfaces.** One implementation is not an abstraction. Demo safety for
  ODC comes from an `ODC_MOCK=1` early return inside each function, not an
  `OdcAdapter` / `MockAdapter` pair.
- **No API routes.** Server components await their own data. A route handler would add
  a network hop, a second serialisation, and a loading state to manage.
- **No note versioning or draft history.** Current content plus a status. Regenerating
  overwrites.
- **No new dependencies** for anything a few lines of stdlib or a native platform
  feature covers. The release picker is a plain `<form>` doing a GET, not a client
  component with state.
- **Mark deliberate shortcuts** with a `ponytail:` comment naming the ceiling and the
  upgrade path, so a reader can tell simplicity from oversight.

## Decisions already made — don't relitigate

- **The dashboard reads Jira over REST, not MCP.** *Agreed with Rick.* The Atlassian
  MCP server is authenticated by an interactive OAuth session, which a server-side
  route on Vercel does not have; using it as the runtime data path means implementing
  Atlassian OAuth 3LO. MCP's intended home is the *agent* that interprets tickets.
  MCP tools in the Claude Code session are for exploration during development, and
  are not a model for how the app fetches data.
- **Jira REST v2, not v3.** v3 returns rich text as ADF, a nested JSON tree needing a
  flattening walker. v2 returns descriptions and comment bodies as plain strings,
  which is what a language model wants anyway.
- **`jqlString` is `JSON.stringify`.** JQL escapes quotes and backslashes exactly as
  JSON does. Any version name interpolated into JQL must go through it — a quote in a
  version name would otherwise break out of the string literal.
- **`done` is derived from the status *category*, never the status name.** Status names
  are per-project config ("UAT PO Check", "Ready for development"); the category is
  always To Do / In Progress / Done.
- **ODC app versions come from a Jira comment, per ticket.** A ticket names one or
  more app versions under a header like `OutSystems apps in release:`. Several tickets
  may name the same app version, though usually not. Read via `parseIssueApps`,
  `releaseApps` (deduped deploy set), `appsToIssues` (traceability).
  - Header matching is **deliberately loose** — the real comment says "Outsytems",
    misspelled. Strictness parses zero apps from live data.
  - App names **contain " - "** ("Hackathon Rick&Fran - Library"), so bullet parsing
    strips only the leading marker and never splits on interior dashes.
  - This convention will move to a Jira custom field later. Swap the function bodies;
    keep the return types. A configurator UI is **explicitly deferred**.
- **Libraries never deploy.** They're packaged into the apps that consume them, so
  `deployable(asset)` in `lib/odc.ts` drops anything whose `assetType` contains
  `Library` from the deploy set — verified against the tenant: 69 Production `Deploy`
  ops, none of them a library. Keep them on screen, though: a library in the Jira
  comment is *why* the apps ship. A Release build doesn't distinguish them — libraries
  have those too.
- **A tag is unique per asset, so never re-send one.** `PATCH` with a tag the asset
  already has is `400 OS-APPS-40021 "Tag already in use"` — even on the revision that
  holds it. A *higher* tag replaces the old one on the same revision. So the deploy
  always writes `nextVersion(highestTag)`; deploying the same revision twice re-releases
  it as the next patch version, and that's the intended behaviour, not a bug.
- **Release notes and the version tag are set by one call:** `PATCH
  /api/asset-repository/v1/assets/{key}/revisions/{n}` with `{tag, releaseNotes}`.
  `.../release-notes` is **GET-only** (writes there 405 — that's the wrong endpoint, not
  a permissions problem). `releaseNotes` can't be sent without a `tag`, and the tag must
  be `Major.Minor.Patch` and higher than the current highest. Read the current one from
  `GET /assets/{key}/highest-tag-revision` — which **404s when an asset has never been
  tagged**, so treat 404 as "no version", not as an error.
- **The official spec is on GitHub**, not scrapeable from the docs site (that's a JS
  shell): `OutSystems/docs-odc`, `src/eap/reference/apis/resources/*-api-v1.json`.
  Copies of the ones we use are in `.scratch/`. Guessing paths wastes a probe cycle —
  the tag write took two wrong guesses before the spec settled it.
- **The deploy is a server action, and it trusts nothing from the browser.** `app/deploy.ts`
  takes only the release name and `{assetKey: revision}`; it re-derives the deploy set
  from Jira, resolves asset keys against ODC, filters libraries, falls back to the
  latest revision for anything it can't verify, and looks up the `buildKey` itself. The
  dashboard has no auth — keep it that way round.
- **ODC has no "what is deployed where" read.** The live revision in a stage comes from
  the newest finished `Deploy` operation in that asset's history (`deployedRevision` /
  `pickDeployed`). An already-live revision is shown as such and **skipped** by the
  deploy — re-checked in the action, not just the UI.
- **Revision default beats revision choice.** A release ships the **newest revision with
  a finished Release build** (`releasableRevision`, walks back 5), not whatever is newest
  — only Release builds deploy. The step-4 dropdown exists for the two cases the default
  can't cover: Dev has moved past the release, or Production needs rolling back. Newest
  10 revisions, annotated `latest` / `already live`. The deploy action re-derives the
  pick from `rev.<assetKey>` rather than trusting the browser, and skips already-live.
- **Deploys are sequenced by default, and the human picks.** They used to always all
  fire at once and let ODC queue them in whatever order it liked; ODC supports both.
  The pre-flight step has a **Deploy one at a time** checkbox, on by default. On:
  rows are draggable (whole row, native HTML5 drag — no DnD library) with ▲▼ as the
  keyboard path, the order rides to the deploy step as `?order=<assetKey>,…`, and
  `startNext`/`nextInQueue` start one deploy per poll round, so a producer can be
  made to land before its consumer; a failure parks the rest of the queue. Off:
  `?parallel=1`, every Deploy fires at once, and dragging is disabled because the
  order on screen would be a lie. Tagging always fans out; only deploys are
  serialised.
- **Statuses:** show them, badge anything not in a Done category, generate notes anyway.

## Gotchas learned the hard way

- **Bash heredocs in this environment collapse `\\` into `\`.** This silently corrupted
  a regex into `/\/g` — an unterminated literal that wouldn't parse. **Use the Write
  or Edit tool for any file containing backslashes** (regexes, escape sequences), and
  verify with `cat -A` if you must use a heredoc.
- **The fixVersion is spelled `Realease Rick`** — typo, extra "a". Real name, use it.
- **A misspelled fixVersion returns zero issues, not an error.** `/search/jql`
  silently yields nothing for an unknown version, so a typo looks exactly like an
  empty release.
- **Next memoizes identical `fetch` GETs within a single render — `cache: 'no-store'`
  does not opt out.** Any poll loop inside a server component must vary something per
  attempt (`lib/odc.ts` sends an `x-poll-attempt` header), or it re-reads its first
  answer forever. A standalone `tsx` probe won't reproduce it; only the app will.
- **The ODC builds service is `/api/builds/v1/build-operations`.** Not
  `/api/build-operations/v1/...`, which 404s. Check the spec's `servers` block for the
  base path, not the path key.
- **`npx tsc --noEmit` reports `Cannot find name 'LayoutProps'`** in `app/layout.tsx`.
  Pre-existing create-next-app scaffolding depending on a type Next generates into
  `.next/types`; it resolves after `next dev` or `next build`. Not your bug.
- **Top-level `await` needs a `.mts` extension** for `npx tsx` throwaway scripts, and
  `--env-file=.env.local` to pick up credentials.

## Verification standard

Run `npx tsx lib/jira.test.ts` and `npx tsc --noEmit` before claiming anything works.

Be precise about what was actually checked. "The data layer is verified against live
Jira, the rendered page is not" is the kind of statement that belongs in a summary —
don't let a passing typecheck stand in for having run the app. If a permission prompt
blocks a verification step, say so plainly rather than reporting the work as done.

Tests are plain `node:assert/strict` scripts run with `tsx`. No Jest, no Vitest, no
config, no fixtures. Test the logic with real edge cases; don't mock `fetch` to prove
that `fetch` was called.

## Branching and deploys

**Work directly on `main` for now.** It's a POC — a branch per change buys review
process we don't want yet. Optionally, for a change worth a second look, cut a branch
and open a PR into `main`; milestone 1 shipped that way (PR #1).

The Vercel project is git-linked, so this has teeth:

- push to `main` → **production** deploy, live immediately
- push any other branch, or open a PR → preview deploy on its own URL

So a push to `main` is a release. That's the intended POC tradeoff, not an accident —
but it means "commit to main" and "deploy to production" are the same action. Combined
with the rule below, the human decides when that happens.

Vercel Authentication is on, so deployment URLs need a Vercel login. Don't disable it:
the app has no auth of its own and serves Jira data through the server's API token.

Env vars are **not** settable over MCP — `JIRA_*` changes are dashboard-only, and they
only take effect on the *next* deploy, never on existing ones.

## Housekeeping

- Temp files — probes, diagram renders, throwaway scripts — go in **`.scratch/`**
  (gitignored). Not the repo root.
- Verify mermaid diagrams render before committing them:
  `npx -y -p @mermaid-js/mermaid-cli mmdc -i diagram.mmd -o out.svg`.
- Keep `pm/milestones.md` and `pm/architecture.md` current as decisions change —
  including reversing decisions that turn out wrong, with the reason.
- Don't commit or push unless asked.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
