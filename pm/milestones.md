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
| 5 | Pre-flight impact analysis as a deploy gate | **Built and verified against live ODC** |
| 6 | Write notes to revision → POST deployment → poll status | **Built. Version + notes write verified live; the deploy POST itself is still unfired** |
| 7 | Write changelog to the Jira fixVersion description, mark released | **Changelog write built and verified live. Step 7 built: mark released + mark all issues Done — not yet fired against live Jira** |

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

Wired by milestone 5: revisions, Release builds, deployment analysis (see below).
Still not wired: deploy (`POST /api/deployments/v1/deployment-operations`, needs
`assetKey` + `revision` + `buildKey` + `environmentKey`) and release notes
(`PUT /api/asset-repository/v1/assets/{key}/revisions/{n}/release-notes`) — milestone 6.

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

## Milestone 5 — done, verified

Steps 4 and 5 of the wizard, still derived from the URL: `deploy=1` = pick revisions,
`deploy=1&check=1` = pre-flight. Revision choices ride along as one
`rev.<assetKey>=<n>` param each, so a pre-flight run is a shareable link and there is
still no client state.

`lib/odc.ts` gained `revisions`, `releaseBuild`, `preflight` and `readReport`:

| Need | Call |
|------|------|
| revisions of an asset | `GET /api/asset-repository/v1/assets/{key}/revisions?limit=100` |
| Release build of a revision | `GET /api/builds/v1/build-operations?assetKey=&assetRevision=&byBuildType=Release` |
| impact analysis | `POST /api/dependency-management/v1/deployment-analyses` then poll `GET .../{analysisKey}` |

**Step 4** resolves each app name in the deploy set to an asset by exact name match
(case- and whitespace-insensitive), lists its revisions newest first and preselects
the latest. An app name with no matching asset is shown in red and blocks the gate. A
`rev.` param that isn't in the asset's revision list is ignored rather than trusted.

**Libraries are excluded from the deploy, not from the screen** *(2026-08-19, raised
by Rick)*. A library is consumed at build time and packaged into the apps that
reference it — it never deploys to a stage of its own. Checked against the tenant's
own history rather than assumed: of the 69 `Deploy` operations to Production, 62 are
WebApplication, 5 MobileApplication, 2 Agent, and **zero** any library type
(`.scratch/lib-deploy-probe2.mts`). So `deployable(asset)` = assetType doesn't contain
`Library`, and libraries render as a line of prose explaining why the apps ship.
Note that build type does *not* discriminate here — the Library's rev 3 has a
finished **Release** build, same as the apps, so `byBuildType=Release` would keep it.

**Step 5** runs, per selected revision: the Release-build check (a deploy needs a
`buildKey`, and a revision can have only a Debug build) and ODC's own deployment
analysis against the target stage. Errors and a missing Release build block; warnings
don't. Consumer/producer assets named in the report are resolved to names against the
whole asset list, not just the deploy set.

Gotchas found building it:

- **The builds service lives at `/api/builds/v1/build-operations`**, not
  `/api/build-operations/v1/...` — the latter 404s. The path is in the spec's
  `servers` block, not the path itself.
- **Next memoizes identical `fetch` GETs within one render, and `cache: 'no-store'`
  does not opt out.** The analysis poll therefore re-read its own first `InProgress`
  answer 20 times and every app reported "analysis did not finish". `odc()` now takes
  an attempt number and sends it as an `x-poll-attempt` header so each poll is a
  distinct request. Standalone `tsx` probes never hit this — only the app did.
- `POST /deployment-analyses` returns 200 with `{analysisKey}` (the spec says 201),
  and finishes in ~2s for these assets. Four in parallel is ~3s end to end.
- Live result today: three apps clean, "- App" reports one Warning,
  `Producer: MissingApplication — HackathonRickFranReviews` — Reviews isn't in
  Production yet. Exactly the kind of thing the gate exists to show, and it's a
  warning, not a block.

