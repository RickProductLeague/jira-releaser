# jira-releaser

Automated release management and communications for Jira-managed OutSystems (ODC) apps.

Reads a Jira project's fixVersions, lists the issues in a release, and derives the
**deploy set** — the distinct ODC app versions that release touches — from a bulleted
comment on each ticket.

Next.js 16 (App Router) · React 19 · Tailwind v4 · TypeScript. No database; Jira is the
only data source.

## Environment variables

All three are required. Without them the page renders an error box instead of the
dashboard — the app never crashes, it just can't reach Jira.

| Variable | Example | Notes |
| --- | --- | --- |
| `JIRA_BASE_URL` | `https://product-league.atlassian.net` | No trailing slash |
| `JIRA_EMAIL` | `rschrijver@product-league.com` | The Atlassian account owning the token |
| `JIRA_API_TOKEN` | `ATATT…` | [Create one here](https://id.atlassian.com/manage-profile/security/api-tokens) |

Locally they live in `.env.local` (gitignored). In production they must be set in
Vercel → Settings → Environment Variables, for every environment you care about
(Production, Preview, Development), then redeployed — env var changes do **not**
apply to existing deployments.

The Jira project is a single const — `PROJECT` in `app/page.tsx`.

## Local development

```bash
npm install
cp .env.example .env.local   # then paste your Jira API token
npm run dev                  # http://localhost:3000
```

Pick a release from the dropdown, hit **Load issues**.

```bash
npm run build          # production build
npm run start          # serve the production build
npx tsc --noEmit       # typecheck
npx tsx lib/jira.test.ts   # unit tests (assert-based, no framework)
```

The tests cover the two things worth covering: JQL string escaping (including the
injection case) and the ODC-comment parser. Everything else is a fetch wrapper.

## Deploy workflow

While this is a POC, work lands **directly on `main`**. For a change worth a second
look, cut a branch and open a PR into `main` instead — milestone 1 shipped that way.

The Vercel project is **git-linked**, so deploys are automatic:

- push to `main` → production deploy, live immediately
- push any other branch, or open a PR → preview deploy on its own URL

A push to `main` is therefore a release.

No CLI step, no manual upload. `app/page.tsx` is `force-dynamic` and makes no Jira
calls at build time, so a build succeeds even before env vars exist — the page just
shows its error box until they're set.

| | |
| --- | --- |
| Vercel project | `jira-releaser` (`prj_YfTvM7YEJ8PbhNkVsySAYtt3BQWU`) |
| Vercel account | `willems-projects-8214dfc1` (`team_iiOUOMkhxczSzs2yZedqyTxY`) |
| GitHub repo | [`RickProductLeague/jira-releaser`](https://github.com/RickProductLeague/jira-releaser) (personal account, public) |
| Dashboard | https://vercel.com/willems-projects-8214dfc1/jira-releaser |

### Access

Vercel Authentication is **enabled** (`all_except_custom_domains`), so deployment URLs
require a Vercel login. Keep it that way: the app has no auth of its own, and anyone
who can load the page reads Jira through the server's API token. If you attach a custom
domain, that domain is **not** covered by this setting — add password protection or
Trusted IPs before doing so.

## Working on this with Claude Code

Two MCP servers do real work here; neither is required to run the app.

**Vercel MCP** — deploys and diagnostics without leaving the terminal:

| Tool | Use |
| --- | --- |
| `list_projects`, `get_project` | find IDs, check framework detection |
| `list_deployments` | deploy state, target, source commit |
| `get_deployment_build_logs` | why a build failed (`errorsOnly: true`) |
| `get_runtime_errors`, `get_runtime_logs` | production errors |
| `get_project_deployment_protection` / `update_…` | read or change access settings |
| `create_git_project` | link a repo to a new project |

Two limits worth knowing, both hit while setting this project up:

1. **No env var tool exists.** Setting `JIRA_*` is dashboard-only.
2. **`create_git_project` cannot perform the GitHub App handshake.** It returns
   `repo_not_found` until Vercel has been granted access to the repo's owner account.
   Creating the project once via https://vercel.com/new is the fix; MCP handles
   everything afterwards.

Also note `teamId` is required on every call — the endpoint has no default team, so an
omitted ID doesn't fall back, it fails.

**Atlassian MCP** — the intended long-term path for Jira reads. Today `lib/jira.ts`
talks to Jira REST v2 directly with basic auth; swap the body of `jira()` when the OAuth
token is in place. The exported signatures don't change.
