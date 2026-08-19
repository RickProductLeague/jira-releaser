// ODC public REST APIs. Two services matter here:
//   portfolios/v2      stages (ODC calls them "environments")
//   asset-repository/v1 apps + libraries ("assets")
// Auth is OAuth2 client credentials against the tenant's own identity server.
const DOMAIN = process.env.ODC_DOMAIN;

function creds() {
  const { ODC_CLIENT_ID, ODC_CLIENT_SECRET } = process.env;
  if (!DOMAIN || !ODC_CLIENT_ID || !ODC_CLIENT_SECRET)
    throw new Error('Missing ODC_DOMAIN / ODC_CLIENT_ID / ODC_CLIENT_SECRET in .env.local');
  return { id: ODC_CLIENT_ID, secret: ODC_CLIENT_SECRET };
}

// ponytail: module-scope token cache. Tokens last 12h; a serverless instance
// lives far less than that, so this is a per-instance memo, not a shared cache.
// Upgrade path if we ever get rate-limited: Vercel KV.
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const { id, secret } = creds();

  // The token endpoint is discovered, not hardcoded — ODC docs treat the
  // .well-known document as the contract.
  const disc = await fetch(`https://${DOMAIN}/identity/.well-known/openid-configuration`, {
    cache: 'no-store',
  });
  if (!disc.ok) throw new Error(`ODC discovery ${disc.status}: ${(await disc.text()).slice(0, 300)}`);
  const { token_endpoint } = await disc.json();

  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ODC token ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  // 60s of slack so a token can't expire mid-flight.
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cached.token;
}

