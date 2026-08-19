# jira-releaser

Automated release management and communications for Jira-managed OutSystems (ODC) apps.

Reads a Jira project's fixVersions, lists the issues in a release, and derives the
deploy set — the distinct ODC app versions that release touches — from a bulleted
comment on each ticket.

## Getting started

```bash
npm install
cp .env.example .env.local   # then paste your Jira API token
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), pick a release, hit **Load issues**.

`JIRA_API_TOKEN` comes from
[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Without the three `JIRA_*` vars the page renders an error box instead of the dashboard.

The Jira project is a single const — `PROJECT` in `app/page.tsx`.

## Deploy

The page is `force-dynamic` and makes no Jira calls at build time, so the build
succeeds before any env var is set. Vercel auto-detects Next.js; no `vercel.json`.

### Via Vercel MCP (from Claude Code)

The Vercel MCP server is connected in this repo's Claude sessions, so a deploy is one
tool call — no dashboard, no CLI:

- `create_git_project` — links `RickProductLeague/jira-releaser` and creates a preview
  deployment from the production branch. Use this one; the repo already exists.
- `deploy_to_vercel` — uploads a file tree to a new project instead. Only for code
  that isn't in git.
- `list_deployments`, `get_deployment_build_logs`, `get_runtime_errors` — debug the
  deploy without leaving the terminal.

Three things MCP will *not* do for you:

1. **Push the code.** `create_git_project` builds whatever is on the GitHub production
   branch. Commit and push first, or you deploy an empty repo.
2. **Set env vars.** No MCP tool manages them. Add `JIRA_BASE_URL`, `JIRA_EMAIL`, and
   `JIRA_API_TOKEN` under Settings → Environment Variables, then redeploy.
3. **Pick the right account.** `teamId` is required and the connected token may not be
   the account you expect — run `list_teams` and check before creating the project.

### Access

New Vercel projects have Vercel Authentication **disabled**, and this app has no auth
of its own: anyone with the URL reads your Jira data through your token. Turn on
Vercel Authentication or password protection before sharing the link —
`update_project_deployment_protection` does it over MCP.
