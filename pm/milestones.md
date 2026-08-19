# Jira Releaser — Milestones

Hackathon build. Target: gather Jira work for a release, generate technical +
customer-facing notes, review/approve them in a dashboard, deploy the release to
the next ODC stage via the CI/CD API.

**Scope: ODC only.** No OutSystems 11. The bonus feature is ODC-specific, so O11
scores nothing extra and costs a LifeTime environment plus environment/version/
zone key juggling.

**Board: `HAC` (HackTeamNL) = "Top Restaurants Tracker".** 25 issues, HAC-7 →
HAC-31. No other project, for now.

## The assignment, verbatim

**Description:** Automated release management and communications.

**Details:** Release assistant for OutSystems teams. It automatically gathers Jira
work belonging to a release, transforms it into technical release notes and
customer-friendly changelogs, gives teams a dashboard to review and approve the
generated content, and optionally deploys the approved release to the next
OutSystems stage using the ODC CI/CD APIs.

Contains integration with OutSystems CI/CD APIs, an agent to communicate with
Jira, a dual-persona copywriting agent (technical vs. business tone), and a
dashboard to approve and dispatch notes.

**Tools to use:**
- Connect to Atlassian MCP that we already have in Claude, and use related Jira MCP tools.
- Make use of OutSystems CI/CD APIs to deploy to next stage.

**Bonus feature:** Deploy release to next ODC stage through CI/CD API.

## Status

| # | Milestone | State |
|---|-----------|-------|
| 1 | Pick release → list its Jira issues in a table | **Built, unverified** |
| 2 | Dual-persona note generation (technical + business), side by side | **Built and verified end to end** |
| 3 | Review UI: inline edit, regenerate-with-feedback, Approve | **Inline edit + regenerate built**; Approve/deploy is milestone 6 |
| 4 | ODC read-only: list stages/assets/revisions, resolve "next stage" | **Built and verified against live ODC** |
| 5 | Pre-flight impact analysis as a deploy gate | Cut unless time allows |
| 6 | Write notes to revision → POST deployment → poll status | Not started |
| 7 | Write changelog to the Jira fixVersion description, mark released | In scope — *decided 2026-08-19*, replaces Teams dispatch |

Ship 1–3 and make them look good. 4 and 6 are the differentiator. 5 and 7 are
garnish.

## Brainfarts — how much Jira do we hand the agent?

Today: `getIssues` fetches per-ticket JSON, then `parseIssueApps` regexes the app
list out of a comment, and the plan is to hand the agent that *extracted* shape
(key, summary, status, description, apps).

The alternative is to hand the agent the **whole Jira JSON per ticket** and let it
figure out the apps itself. Worth thinking about because:

- **Argument for raw JSON.** The regex is the brittle part of milestone 1 — it
  already had to be loosened for "Outsytems", and the version syntax is a guess
  (see Decisions). A model reading the raw comment doesn't care about spelling,
  bullet markers, or whether someone wrote "Apps:" that sprint. It also sees
  everything we didn't think to extract: labels, links, subtasks, sprint,
  attachments, the comment thread arguing about scope — all of which is exactly
  the material good release notes come from. Zero parsing code to maintain.
- **Argument against.** Raw Jira JSON is enormous and mostly noise (avatar URLs,
  `customfield_10037: null` × 60, self-links). That's token cost per ticket, and
  it pushes the deploy set — the thing that decides *what we deploy to production* —
  into a non-deterministic path. A hallucinated app name is a failed deployment,
  not a typo in a paragraph. The regex is testable; the model isn't.

**Leaning:** split it by consequence, not by convenience.
- **Deploy set stays deterministic** — regex/parse, plus a UI that shows what it
  found so a human sees zero-apps before pressing deploy. Cheap and it's already built.
- **Prose gets more context** — for note generation, don't hand-pick fields; pass a
  trimmed-but-generous ticket (summary, description, status, labels, issue links,
  comment bodies). Trimming = drop the URL/avatar/null noise, keep the human text.

So: one `forAgent(issue)` that strips Jira's plumbing rather than whitelists five
fields, and keep `parseIssueApps` as the source of truth for the deploy set.

Follow-ons, unresolved:
- If the agent *does* read the comment thread, it may find app names the regex
  missed. Surface that as a "the agent also saw X" hint in the review UI rather
  than letting it change the deploy set silently?
