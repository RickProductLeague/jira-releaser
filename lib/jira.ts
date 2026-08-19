// ponytail: Jira REST v2 (returns plain-text descriptions, no ADF walker needed).
// Atlassian MCP is the brief's preferred path — swap the body of jira() when the
// remote MCP OAuth token is in place; the exported signatures don't change.
const BASE = process.env.JIRA_BASE_URL;

function auth() {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!BASE || !JIRA_EMAIL || !JIRA_API_TOKEN)
    throw new Error('Missing JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN in .env.local');
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
}

async function jira(path: string) {
  const res = await fetch(`${BASE}/rest/api/2${path}`, {
    headers: { Authorization: auth(), Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Jira ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export type Version = { id: string; name: string; released: boolean; releaseDate?: string };

export type Issue = {
  key: string;
  type: string;
  summary: string;
  status: string;
  /** True when Jira's status category is Done — used to warn on unshipped work. */
  done: boolean;
  description: string;
  components: string[];
  labels: string[];
  priority: string;
  comments: string[];
  url: string;
};

export async function getProjects(): Promise<{ key: string; name: string }[]> {
  const { values } = await jira('/project/search?maxResults=100&orderBy=key');
  return values.map((p: any) => ({ key: p.key, name: p.name }));
}

export async function getVersions(project: string): Promise<Version[]> {
  const vs = await jira(`/project/${encodeURIComponent(project)}/versions`);
  return vs
    .filter((v: Version & { archived: boolean }) => !v.archived)
    .map((v: any) => ({ id: v.id, name: v.name, released: v.released, releaseDate: v.releaseDate }))
    .reverse();
}

/**
 * Quotes a JQL string literal. JQL escapes quotes and backslashes exactly the way
 * JSON does, so JSON.stringify is the whole implementation.
 */
export const jqlString = (s: string) => JSON.stringify(s);

export async function getIssues(project: string, fixVersion: string): Promise<Issue[]> {
  const jql = `project = ${jqlString(project)} AND fixVersion = ${jqlString(fixVersion)} ORDER BY key ASC`;
  const fields = 'summary,description,status,issuetype,components,labels,priority,comment';
  const out: Issue[] = [];
  let token: string | undefined;

  do {
    const page = await jira(
      `/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100` +
        (token ? `&nextPageToken=${encodeURIComponent(token)}` : '')
    );
    for (const i of page.issues ?? []) {
      out.push({
        key: i.key,
        type: i.fields.issuetype?.name ?? '',
        summary: i.fields.summary ?? '',
        status: i.fields.status?.name ?? '',
        done: i.fields.status?.statusCategory?.key === 'done',
        description: i.fields.description ?? '',
        components: (i.fields.components ?? []).map((c: any) => c.name),
        labels: i.fields.labels ?? [],
        priority: i.fields.priority?.name ?? '',
        comments: (i.fields.comment?.comments ?? []).map((c: any) => String(c.body ?? '')),
        url: `${BASE}/browse/${i.key}`,
      });
    }
    token = page.nextPageToken;
  } while (token);

  return out;
}

/** One ODC app version referenced by a ticket. */
export type OdcAppRef = { app: string; version?: string };

/** Stable identity for dedup and for keying UI rows. */
export const refKey = (r: OdcAppRef) => `${r.app}@${r.version ?? ''}`;

// Loose on purpose: the real comment says "Outsytems apps in release" (typo).
const APPS_HEADER = /apps\s+in\s+release|outs\w*\s+apps/i;

// ponytail: version syntax is a GUESS — no real example exists yet. Recognises a
// trailing dotted-numeric token, optionally prefixed with v or @
// ("MyApp 1.2", "MyApp v1.2.3", "MyApp @ 2.0"). Anything else parses as a bare app
// name with no version, which is what today's data does. Tighten once the real
// convention is known.
const TRAILING_VERSION = /^(.*?)[\s@]*[@v]?\s*(\d+(?:\.\d+)+)$/i;

function parseBullet(line: string): OdcAppRef | null {
  // Strip Jira/markdown escaping, then require a single leading bullet marker.
  // App names contain " - " themselves, so only the first marker is removed.
  const m = line.replaceAll('\\', '').trim().match(/^[-*•]\s*(.+)$/);
  if (!m) return null;

  const text = m[1].trim();
  const v = text.match(TRAILING_VERSION);
  return v && v[1].trim()
    ? { app: v[1].trim(), version: v[2] }
    : { app: text };
}

/**
 * The ODC app versions a ticket touches, read from a comment holding a bulleted
 * list under a header like "OutSystems apps in release:". A ticket can reference
 * more than one app version, and the same app version can appear on more than one
 * ticket.
 *
 * ponytail: convention over configuration. When this moves to a custom field,
 * replace this function body; the return shape stays the same.
 */
export function parseIssueApps(issue: Issue): OdcAppRef[] {
  const found = new Map<string, OdcAppRef>();

  for (const body of issue.comments) {
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((l) => APPS_HEADER.test(l));
    if (start === -1) continue;

    for (const line of lines.slice(start + 1)) {
      const ref = parseBullet(line);
      if (ref) found.set(refKey(ref), ref);
    }
  }

  return [...found.values()];
}

/**
 * Every distinct app version in the release — the deploy set for milestone 6.
 * Deduped, because unrelated tickets can touch the same app version.
 */
export function releaseApps(issues: Issue[]): OdcAppRef[] {
  const all = new Map<string, OdcAppRef>();
  for (const issue of issues) {
    for (const ref of parseIssueApps(issue)) all.set(refKey(ref), ref);
  }
  return [...all.values()];
}

/** Which tickets touch each app version — traceability for the release notes. */
export function appsToIssues(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const ref of parseIssueApps(issue)) {
      const k = refKey(ref);
      map.set(k, [...(map.get(k) ?? []), issue]);
    }
  }
  return map;
}