async function odc(path: string, poll?: number) {
  const res = await fetch(`https://${DOMAIN}/api${path}`, {
    // Next memoizes identical GETs within one render — `cache: no-store` does not
    // opt out of that. A poll loop would then re-read its own first answer
    // forever, so each attempt sends a header that makes the request distinct.
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: 'application/json',
      ...(poll === undefined ? {} : { 'x-poll-attempt': String(poll) }),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ODC ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function odcMaybe(path: string) {
  const res = await fetch(`https://${DOMAIN}/api${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ODC ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** An ODC stage. `order` is the pipeline position — Development 1, Production last. */
export type Stage = {
  key: string;
  name: string;
  order: number;
  purpose?: string;
  status?: string;
};

/** An app or library in the asset repository. `revision` is the latest in Dev. */
export type Asset = {
  assetKey: string;
  name: string;
  /**
   * ODC's own string, not narrowed. Live tenant returns WebApplication,
   * MobileApplication, LowCodeLibrary, ExternalLibrary, ExtensionLibrary,
   * MobileLibrary, WidgetLibrary, Agent, Workflow, AIModelConnection,
   * ExternalConnection. Not an enum here — a new type shouldn't break the read.
   */
  assetType: string;
  revision: number;
  description?: string;
  tag?: string;
};

/**
 * Canned ODC reads instead of live calls — the demo safety net for a flaky tenant.
 * Read at call time, not module load, so it matches how lib/jira.ts reads its env.
 * The UI must say so out loud: mock data that looks like success is worse than an
 * error, since a "deployment" against mock keys does nothing and reports fine.
 */
export const odcMock = () => process.env.ODC_MOCK === '1';

// Real stage keys and orders — note `order` is 0 and 1000, not 1 and 2, so it
// sorts a pipeline but never indexes one.
const MOCK_STAGES: Stage[] = [
  { key: '2a9d1b60-ce1b-47e0-a8d5-3352a1389377', name: 'Development', order: 0, purpose: 'Development', status: 'Ready' },
  { key: '1c1e2ead-8ee3-4324-ad61-e740808a25a4', name: 'Production', order: 1000, purpose: 'Production', status: 'Ready' },
];

// Real keys, names and revisions from the live tenant on 2026-08-19, so the mock
// path exercises the same shapes the real one returns.
const MOCK_ASSETS: Asset[] = [
  { assetKey: '58ba5e54-464d-43d1-8981-e782b94c9a8d', name: 'Hackathon Rick&Fran - Library', assetType: 'LowCodeLibrary', revision: 3, tag: '0.1.0' },
  { assetKey: 'adb203f2-508c-4e8d-96ba-09116d99e7f4', name: 'Hackathon Rick&Fran - Restaurants', assetType: 'WebApplication', revision: 3 },
  { assetKey: 'fff40c50-04de-4d15-a325-9d460fe349e1', name: 'Hackathon Rick&Fran - Reviews', assetType: 'WebApplication', revision: 2 },
  { assetKey: '2d52db94-f792-43c1-90a8-934cbc4f7297', name: 'Hackathon Rick&Fran - App', assetType: 'WebApplication', revision: 3 },
];

/** Every stage in the tenant, ordered along the pipeline. */
export async function stages(): Promise<Stage[]> {
  if (odcMock()) return MOCK_STAGES;
  const { results } = await odc('/portfolios/v2/environments');
  return (results ?? [])
    .map((e: any) => ({
      key: e.key,
      name: e.name,
      order: e.order,
      purpose: e.purpose,
      status: e.status,
    }))
    .sort((a: Stage, b: Stage) => a.order - b.order);
}

/** The stage after `fromKey`, or undefined if it's the last one. */
export const nextStage = (all: Stage[], fromKey: string) =>
  all[all.findIndex((s) => s.key === fromKey) + 1];

/**
 * Libraries are not deployed to a stage — they are consumed at build time and
 * packaged into the apps that reference them. Evidence, not doctrine: of the 69
 * `Deploy` operations in this tenant's history, every one targets a
 * WebApplication, MobileApplication or Agent, and none a library type.
 * `.includes('Library')` covers LowCodeLibrary, ExternalLibrary,
 * ExtensionLibrary, MobileLibrary and WidgetLibrary in one predicate.
 */
export const deployable = (a: Asset) => !a.assetType.includes('Library');

/**
 * Every asset in the repository. This is the name → assetKey lookup that turns
 * the app names parsed out of Jira comments into something deployable.
 */
export async function listApps(): Promise<Asset[]> {
  if (odcMock()) return MOCK_ASSETS;

  const out: Asset[] = [];
  const limit = 100;
  // ponytail: offset paging, no page-object parsing — a short page means the end.
  for (let offset = 0; ; offset += limit) {
    const { results } = await odc(`/asset-repository/v1/assets?limit=${limit}&offset=${offset}`);
    for (const a of results ?? []) {
      out.push({
        assetKey: a.assetKey,
        name: a.name,
        assetType: a.assetType,
        revision: a.revision,
        description: a.description,
        tag: a.tag,
      });
    }
    if ((results?.length ?? 0) < limit) return out;
  }
}

async function odcPost(path: string, body: unknown) {
  const res = await fetch(`https://${DOMAIN}/api${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ODC ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** One revision of an asset. `tag` is the version a human typed, when tagged. */
export type Revision = {
  revision: number;
  tag?: string;
  createdAt?: string;
  commitMessage?: string;
};

/**
 * Set the release version and the release notes on a revision. One PATCH does both —
 * release notes are *not* their own writable resource (`.../release-notes` is GET
 * only, and writes there 405), and ODC refuses `releaseNotes` unless a `tag` comes
 * with it. The tag must be Major.Minor.Patch and higher than the asset's current
 * highest. Needs "Asset management > Change" or "Release management > Release".
 */
export async function setVersion(
  assetKey: string,
  revision: number,
  tag: string,
  releaseNotes?: string
): Promise<void> {
  if (odcMock()) return;
  const res = await fetch(
    `https://${DOMAIN}/api/asset-repository/v1/assets/${assetKey}/revisions/${revision}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
      },
      // Only send releaseNotes when there's something to send — an empty string
      // would wipe whatever the Portal already shows.
      body: JSON.stringify(releaseNotes ? { tag, releaseNotes } : { tag }),
      cache: 'no-store',
    }
  );
  if (!res.ok)
    throw new Error(
      `ODC ${res.status} tagging rev ${revision} as ${tag}: ${(await res.text()).slice(0, 300)}`
    );
}

/** Every revision of an asset, newest first — the deployable candidates. */
export async function revisions(assetKey: string): Promise<Revision[]> {
  if (odcMock())
    return [
      { revision: 3, tag: '0.1.0', createdAt: '2026-08-19T11:57:54Z' },
      { revision: 2, createdAt: '2026-08-19T11:52:23Z' },
      { revision: 1, createdAt: '2026-08-19T11:51:55Z' },
    ];
  const { results } = await odc(`/asset-repository/v1/assets/${assetKey}/revisions?limit=100`);
  return (results ?? [])
    .map((r: any) => ({
      revision: r.revision,
      tag: r.tag ?? undefined,
      createdAt: r.createdAt,
      commitMessage: r.commitMessage ?? undefined,
    }))
    .sort((a: Revision, b: Revision) => b.revision - a.revision);
}

/**
 * The Release build of a revision, or undefined if it only has a Debug build.
 * A deployment needs a `buildKey`, and only Release builds are deployable — this
 * is the check that stops a four-asset fan-out failing halfway through.
 */
export async function releaseBuild(assetKey: string, revision: number) {
  if (odcMock()) return { buildKey: 'mock-build-key', status: 'Finished' };
  const { builds } = await odc(
    `/builds/v1/build-operations?assetKey=${assetKey}&assetRevision=${revision}&byBuildType=Release`
  );
  const b = (builds ?? []).find((x: any) => x.status === 'Finished');
  return b ? { buildKey: b.buildKey as string, status: b.status as string } : undefined;
}

/**
 * The revision of an asset currently live in a stage, from its deployment history —
 * ODC has no "what is deployed where" read, so the newest finished Deploy wins.
 * Exported for lib/odc.test.ts.
 */
export function pickDeployed(results: any[]): { revision: number; at?: string } | undefined {
  const done = (results ?? [])
    .filter((o) => o.operation === 'Deploy' && o.status === 'Finished' && o.revisions?.length)
    .sort((a, b) => String(b.finishedDateTime).localeCompare(String(a.finishedDateTime)));
  const last = done[0];
  // Undeploy after the last Deploy means nothing is live any more.
  const undeployed = (results ?? []).some(
    (o) =>
      o.operation === 'Undeploy' &&
      o.status === 'Finished' &&
      String(o.finishedDateTime) > String(last?.finishedDateTime)
  );
  if (!last || undeployed) return undefined;
  return { revision: Math.max(...last.revisions), at: last.finishedDateTime };
}

/** What's live in this stage right now, or undefined if the asset has never shipped. */
export async function deployedRevision(assetKey: string, environmentKey: string) {
  if (odcMock())
    // Mirrors the live tenant: Restaurants rev 3 is in Production, nothing else is.
    return assetKey === 'adb203f2-508c-4e8d-96ba-09116d99e7f4'
      ? { revision: 3, at: '2026-08-19T14:10:56Z' }
      : undefined;
  const { results } = await odc(
    `/deployments/v1/deployment-operations?environmentKey=${environmentKey}&assetKey=${assetKey}`
  );
  return pickDeployed(results);
}

/**
 * The highest **tagged** revision of an asset — ODC's own answer to "what version
 * is this app on". 404s when the asset has never been tagged, which is normal:
 * two of the four hackathon apps have no tag at all.
 */
export async function highestTag(assetKey: string) {
  if (odcMock())
    return assetKey === 'fff40c50-04de-4d15-a325-9d460fe349e1'
      ? undefined
      : { revision: 3, tag: '0.1.0', taggedAt: '2026-08-19T11:59:42Z' };
  const r = await odcMaybe(`/asset-repository/v1/assets/${assetKey}/highest-tag-revision`);
  return r ? { revision: r.revision as number, tag: r.tag as string, taggedAt: r.taggedAt as string } : undefined;
}

/**
 * The version to release next: a patch bump of the highest tag. ODC requires
 * `Major.Minor.Patch`, so anything that doesn't parse (or no tag at all) starts at
 * 1.0.0. Patch, not minor, because a wrong guess low is easier to override than a
 * wrong guess high — the version is a suggestion for a human to confirm.
 * ponytail: no minor/major choice in the UI. Add a radio group when someone asks.
 */
export function nextVersion(tag?: string): string {
  const parts = (tag ?? '').split('.').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return '1.0.0';
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * The revision this release should ship: the newest one with a finished Release
 * build. Not simply the newest — a revision can have a Debug build and no Release
 * build, and only Release builds deploy, so blindly taking the latest can hand the
 * gate an undeployable pick with no way forward.
 * ponytail: walks back at most WALK revisions. Further than that and the asset
 * hasn't been published for release in a long time — say so rather than paging.
 */
const WALK = 5;

export async function releasableRevision(
  assetKey: string,
  revs: Revision[]
): Promise<{ revision: number; buildKey?: string; skipped: number }> {
  const window = revs.slice(0, WALK);
  for (const [i, r] of window.entries()) {
    const build = await releaseBuild(assetKey, r.revision);
    if (build) return { revision: r.revision, buildKey: build.buildKey, skipped: i };
  }
  // Nothing releasable in the window: fall back to the latest so the pre-flight
  // reports "no Release build" against a real revision instead of guessing.
  return { revision: revs[0]?.revision ?? 0, skipped: window.length };
}

export type PreflightIssue = {
  severity: 'Warning' | 'Error';
  /** The asset the issue is *about* — a consumer or producer, not the one deploying. */
  assetKey?: string;
  text: string;
};

export type Preflight = {
  app: string;
  assetKey: string;
  revision: number;
  buildKey?: string;
  /** Revision live in the target stage now, if any, and when it got there. */
  deployed?: number;
  deployedAt?: string;
  /** Version tags: the picked revision's, the live one's, the highest ever, the next. */
  tag?: string;
  deployedTag?: string;
  highestTag?: string;
  nextTag?: string;
  /** True when the selected revision is already the live one — nothing to deploy. */
  alreadyLive?: boolean;
  /** `errors` and `no-release-build` block the deploy; `warnings` does not. */
  status: 'ok' | 'warnings' | 'errors' | 'no-release-build' | 'failed';
  issues: PreflightIssue[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ODC's own impact analysis for one asset revision against a target stage, plus
 * the Release-build check. Two ~1s calls and a poll; the analysis takes a few
 * seconds and reports what breaks in the consumers of what we're about to ship.
 */
export async function preflight(
  app: string,
  assetKey: string,
  revision: number,
  environmentKey: string
): Promise<Preflight> {
  const [build, live, revs, highest] = await Promise.all([
    releaseBuild(assetKey, revision),
    deployedRevision(assetKey, environmentKey),
    revisions(assetKey),
    highestTag(assetKey),
  ]);
  const tagOf = (n?: number) => revs.find((r) => r.revision === n)?.tag;
  const base = {
    app,
    assetKey,
    revision,
    deployed: live?.revision,
    deployedAt: live?.at,
    alreadyLive: live?.revision === revision,
    tag: tagOf(revision),
    deployedTag: tagOf(live?.revision),
    highestTag: highest?.tag,
    nextTag: nextVersion(highest?.tag),
  };
  if (!build)
    return {
      ...base,
      status: 'no-release-build',
      issues: [
        {
          severity: 'Error',
          text: `Revision ${revision} has no finished Release build. Publish it for release in ODC first.`,
        },
      ],
    };

  if (odcMock()) return { ...base, buildKey: build.buildKey, status: 'ok', issues: [] };

  const { analysisKey } = await odcPost('/dependency-management/v1/deployment-analyses', {
    assetKey,
    revision,
    environmentKey,
  });

  // ponytail: poll, no webhook. Live runs finish in 2-4s; 30s is generous.
  let result: any = null;
  for (let i = 0; i < 20; i++) {
    result = await odc(`/dependency-management/v1/deployment-analyses/${analysisKey}`, i);
    if (result.processStatus !== 'InProgress') break;
    await sleep(1500);
  }

  if (result?.processStatus !== 'Finished')
    return {
      ...base,
      buildKey: build.buildKey,
      status: 'failed',
      issues: [
        {
          severity: 'Error',
          text: result?.error?.detail ?? `Analysis did not finish (${result?.processStatus ?? 'timed out'}).`,
        },
      ],
    };

  return { ...base, buildKey: build.buildKey, ...readReport(result.report) };
}

/**
 * Flatten an ODC deployment-analysis report into the gate's answer. Errors block
 * the deploy, warnings don't — which is the whole point of separating them.
 * Exported for lib/odc.test.ts; the report shape is the part worth testing.
 */
export function readReport(report: any): { status: Preflight['status']; issues: PreflightIssue[] } {
  const issues: PreflightIssue[] = [];
  for (const a of report?.impactedAssets ?? []) {
    const where = a.referenceType ?? 'Impacted';
    for (const i of a.applicationLevelIssues ?? [])
      issues.push({
        severity: i.conflictSeverity,
        assetKey: a.assetKey,
        text: `${where}: ${i.conflictType}${i.hint ? ` — ${i.hint}` : ''}`,
      });
    for (const i of a.elementLevelIssues ?? [])
      issues.push({
        severity: i.conflictSeverity,
        assetKey: a.assetKey,
        text: `${where}: ${i.type ?? 'Element'} ${i.name} ${i.conflictType}${i.hint ? ` — ${i.hint}` : ''}`,
      });
  }
  return {
    status: issues.some((i) => i.severity === 'Error')
      ? 'errors'
      : issues.length > 0
        ? 'warnings'
        : 'ok',
    issues,
  };
}

/**
 * Ask ODC to deploy one asset revision to a stage. Returns the operation key to
 * poll — the deployment itself runs for minutes on ODC's side.
 * Deliberately takes no `buildKey` from its caller: it looks the Release build up
 * itself, so a browser can't hand us a build that belongs to another revision.
 */
export async function startDeploy(
  assetKey: string,
  revision: number,
  environmentKey: string
): Promise<string> {
  const build = await releaseBuild(assetKey, revision);
  if (!build) throw new Error(`Revision ${revision} has no finished Release build`);
  if (odcMock()) return `mock-op-${assetKey}`;

  const op = await odcPost('/deployments/v1/deployment-operations', {
    operation: 'Deploy',
    assetKey,
    revision,
    buildKey: build.buildKey,
    environmentKey,
  });
  return op.key;
}

export type DeployStatus = {
  status: 'Running' | 'Finished' | 'FinishedWithError';
  assetName?: string;
  finishedAt?: string;
};

/** One poll of a deployment operation. `Running` means keep asking. */
export async function deployStatus(operationKey: string, attempt = 0): Promise<DeployStatus> {
  if (odcMock()) return { status: 'Finished', assetName: 'mock asset' };
  const op = await odc(`/deployments/v1/deployment-operations/${operationKey}`, attempt);
  return {
    status: op.status,
    assetName: op.assetName,
    finishedAt: op.finishedDateTime,
  };
}

/** Log lines ODC recorded for a deployment — the only detail on a failure. */
export async function deployMessages(operationKey: string): Promise<string[]> {
  if (odcMock()) return [];
  const { results } = await odc(`/deployments/v1/deployment-operations/${operationKey}/messages`);
  return (results ?? []).map((m: any) =>
    [m.severity, m.message ?? m.text].filter(Boolean).join(': ')
  );
}

/**
 * Which deploy goes next. Apps ship one at a time in list order so a producer can
 * be made to land before its consumer, so: nothing while one is Running, nothing
 * more once one has failed (the app after a broken one is exactly the one you
 * don't want going out unattended), otherwise the first still queued.
 * Pure, and lives here rather than in the action so it can be tested without ODC.
 */
export function nextInQueue(ops: { status?: string; error?: string }[]): number {
  if (ops.some((o) => o.status === 'Running')) return -1;
  if (ops.some((o) => o.status === 'FinishedWithError' || o.error)) return -1;
  return ops.findIndex((o) => o.status === 'Queued');
}
