# Jira Releaser — Milestones

Hackathon build. Target: gather Jira work for a release, generate technical +
customer-facing notes, review/approve them in a dashboard, deploy the release to
the next ODC stage via the CI/CD API.

**Scope: ODC only.** No OutSystems 11. The bonus feature is ODC-specific, so O11
scores nothing extra and costs a LifeTime environment plus environment/version/
zone key juggling.

**Board: `HAC` (HackTeamNL) = "Top Restaurants Tracker".** 25 issues, HAC-7 →
HAC-31. No other project, for now.

## Status

| # | Milestone | State |
|---|-----------|-------|
| 1 | Pick release → list its Jira issues in a table | **Built, unverified** |
| 2 | Dual-persona note generation (technical + business), side by side | Not started |
| 3 | Review UI: inline edit, regenerate-with-feedback, Approve | Not started |
| 4 | ODC read-only: list stages/assets/revisions, resolve "next stage" | Not started |
| 5 | Pre-flight impact analysis as a deploy gate | Cut unless time allows |
| 6 | Write notes to revision → POST deployment → poll status | Not started |
| 7 | Dispatch changelog (Teams, mark Jira version released) | Cut unless time allows |

Ship 1–3 and make them look good. 4 and 6 are the differentiator. 5 and 7 are
garnish.

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

Note the fixVersion is spelled **"Realease Rick"** (typo, extra "a"), and only HAC-7
is assigned to it.

## Decisions

- **No database.** One JSON file per release under `.data/`. A single-user demo
  does not need Neon or Prisma. Revisit when two people use it at once.
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

- Anthropic API key for the persona calls — not confirmed available. Blocks
  milestone 2.
- ODC tenant/portal domain and API client credentials — confirmed available,
  not yet supplied.
- **What does an app version actually look like in the comment?** Blocks milestone 6.
  Current parser guesses a trailing dotted-numeric token.
- Should more HAC issues be assigned to "Realease Rick" and given app comments, so
  the demo shows a realistic multi-ticket release rather than a single ticket?