- Whole-release-in-one-call vs one-call-per-ticket. One call sees cross-ticket
  themes ("this release is mostly the reviews rewrite") which is what a customer
  changelog actually wants; per-ticket parallelises and stays under context.
  Probably: per-ticket for technical notes (they're grouped by app anyway), one
  whole-release call for the customer changelog.
- Comments are unbounded and public-ish. Anything the agent reads can end up
  quoted in a customer changelog — the review step is the guard, so don't
  auto-dispatch (milestone 7) without it.

## Milestone 1 — done, not yet verified

- `lib/jira.ts` — `getProjects`, `getVersions(project)`, `getIssues(project, fixVersion)`.
  Jira REST **v2** (not v3) so descriptions come back as plain text and we skip
  writing an ADF walker. Paginated via `nextPageToken`. JQL string literals escaped.
- `lib/jira.test.ts` — escaping check. `npx tsx lib/jira.test.ts`.
- `app/page.tsx` — version dropdown + issue table. Server component, plain GET
  form, no client JS, no API route. Non-Done issues badged amber.

Verified against live Jira: `getVersions('HAC')` returns the release, `getIssues`
returns HAC-7, and its comment parses to the four apps. `npx tsx lib/jira.test.ts`
passes. `npx tsc --noEmit` is clean apart from a pre-existing `LayoutProps` error in
the create-next-app scaffolding, which resolves once Next generates `.next/types`.

Not yet verified: the rendered page. The dev server has not been run.

Note the fixVersion is spelled **"Realease Rick"** (typo, extra "a").

**Release contents, seeded 2026-08-19** — 7 issues, 5 Stories + 2 Bugs, all four apps,
several tickets per app:

| Issue | Type | Status | Apps |
|-------|------|--------|------|
| HAC-7 | Story | To Do | all four |
| HAC-8 | Story | To Do | Reviews, Library |
| HAC-9 | Story | **In Progress** | Reviews, Library |
| HAC-11 | Story | To Do | Restaurants, App |
| HAC-12 | Story | To Do | Restaurants |
| HAC-27 | Bug | To Do | Reviews |
| HAC-30 | Bug | To Do | Restaurants, Library |

HAC-9 is deliberately left In Progress so the dashboard's "not shipped yet" badge has
something to show. The seeding script is `.scratch/seed-release.mts` (gitignored,
idempotent — it skips issues that already carry an app comment).

The six new comments spell the header **correctly** ("OutSystems apps in release:")
while HAC-7 keeps its misspelled "Outsytems". The release now contains both spellings,
which is exactly what the loose header regex exists for.

## Milestone 2 — done, verified

`lib/notes.ts` — `generateNotes(issues, releaseVersion)` posts the whole release in
one call (cross-ticket themes are what a changelog wants) and returns
`{technical, business}` via `splitNotes`. `lib/notes.test.ts` covers the split.

`app/page.tsx` — a three-step wizard: 1. pick release → 2. review the Jira work and
the deploy set → 3. generate notes. The step is **derived from the URL** (`v` absent =
step 1, `v` = step 2, `v` + `notes=1` = step 3), so there is no step state to keep in
sync and every step is a shareable link. Still one GET form per step, no API route, no
client state, no markdown renderer (notes render in a `whitespace-pre-wrap` block).

`app/loading.tsx` — Next's route-level loading state covers both waits (Jira fetch,
~6-8s agent call). One fallback for the whole route; a per-step message would need a
Suspense boundary per section.

`app/markdown.tsx` — ~60-line renderer for the subset the agent emits (headings,
bullets, bold, code, rules). **No react-markdown**: it builds React elements, so agent
text — which can quote Jira comments — cannot inject markup. Tested in
`app/markdown.test.tsx`, including the escaping.

`app/notes-panel.tsx` — the only client component in the app. Edit toggles the panel
to a textarea, Revert restores the generated text. Session state only, per the
no-persistence decision; milestone 6 has to lift the edited text into the deploy call.

**Agent contract drifted again, 2026-08-19 (second time in a day):** the response
field is now `ReleaseNotes` — not `TechnicalReleaseNotes`, which is still what the
swagger says. That silently rendered both columns empty. `splitNotes` no longer names
the field: it takes the longest string in the response and splits that. Both personas
are still concatenated in the one field.

Verified 2026-08-19 against live Jira + the live agent: `/?v=Realease Rick&notes=1`
returns HTTP 200 with technical notes for all 7 issues in the left column and the
customer changelog in the right. `npx tsc --noEmit` clean, both test scripts pass.

