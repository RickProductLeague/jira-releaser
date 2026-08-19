'use server';

// The one mutation in the app: fan out a Deploy operation per asset and poll it.
// Server actions rather than an API route — same reason the reads are in server
// components. The client sends only the release name and the revision it picked;
// everything that decides *what* ships is re-derived here from Jira and ODC.
import {
  findVersion,
  getIssues,
  PROJECT,
  releaseApps,
  setVersionDescription,
  versionUrl,
} from '@/lib/jira';
import {
  deployMessages,
  deployStatus,
  deployable,
  deployedRevision,
  highestTag,
  nextVersion,
  setVersion,
  listApps,
  nextInQueue,
  nextStage,
  releasableRevision,
  revisions,
  stages,
  startDeploy,
} from '@/lib/odc';

export type DeployOp = {
  app: string;
  assetKey: string;
  revision: number;
  /** Carried so polling can start the next queued op without re-deriving the stage. */
  targetKey?: string;
  operationKey?: string;
  status?: 'Queued' | 'Running' | 'Finished' | 'FinishedWithError' | 'AlreadyLive';
  error?: string;
  messages?: string[];
  /** Version tagged on the revision, and whether the notes went with it. */
  tag?: string;
  notesWritten?: boolean;
  tagError?: string;
};

export type DeployRun = { target?: string; ops: DeployOp[]; error?: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Start the deployment. `picks` is `{ [assetKey]: revision }` straight from the
 * browser, so nothing in it is trusted: the deploy set comes from the release's
 * Jira comments, the asset keys from ODC's repository, and a revision that isn't
 * in the asset's own revision list falls back to the latest. The Release build is
 * looked up inside `startDeploy`, never passed in.
 */
export async function launchDeploy(
  v: string,
  picks: Record<string, number>,
  /** The approved technical notes, written onto each revision before it deploys. */
  notes?: string,
  /** Fire every Deploy at once and let ODC queue them, instead of one at a time. */
  parallel = false
): Promise<DeployRun> {
  try {
    const [issues, assets, pipeline] = await Promise.all([
      getIssues(PROJECT, v),
      listApps(),
      stages(),
    ]);
    const target = nextStage(pipeline, pipeline[0]?.key);
    if (!target) return { ops: [], error: 'This tenant has no stage after the first one.' };

    const wanted = new Set(releaseApps(issues).map((r) => r.app.trim().toLowerCase()));
    const set = assets.filter((a) => wanted.has(a.name.trim().toLowerCase()) && deployable(a));
    if (set.length === 0) return { ops: [], error: 'Nothing deployable in this release.' };

    // The order the human put the rows in on the pre-flight step, as `picks` key
    // order. Sequential deploys run one at a time in it — a producer can be made to
    // land before its consumer, which is the whole point of letting them reorder.
    // In parallel mode it only decides what the list looks like; ODC picks the order.
    const order = Object.keys(picks);
    const rank = (k: string) => {
      const i = order.indexOf(k);
      return i < 0 ? order.length : i;
    };
    set.sort((x, y) => rank(x.assetKey) - rank(y.assetKey));

    // Tagging is independent per asset, so it still fans out; only the deploys
    // are sequenced (see `startNext`).
    const tagged = await Promise.all(
      set.map(async (a): Promise<DeployOp> => {
        const [revs, live] = await Promise.all([
          revisions(a.assetKey),
          deployedRevision(a.assetKey, target.key),
        ]);
        // Same rule as the UI: the newest revision with a Release build, unless the
        // caller named one that actually exists.
        const asked = picks[a.assetKey];
        const revision = revs.some((r) => r.revision === asked)
          ? asked
          : ((await releasableRevision(a.assetKey, revs)).revision || a.revision);
        // Version and release notes go on the revision *before* it deploys, which is
        // the order ODC's own CI/CD guidance uses — and they're written even when the
        // revision is already live, because the version describes the revision, not
        // the deployment.
        //
        // Always a fresh version, never the revision's existing tag: a tag is unique
        // per asset, so re-sending one is a 400 "Tag already in use" even on the very
        // revision that holds it, and release notes can't be sent without a tag. A
        // higher tag replaces the old one on the same revision, so a second Deploy of
        // the same revision re-releases it as the next patch version.
        const tag = nextVersion((await highestTag(a.assetKey))?.tag);
        let tagError: string | undefined;
        let notesWritten = false;
        try {
          await setVersion(a.assetKey, revision, tag, notes);
          notesWritten = Boolean(notes);
        } catch (e) {
          // A failed tag doesn't stop the deploy — the code still ships, it just
          // ships unlabelled, and the UI says so.
          tagError = msg(e);
        }

        const op = {
          app: a.name,
          assetKey: a.assetKey,
          revision,
          targetKey: target.key,
          tag,
          notesWritten,
          tagError,
        };

        // Re-checked here, not just in the pre-flight: redeploying the revision that
        // is already live is at best a no-op, and the browser could have asked for it
        // anyway. ponytail: no force-redeploy — the Portal has one.
        return { ...op, status: live?.revision === revision ? 'AlreadyLive' : 'Queued' };
      })
    );
    // Parallel: every Deploy goes at once and ODC queues them however it likes.
    // Sequential: only the first starts, and each poll round starts the next.
    return {
      target: target.name,
      ops: parallel
        ? await Promise.all(tagged.map((o) => (o.status === 'Queued' ? start(o) : o)))
        : await startNext(tagged),
    };
  } catch (e) {
    return { ops: [], error: msg(e) };
  }
}

/**
 * Write the approved customer changelog onto the Jira release. Deliberately its own
 * action, pressed after the deploy reports Finished — the changelog says "this is
 * live", so it shouldn't be written by anything that runs before the deploy does.
 * Does not mark the version released; that's a separate decision.
 */
export async function writeChangelogToJira(
  v: string,
  changelog: string
): Promise<{ url?: string; error?: string }> {
  try {
    if (!changelog.trim()) return { error: 'No changelog text to write.' };
    const version = await findVersion(PROJECT, v);
    if (!version) return { error: `No release named "${v}" in ${PROJECT}.` };
    await setVersionDescription(version.id, changelog);
    return { url: versionUrl(version.id) };
  } catch (e) {
    return { error: msg(e) };
  }
}

/**
 * Start the next queued deploy, if it's that op's turn. One at a time, in list
 * order, and the chain stops dead on a failure — the app after a broken one is
 * exactly the one you don't want going out unattended.
 * ponytail: the queue lives in the ops array the browser polls with, not in a job
 * table. It survives as long as the tab does, which is the length of a deploy.
 */
async function startNext(ops: DeployOp[]): Promise<DeployOp[]> {
  const i = nextInQueue(ops);
  if (i < 0) return ops;
  const started = await start(ops[i]);
  return ops.map((x, n) => (n === i ? started : x));
}

/** Hand one queued op to ODC. Both modes go through here. */
async function start(o: DeployOp): Promise<DeployOp> {
  try {
    return {
      ...o,
      operationKey: await startDeploy(o.assetKey, o.revision, o.targetKey!),
      status: 'Running',
    };
  } catch (e) {
    // Failing to start counts as a failure, so a sequential queue behind it stays
    // parked; in parallel mode the others are already away.
    return { ...o, status: undefined, error: msg(e) };
  }
}

/** One round of polling. Returns the same ops with fresh statuses. */
export async function pollDeploy(ops: DeployOp[]): Promise<DeployOp[]> {
  const fresh = await Promise.all(
    ops.map(async (o) => {
      if (!o.operationKey || o.status !== 'Running') return o;
      try {
        const { status } = await deployStatus(o.operationKey);
        return {
          ...o,
          status,
          messages:
            status === 'FinishedWithError'
              ? (await deployMessages(o.operationKey)).slice(-5)
              : undefined,
        };
      } catch (e) {
        return { ...o, error: msg(e) };
      }
    })
  );
  // Advances the sequential queue: the next app starts only once this one has
  // finished. A parallel run has nothing left Queued, so this is a no-op there.
  return startNext(fresh);
}
