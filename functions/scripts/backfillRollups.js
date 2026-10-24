// One-time backfill: folds every raw reading in `temperatureLogs` that predates
// the rollup code into the hourly/daily rollup buckets.
//
// Safe to re-run or resume after a crash: each log is marked `rolledUp` in the
// same transaction that adds it to its buckets, and logs already marked (by the
// live receiver or an earlier run) are skipped.
//
// Run from the functions/ directory with credentials that can reach Firestore:
//   gcloud auth application-default login
//   GCLOUD_PROJECT=<your-project-id> node scripts/backfillRollups.js
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const rollups = require('../src/rollups');

const PAGE_SIZE = 5000;
// Firestore allows 500 writes per transaction; an hour of one house's readings
// is ~60 logs + 2 buckets, so chunk anything unusual well under the limit.
const MAX_LOGS_PER_TX = 400;

admin.initializeApp();
const firestore = getFirestore();

async function loadPendingLogs() {
  const pending = [];
  let last = null;
  let scanned = 0;
  for (;;) {
    let query = firestore.collection('temperatureLogs').orderBy('timeStamp').limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    // eslint-disable-next-line no-await-in-loop
    const page = await query.get();
    if (page.empty) break;
    page.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.rolledUp && data.server) pending.push({ ref: doc.ref, data });
    });
    scanned += page.size;
    last = page.docs[page.docs.length - 1];
    process.stdout.write(`\rScanned ${scanned} logs, ${pending.length} need rolling up`);
  }
  process.stdout.write('\n');
  return pending;
}

// Groups logs by server + hour, so each transaction touches one hourly bucket,
// one daily bucket, and that hour's logs.
function groupByHour(logs) {
  const groups = new Map();
  logs.forEach((log) => {
    const time = rollups.readingTime(log.data);
    const key = `${log.data.server}_${Math.floor(time / 3600000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  });
  return [...groups.values()];
}

async function rollUpGroup(logs) {
  const { server } = logs[0].data;
  const buckets = rollups.bucketsFor(firestore, server, rollups.readingTime(logs[0].data));
  await firestore.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...buckets.map((b) => b.ref), ...logs.map((l) => l.ref));
    const bucketSnaps = snaps.slice(0, buckets.length);
    // Re-check inside the transaction in case another run got here first.
    const fresh = logs.filter((_, i) => {
      const snap = snaps[buckets.length + i];
      return snap.exists && !snap.data().rolledUp;
    });
    if (!fresh.length) return;
    const valueSets = fresh.map((l) => rollups.readingValues(l.data));
    bucketSnaps.forEach((snap, i) => {
      const { ref, bucketStart } = buckets[i];
      tx.set(ref, rollups.mergeBucket(snap.exists ? snap.data() : null, server, bucketStart, valueSets));
    });
    fresh.forEach((l) => tx.update(l.ref, { rolledUp: true }));
  });
}

async function main() {
  const pending = await loadPendingLogs();
  const groups = groupByHour(pending).flatMap((group) => {
    const chunks = [];
    for (let i = 0; i < group.length; i += MAX_LOGS_PER_TX) chunks.push(group.slice(i, i + MAX_LOGS_PER_TX));
    return chunks;
  });

  // Sequential on purpose: hours of the same day share a daily bucket, and
  // running them in parallel would just make those transactions contend.
  for (let i = 0; i < groups.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await rollUpGroup(groups[i]);
    if (i % 25 === 0 || i === groups.length - 1) {
      process.stdout.write(`\rRolled up ${i + 1} of ${groups.length} hour buckets`);
    }
  }
  process.stdout.write('\nDone.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
