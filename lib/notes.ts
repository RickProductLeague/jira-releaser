// The generator is an ODC Agent, not a direct Anthropic call — decided 2026-08-19.
// Unauthenticated, on a different tenant (personal-nrwxjjed-dev), fixed for the
// hackathon. Contract: .../rest/ReleaseNotes/swagger.json
import { parseIssueApps, type Issue } from './jira';

const AGENT_URL =
  'https://personal-nrwxjjed-dev.outsystems.app/Releasenotesagent/rest/ReleaseNotes/V1/ReleaseNotes';

export type Notes = { technical: string; business: string };

// The agent's own heading for the business half. Loose on purpose — it has said
// "Business Release Notes" so far, but "Customer"/"Friendly" are one prompt tweak away.
const BUSINESS_HEADING = /^#{1,4}[ \t]*(business|customer|customer-friendly|friendly)\b.*$/im;

/**
 * ponytail: the agent declares TechnicalReleaseNotes + FriendlyReleaseNotes but
 * returns ONE field with BOTH personas concatenated inside it under
 * "## Technical Release Notes" / "## Business Release Notes" — and that field has
 * already been renamed once mid-hackathon (TechnicalReleaseNotes -> ReleaseNotes,
 * while the swagger still says the old name). So don't name it: take the longest
 * string in the response and split it on the heading. Use FriendlyReleaseNotes
 * verbatim if it's ever actually populated.
 * Ceiling: a prompt change that drops the heading collapses everything into the
 * technical column. Upgrade path: fix it in the agent, delete this.
 */
export function splitNotes(res: Record<string, unknown>): Notes {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const friendly = str(res.FriendlyReleaseNotes);
  const technical = Object.entries(res)
    .filter(([k]) => k !== 'FriendlyReleaseNotes')
    .map(([, v]) => str(v))
    .sort((a, b) => b.length - a.length)[0] ?? '';
  if (friendly) return { technical, business: friendly };

  const m = technical.match(BUSINESS_HEADING);
  if (m?.index === undefined) return { technical, business: '' };
  return {
    technical: technical.slice(0, m.index).trim(),
    business: technical.slice(m.index).trim(),
  };
}

/** One call for the whole release — cross-ticket themes are what a changelog wants. */
export async function generateNotes(issues: Issue[], releaseVersion: string): Promise<Notes> {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      JiraIssues: issues.map((i) => ({
        IssueId: i.key,
        IssueType: i.type,
        Title: i.summary,
        Description: i.description,
        ReleaseVersion: releaseVersion,
        ComponentsToRelease: parseIssueApps(i).map((r) => ({
          Name: r.app,
          Version: r.version ?? '',
        })),
      })),
    }),
  });
  if (!res.ok)
    throw new Error(`Release notes agent ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return splitNotes(await res.json());
}