Verified 2026-08-19 against live Jira + live ODC: `/?v=Realease Rick&notes=1&deploy=1`
renders all four apps with revisions and the latest preselected; adding `&check=1`
returns HTTP 200 in ~3s with the four pre-flight results and the gate message. Pinning
`rev.<Reviews key>=1` is honoured. `npx tsx lib/odc.test.ts` covers `readReport`.

The Deploy button exists but is disabled — milestone 6 fills in the POST. Approving in
step 3 navigates, so edited note text is still lost on the way to step 4; that is the
same open problem the no-persistence decision parked, and milestone 6 owns it.

## What's already live — added 2026-08-19

**Question from Rick:** Restaurants rev 3 was already in Production and the pre-flight
happily offered it. Would ODC reject a redeploy of the revision it is already running?

Unproven either way — the POST is valid on paper (real revision, finished Release
build, real stage), so it would most likely be accepted as a no-op redeploy rather than
rejected, but confirming that means firing a live deployment. Cheaper to not ask the
question: the pre-flight now **shows what the target stage is running** and the deploy
skips anything that matches.

- `deployedRevision(assetKey, environmentKey)` reads the asset's deployment history for
  that stage — ODC has **no "what is deployed where" endpoint**
  (`/portfolios/v2/environments/{key}/assets` and
  `/asset-repository/v1/assets/{key}/deployments` both 404), so the newest *finished*
  `Deploy` operation is the answer. `pickDeployed` is the pure part: newest wins,
  `FinishedWithError` and `ApplyConfigs` don't count, and an `Undeploy` after the last
  Deploy means nothing is live. Tested in `lib/odc.test.ts`.
- Each pre-flight row now reads `not in Production yet`, `live now: rev 3 → rev 4`, or
  `rev 3 is already live — nothing to deploy`.
- Already-live apps are dropped from the deploy set, and `launchDeploy` re-checks
  server-side rather than trusting the count it was handed — it returns them as
  `AlreadyLive`, rendered "skipped — already live". No force-redeploy; the Portal has
  one if a demo needs it.

Verified live: pinning `rev.<Restaurants>=3` shows "already live" and the button drops
to "Deploy 2 apps to Production"; leaving it at the latest (rev 4 now exists) shows
`live now: rev 3 → rev 4` and offers all three.

## Milestone 6 — deploy built, notes write blocked

`lib/odc.ts` gained `startDeploy`, `deployStatus`, `deployMessages`. `app/deploy.ts`
is the app's **only mutation** — two server actions, still no API route:

- `launchDeploy(v, picks)` re-derives the deploy set from Jira and ODC and fires one
  `POST /deployments/v1/deployment-operations` per app, returning operation keys.
- `pollDeploy(ops)` refreshes each operation's status, and pulls the last five log
  messages for anything that ends `FinishedWithError`.

`app/deploy-panel.tsx` (client) confirms, calls `launchDeploy` in a transition, then
polls every 3s until nothing is `Running`. Blocking one action until Finished would
just burn the function timeout behind a spinner.

**Nothing from the browser is trusted.** `picks` is `{assetKey: revision}` and that is
all it is: the deploy set comes from the release's Jira comments, asset keys from ODC's
repository, libraries are filtered out, a revision that isn't in the asset's own
revision list falls back to the latest, and the `buildKey` is looked up inside
`startDeploy` rather than accepted as an argument. The dashboard is unauthenticated, so
a server action that took an assetKey and a buildKey on faith would deploy anything to
production for anyone with the URL.

**Version and release notes are now written, and verified against the live tenant.**
`setVersion(assetKey, revision, tag, releaseNotes)` PATCHes the revision before it
deploys — the order ODC's own CI/CD guidance uses — and does it even for a revision
that's already live, because the version describes the *revision*, not the deployment.
A failed tag doesn't stop the deploy: the code still ships, unlabelled, and the row
says so.

Two things the live run taught us:

- **A tag is unique per asset.** Re-sending the tag a revision already carries is
  `400 OS-APPS-40021 "Tag already in use"` — the first live run failed exactly there,
  on the app whose revision was already tagged `1.0.0`. A *higher* tag replaces the old
  one on the same revision (rev 4: `1.0.0` → `1.0.1`, and the old tag is gone). So the
  action always writes `nextVersion(highestTag)`, and deploying the same revision twice
  re-releases it as the next patch. Idempotency isn't available here; a fresh version is
  what ODC wants.
- **Release notes store verbatim.** Markdown goes in and comes back out of
  `GET .../release-notes` unchanged, alongside the tag. Whether the Portal *renders* the
  markdown is unverified — the existing value was HTML (`<p>first release</p>`).

Verified 2026-08-19 with `.scratch/launch-notag-probe.mts`, which runs the real
`launchDeploy` against live ODC but only when every app's pick is already live, so it
can tag and write notes without deploying: all three apps tagged (`1.0.2`, `0.1.2`,
`1.0.1`), notes written, all three `AlreadyLive`, no deployment fired.

**How the approved text gets there.** `NotesPanel` mirrors each persona to
`sessionStorage` under `jr:<release>:technical|business`; the deploy reads the technical
half, the Jira button reads the changelog. That closes the "edits are lost on the way to
the deploy step" hole this document flagged twice. Still per-tab and still gone on close
— see the persistence rule in CLAUDE.md.

**The earlier "not possible over the API" finding was wrong** — I had the wrong endpoint.
`.../revisions/{n}/release-notes` is GET-only (200 with `{tag, content}`, already
populated: `{"tag":"0.1.0","content":"<p>first release</p>"}`, HTML not markdown — the
old "null for all four assets" note is stale). Writes there 405 because release notes
are not their own resource. The real call, straight out of the official spec, is:

`PATCH /api/asset-repository/v1/assets/{assetKey}/revisions/{n}` with
`{tag, releaseNotes, commitMessage}` → 204.

Constraints from the spec: `releaseNotes` can't be sent without a `tag`, the tag must be
`Major.Minor.Patch`, and it has to be higher than the current highest. The API client
needs **Asset management > Change** or **Release management > Release**.

Not wired yet — the notes write is one PATCH away, but it also needs the approved note
text to survive the trip from step 3, which is still the open problem below.

Verified 2026-08-19 in `ODC_MOCK=1` via `.scratch/deploy-mock-probe.mts`: launch
returns three Running operations (library correctly excluded), one poll turns them
Finished, `rev 9999` falls back to the latest, and an unknown release refuses with
"Nothing deployable in this release." Step 5 against **live** ODC renders the enabled
"Deploy 3 apps to Production" button after a passing pre-flight.

**Not verified: a real deployment.** Pressing the button deploys to Production for
real, which is the human's call, not the agent's — so no live `POST
/deployment-operations` has been made. The mock path proves the wiring; the live path
proves itself the first time Rick clicks it.

## The revision picker: removed, then restored — 2026-08-19

**Rick:** a dropdown of every revision makes no sense when the one already in
Production can't be deployed anyway; just take the latest.

Agreed, with one correction to the rule: not *latest*, but **latest with a finished
Release build**. Only Release builds deploy, and a revision can have a Debug build and
no Release build — taking the newest blindly can hand the gate an undeployable pick with
no way forward now that there's no dropdown to escape through. `releasableRevision`
walks back at most 5 revisions to find one, and reports how many it passed over
(`newest with a Release build — skipped 2 newer`). If none of the 5 qualifies it returns
the latest anyway, so the pre-flight says "no Release build" about a real revision
instead of guessing.

(The already-live check is a weaker argument than it looks: it only rules out the *one*
revision currently live, not older ones. The reason there's nothing to choose is that a
release ships the newest thing that can ship.)

**Then restored, on the same day, with the default kept** — because there are two cases
the default genuinely can't cover:

1. **Dev has moved past the release.** Someone publishes after the release is cut, and
   the newest revision contains work that isn't in these Jira tickets. Shipping it
   because it's newest is shipping unreviewed work.
2. **Rollback.** Putting an earlier revision back into Production is a deploy like any
   other, and the wizard is where the deploy lives.

So step 4 keeps the dropdown, defaulted to the newest releasable revision, showing the
newest 10 (`rev 4 · 0.1.0 · 2026-08-19 · latest · already live`) with a note saying why
the default is what it is — `default: latest`, `default: newest with a Release build
(skipped 2 newer)`, `already live — will be skipped`, or `chosen`. Older than 10 is a
Portal job.

Deliberately *not* done: disabling options that have no Release build. That would cost a
build lookup per revision per app to grey out something the pre-flight already reports
one click later, in a screen whose whole job is running checks.

`launchDeploy` still re-derives the pick server-side and skips already-live revisions —
the dropdown is a suggestion to the action, not an instruction.

Verified live: step 4 renders three pickers, Restaurants' newest option annotated
`· latest · already live` with the row noting it will be skipped; pinning Reviews to
rev 2 still passes the gate and offers "Deploy 1 app to Production". **Not exercised
live:** the skipped-revisions line and the no-Release-build block — every revision of
these assets has a Release build, including rev 2.

## Versions in the pre-flight — added 2026-08-19

Asked for by Rick: show the version, the next version, and what version Production is
running. All three now sit in the pre-flight row.

- `highestTag(assetKey)` → `GET /asset-repository/v1/assets/{key}/highest-tag-revision`,
  ODC's own "what version is this app on". **404s when an asset has never been tagged**
  — normal here: Reviews and App have no tag, Restaurants and Library are both `0.1.0`.
  So the read is 404-tolerant (`odcMaybe`), and 404 means "no version".
- `nextVersion(tag)` is pure and tested: patch bump, and anything that isn't
  `Major.Minor.Patch` (or nothing at all) starts at `1.0.0`. Patch rather than minor
  because it's a suggestion for a human to confirm, and guessing low is easier to
  override than guessing high. No major/minor picker — add one when someone asks.
- The row now reads `rev 4 · untagged`, `version 0.1.0 → 0.1.1` (or
  `never versioned → 1.0.0`), and the live line carries the deployed revision's tag:
  `live now: rev 3 (0.1.0) → rev 4`.

Tags come out of the `revisions` list already fetched for that asset, so the only extra
call per app is `highest-tag-revision`.

Verified live: Restaurants shows `rev 4 · untagged`, `version 0.1.0 → 0.1.1`; Reviews
and App show `never versioned → 1.0.0`. `npx tsx lib/odc.test.ts` covers the bumps and
the junk-tag cases.

## Step 6, and the Jira hand-off — 2026-08-19

Asked for by Rick: a sixth wizard step that does the deployment, and a button that
writes the release notes to Jira with a link to the release.

- **Step 6 = Deploy** (`&go=1`). Step 5 ends in an *Approve — deploy N apps* submit that
  carries the revision pins as `rev.<assetKey>` params, so step 6 ships exactly what was
  checked rather than whatever is newest by the time the button is pressed. Step 6 lists
  what will ship, marks already-live rows as skipped, and holds the Deploy button and its
  polling. Pre-flight does not re-run there.
- **The Jira changelog button lives on step 3**, above the note panels — moved there on
  Rick's call, so the write happens where the text is visible and editable. It writes the
  *edited* changelog, links straight to the release, and is a separate action from the
  deploy on purpose.
  - Tradeoff of writing from step 3: Jira can carry the changelog before the deploy has
    happened. Acceptable because the description is prose, not a status — marking the
    version *released* is the claim that would need the deploy to have landed, and that
    is still not built.

Verified live 2026-08-19: `writeChangelogToJira` wrote a multi-line markdown changelog to
version `15924` ("Realease Rick"), which had **no** description before, and read back
byte-identical — newlines survive Jira v2. Step 3 renders the button, the hint and the
link to `/projects/HAC/versions/15924`.

