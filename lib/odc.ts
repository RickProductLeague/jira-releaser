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

async function odc(path: string) {
  const res = await fetch(`https://${DOMAIN}/api${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
    cache: 'no-store',
  });
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
