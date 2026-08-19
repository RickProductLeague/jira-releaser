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
  project. `PROJECT` is a const in `app/page.tsx`.
- **OutSystems ODC only.** No OutSystems 11 — the bonus feature is ODC-specific, so
  O11 scores nothing and costs a LifeTime environment plus key juggling.
- Ship milestones 1–3 and make them look good. 4 and 6 are the differentiator. 5 and 7
  are garnish, cut them under time pressure.

## Commands

```bash
npm run dev                    # http://localhost:3000
npx tsx lib/jira.test.ts       # expects "jqlString ok" / "app parsing ok"
npx tsx lib/notes.test.ts      # expects "notes split ok"
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