**Still unverified: a real deployment.** Everything around it now is — tag, notes, Jira,
skip logic, polling in mock — but no live `POST /deployment-operations` has been fired by
this app. All three apps happen to be live at their picked revisions, which is why the
write path could be tested at all without deploying.

## Step 7 — close out in Jira — 2026-08-19

Asked for by Rick: a wizard step after the deploy holding two buttons — mark the release
released, and mark the work in it done.

- **Step 7 = Close out** (`&done=1`). It reads no ODC data at all, so the shared step-4/5/6
  ODC block is now bounded (`step >= 3 && step <= 5`) and step 7 renders its own section.
  `closeUrl` preserves every param already on the URL, so "Back to the deploy" returns to
  the same picks and order.
- **Two buttons, not one.** `markReleased` PUTs `{released: true, releaseDate: today}` on
  the fixVersion; `markIssuesDone` re-reads the release's issues from Jira and transitions
  each one that isn't already Done. A combined button would hide which of the two writes
  failed, which is the only useful information when one does.
- **The Done target is the status *category*, never a status name** (`doneTransition`
  filters `GET /issue/{key}/transitions` on `to.statusCategory.key === 'done'`) — same rule
  as `Issue.done`, because this board's statuses are named things like "UAT PO Check". An
  issue whose workflow offers no Done transition from where it is reports as *blocked* with
  its current status, not as an error.
- **Neither button checks that the deploy succeeded.** The step says so on screen. The link
  into step 7 lives inside `DeployPanel` — the only component that knows the run landed —
  and is the loud primary button only once every op is `Finished`/`AlreadyLive`, a dotted
  "Skip to close-out" otherwise (a reloaded tab has no ops but the release may well be out).
- **No test.** Both actions are a fetch and a status check; the only branch worth pinning
  is the category filter, and CLAUDE.md rules out mocking `fetch` to prove it was called.
  Typecheck plus the other three suites pass; the two writes are **unverified against live
  Jira**.

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

## Jira's named release-notes section is not writable — 2026-08-19

Rick marked the field he wanted with "Claude put the release notes in here please!" on the
release page. It is not the version description: it is a custom section on version ->
Release notes, named via "Give this section a name", and it is a rich-text area stored
outside the version object. Four independent reads found nothing — `/rest/api/2/version`,
`/rest/api/3/version`, both with and without expands, and the OAuth-authenticated
Atlassian MCP, which reports `description: ""`. The only release-notes endpoint is
`/version/{id}/relatedwork`, and per Atlassian it returns a title and category but never
the content. JSWCLOUD-25924 is the open request to expose it.

So the version **description** stays the automated target — it is the only writable text
field a version has — and the review step grew a **Copy changelog** button, because
pasting is the only route to that exact section. Same shape as the ODC release-notes
finding: the field the demo wants is read-only over the API, so a human paste closes it.

Fixed in the same pass: the agent emits markdown, which showed as literal `##` and `**`
on the release page. First attempt translated it to wiki markup; Rick's call was **plain
text, no formatting at all**, so `toPlainText` in `lib/jira.ts` strips the syntax instead
of converting it, applied inside `setVersionDescription` so every caller gets it. Bullets
keep a `-` marker (a list with no markers stops reading as a list) and links keep their
URL; everything else goes. Verified against live Jira on 2026-08-19 — written and read
back clean. Covered by `lib/jira.test.ts` ("plain text ok").

Second fix, same button: it read the changelog *only* from `sessionStorage`, so a reload
or a click before `NotesPanel` hydrated sent `""` and failed with "No changelog text to
write." `JiraChangelog` now takes the server-rendered changelog as a prop and falls back
to it, so there is always something to send; edits in the panel still win. It also no
longer disables itself permanently after a successful write — the text below is editable,
so a second write is a reasonable thing to want.


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