## Milestone 4 — partly built

`lib/odc.ts`: `stages()`, `nextStage(stages, fromKey)`, `listApps()`. OAuth2 client
credentials, token endpoint read from `https://<domain>/identity/.well-known/openid-configuration`
and cached in module scope for its 12h life. `ODC_MOCK=1` short-circuits both reads.

Endpoints used (ODC public REST APIs):

| Need | Call |
|------|------|
| stages | `GET /api/portfolios/v2/environments` — ODC calls a stage an *environment*; `order` is the pipeline position |
| apps + libraries | `GET /api/asset-repository/v1/assets` — paged with `limit`/`offset` |

Not yet wired: revisions (`/assets/{key}/revisions`), builds
(`GET /api/builds/v1/build-operations?assetKey=&assetRevision=&byBuildType=Release`),
deploy (`POST /api/deployments/v1/deployment-operations`) and release notes
(`PUT /api/asset-repository/v1/assets/{key}/revisions/{n}/release-notes`) — those are
milestone 6.

**Verified against the live tenant (2026-08-19).** Both reads return real data.

Findings that shape milestones 5–6:

- All four app names in the HAC-7 comment resolve to real assets by **exact string
  match**. No fuzzy matching needed.
- A fifth asset exists — *Hackathon Rick&Fran - Release Notes Agent* (Agent, rev 1) —
  deployed to Dev but **not named in the Jira comment**. The comment is the deploy
  set, so it won't ship unless someone adds it.
- Stage `order` is **0 and 1000**, not 1 and 2. `nextStage` indexes the sorted array
  rather than doing arithmetic, which is why it survives this.
- Production holds **zero** Rick&Fran assets, so a demo Dev→Prod deploy is visible.
- **A revision can have a Debug build and no Release build.** Rev 3 of "- App" has
  both; the Dev deployment used the Debug one. Only `Release` builds are deployable,
  so milestone 6 must filter `byBuildType=Release` — and check it *before* Approve,
  or a deploy fails halfway through a four-asset fan-out.
- `release-notes` is `{tag, content}` and is `null` for all four assets. Empty today,
  filled by milestone 6 — a clean before/after for the demo.
- The tenant is shared: 486 assets across 11 types (WebApplication, LowCodeLibrary,
  Agent, Workflow, AIModelConnection, …). Filter, never list-all in the UI.

## The flow, end to end — agreed 2026-08-19

1. Pick a release (Jira fixVersion). *Built.*
2. Fetch its issues + comments; parse the ODC app list. *Built.*
3. POST the issues to the ODC release-notes agent, get both personas back.
4. Show them in the dashboard, edit inline, Approve.
5. On approve: write the technical notes to each asset revision's `release-notes`,
   write the customer changelog to the Jira fixVersion description, deploy each asset
   Dev → Production and poll to `Finished`, then mark the fixVersion released in Jira.

**Deploy is a fan-out, not one call.** `POST /deployment-operations` takes a single
`assetKey`, so a four-app release is four calls, each polled. Library first — the
three apps consume it.

## Decisions

- **No persistence at all** *(2026-08-19, agreed with Rick — supersedes the earlier
  "one JSON file per release under `.data/`")*. Approval lives in page state:
  generate → edit → approve → deploy in one session, reload starts over. The only
  state that isn't already Jira's or ODC's is one approval flag plus edited text,
  and a disk file wouldn't survive on Vercel anyway (ephemeral filesystem).
  Revisit with Vercel KV if the demo needs a reload to survive.
- **No `PlatformAdapter` interface.** One implementation is not an abstraction.
  `lib/odc.ts` with an `ODC_MOCK=1` short-circuit at the top of each function
  gives the same demo safety for ~zero code.
- **No note versioning / draft history.** Current content plus a status string.
  Regenerate overwrites.
- **Dashboard reads Jira over REST, not MCP.** *Agreed.* The Atlassian MCP
  connection in Claude Code is authenticated with an interactive OAuth session; a
  Vercel route handler has none, so using MCP as the app's runtime data path means
  implementing Atlassian OAuth 3LO. The brief's MCP requirement is better satisfied
  by the *agent* that interprets tickets (Messages API + remote Atlassian MCP
  server) than by the dashboard's plumbing.
