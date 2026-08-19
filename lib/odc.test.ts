// npx tsx lib/odc.test.ts
import assert from 'node:assert/strict';
import { readReport } from './odc';

// An empty report is the happy path — ODC returns impactedAssets: [].
assert.equal(readReport({ impactedAssets: [], status: 'NoIssuesFound' }).status, 'ok');
assert.equal(readReport(null).status, 'ok');

// One warning must not block the deploy. Real shape, from the live tenant.
const warned = readReport({
  impactedAssets: [
    {
      assetKey: 'fff40c50',
      referenceType: 'Producer',
      applicationLevelIssues: [{ conflictType: 'MissingApplication', conflictSeverity: 'Warning', hint: 'HackathonRickFranReviews' }],
      elementLevelIssues: [],
    },
  ],
});
assert.equal(warned.status, 'warnings');
assert.deepEqual(warned.issues, [
  { severity: 'Warning', assetKey: 'fff40c50', text: 'Producer: MissingApplication — HackathonRickFranReviews' },
]);

// One error anywhere wins, whatever else is in the report.
const mixed = readReport({
  impactedAssets: [
    { assetKey: 'a', referenceType: 'Consumer', applicationLevelIssues: [{ conflictType: 'X', conflictSeverity: 'Warning' }] },
    { assetKey: 'b', elementLevelIssues: [{ name: 'GetReview', type: 'ServerAction', conflictType: 'SignatureChanged', conflictSeverity: 'Error' }] },
  ],
});
assert.equal(mixed.status, 'errors');
assert.equal(mixed.issues.length, 2);
assert.equal(mixed.issues[1].text, 'Impacted: ServerAction GetReview SignatureChanged');

console.log('preflight report ok');

// --- pickDeployed: what is live in a stage, read out of deployment history ---
import { pickDeployed } from './odc';

assert.equal(pickDeployed([]), undefined);

// Real shape from the tenant: one finished Deploy of rev 3.
assert.deepEqual(
  pickDeployed([
    {
      operation: 'Deploy',
      status: 'Finished',
      revisions: [3],
      finishedDateTime: '2026-08-19T14:10:56.387866Z',
    },
  ]),
  { revision: 3, at: '2026-08-19T14:10:56.387866Z' }
);

// Newest finished Deploy wins, whatever order the API returns them in.
assert.equal(
  pickDeployed([
    { operation: 'Deploy', status: 'Finished', revisions: [2], finishedDateTime: '2026-08-01T00:00:00Z' },
    { operation: 'Deploy', status: 'Finished', revisions: [5], finishedDateTime: '2026-08-19T00:00:00Z' },
    { operation: 'Deploy', status: 'FinishedWithError', revisions: [9], finishedDateTime: '2026-08-20T00:00:00Z' },
    { operation: 'ApplyConfigs', status: 'Finished', revisions: [7], finishedDateTime: '2026-08-21T00:00:00Z' },
  ])?.revision,
  5
);

// An Undeploy after the last Deploy means nothing is live.
assert.equal(
  pickDeployed([
    { operation: 'Deploy', status: 'Finished', revisions: [3], finishedDateTime: '2026-08-19T10:00:00Z' },
    { operation: 'Undeploy', status: 'Finished', finishedDateTime: '2026-08-19T11:00:00Z' },
  ]),
  undefined
);

console.log('deployed revision ok');

// --- nextVersion: the release version to tag next ---
import { nextVersion } from './odc';

assert.equal(nextVersion('0.1.0'), '0.1.1');
assert.equal(nextVersion('1.2.9'), '1.2.10'); // string bump, not 1.2.1
assert.equal(nextVersion('10.0.0'), '10.0.1');
// Never tagged, or anything ODC's Major.Minor.Patch rule wouldn't accept back.
assert.equal(nextVersion(undefined), '1.0.0');
assert.equal(nextVersion(''), '1.0.0');
assert.equal(nextVersion('0.1'), '1.0.0');
assert.equal(nextVersion('v0.1.0'), '1.0.0');
assert.equal(nextVersion('1.0.0-beta'), '1.0.0');

console.log('next version ok');

// --- nextInQueue: apps deploy one at a time, in the order the human set ---
import { nextInQueue } from './odc';

const q = (...s: (string | undefined)[]) => s.map((status) => ({ status }));

// Nothing started yet — the first in the list goes.
assert.equal(nextInQueue(q('Queued', 'Queued')), 0);
// One in flight — wait for it.
assert.equal(nextInQueue(q('Finished', 'Running', 'Queued')), -1);
// It landed — the next one goes, in list order, not asset order.
assert.equal(nextInQueue(q('Finished', 'Finished', 'Queued', 'Queued')), 2);
// Already-live apps are skipped over rather than deployed again.
assert.equal(nextInQueue(q('AlreadyLive', 'Queued')), 1);
// A failure parks the rest of the queue.
assert.equal(nextInQueue(q('FinishedWithError', 'Queued')), -1);
assert.equal(nextInQueue([{ status: undefined, error: 'no Release build' }, { status: 'Queued' }]), -1);
// All done.
assert.equal(nextInQueue(q('Finished', 'AlreadyLive')), -1);

console.log('deploy queue ok');