- **ODC app versions come from a Jira comment, per ticket.** The list lives in a
  comment like:

  ```
  Outsytems apps in release:
  -Hackathon Rick&Fran - Library
  -Hackathon Rick&Fran - Restaurants
  -Hackathon Rick&Fran - Reviews
  -Hackathon Rick&Fran - App
  ```

  Each ticket carries **one or more ODC app versions**. Several tickets may reference
  the same app version, though usually they don't. Today only HAC-7 has a comment —
  that is test data, not the shape of a real release.

  Three functions in `lib/jira.ts`: `parseIssueApps(issue)` for one ticket,
  `releaseApps(issues)` for the deduped deploy set (milestone 6), and
  `appsToIssues(issues)` for reverse traceability (app version → tickets), which is
  what groups the technical release notes.

  Header matching is deliberately loose — the real comment reads "Outsytems".
  When this moves to a custom field, swap the function bodies; return shapes are
  unchanged. A configurator UI is explicitly deferred.
- **Version syntax is a guess.** No real example exists yet. `parseIssueApps`
  recognises a trailing dotted-numeric token, optionally prefixed with `v` or `@`
  (`MyApp 1.2`, `MyApp v1.2.3`, `MyApp @ 2.0`). A lone integer is *not* treated as a
  version, since `Portal 2` is more likely a name. Everything in today's data parses
  as a bare app name with no version, and the UI badges those amber. **Needs
  confirming — milestone 6 cannot deploy without a version.**
- **Statuses:** show them, badge anything not in a Done category, generate anyway.

## Open questions

- **The generator is an ODC Agent, not a direct Anthropic call** *(2026-08-19,
  decided by Rick)*. Endpoint:
  `POST https://personal-nrwxjjed-dev.outsystems.app/Releasenotesagent/rest/ReleaseNotes/V1/ReleaseNotes`
  Contract at `.../rest/ReleaseNotes/swagger.json`. Request is
  `{JiraIssues: [{IssueId, IssueType, Title, Description, AppsToRelease: [{Name, Version}]}]}`,
  which maps 1:1 onto `Issue` + `parseIssueApps`. Response is declared as
  `{TechnicalReleaseNotes, FriendlyReleaseNotes}`.

  This removes the Anthropic API key from the critical path — no `ANTHROPIC_API_KEY`
  is needed for milestone 2.

  Two caveats, both verified by live call on 2026-08-19 (10s round trip, HTTP 200):

  1. **The agent returns only `TechnicalReleaseNotes`.** `FriendlyReleaseNotes` is in
     the swagger but absent from the response, and *both* personas come back
     concatenated inside the one field under `## Technical Release Notes` and
     `## Business Release Notes` headings. Milestone 3's side-by-side review needs
     them separated. Fix belongs in the agent, not in a string-splitting parser here.
  2. **The endpoint is unauthenticated and on a different tenant**
     (`personal-nrwxjjed-dev`, not `productleague`). Anyone with the URL can spend
     tokens on it. Acceptable for a hackathon; not something to leave running after.

  **Contract drift, 2026-08-19:** the swagger now says `ComponentsToRelease` (was
  `AppsToRelease`) and `JiraIssue` gained `ReleaseVersion`. `lib/notes.ts` sends the
  current shape. Caveat 1 still holds — re-verified by live call, still one field.
  `lib/notes.ts` splits on the `## Business Release Notes` heading (`splitNotes`,
  tested in `lib/notes.test.ts`) and gets out of the way as soon as the agent starts
  populating `FriendlyReleaseNotes`. The proper fix is still in the agent.

  `ComponentsToRelease` takes a `Version` string, so the app-version convention in
  `lib/jira.ts` stays relevant — it currently sends `""` for every app.
- ODC tenant/portal domain and API client credentials — confirmed available,
  **not yet in `.env.local`**, so `lib/odc.ts` is unproven against a real tenant.
- **Is the app-version string worth keeping?** Two answers now pull apart: ODC
  deploys an asset *revision* (`assetKey` + `revision` + `buildKey`), which no human
  types into a comment — but the agent's `AppsToRelease` takes a `Version` string and
  currently receives `""`. Cheapest resolution: keep parsing it, feed it to the agent
  when present, and take the revision from the source stage for the actual deploy.
- ~~Should more HAC issues be assigned to the release?~~ **Done 2026-08-19** — 7
  issues, see the table above.
**Answered 2026-08-19 (Rick): yes.** Marking the fixVersion released is part of the
flow — but only *after* the ODC deploy reports `Finished`, never before. `PUT
/rest/api/2/version/{id}` with `released: true`. It's reversible from the Jira UI if
a demo run needs resetting.
