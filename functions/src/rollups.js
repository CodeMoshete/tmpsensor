const { getFirestore } = require('firebase-admin/firestore');
const { houseDay } = require('./houseTime');

// Hourly and daily per-sensor aggregates, kept up to date as readings arrive, so
// long time ranges can be charted without reading every raw log. Unlike
// `temperatureLogs`, these have no expireAt and are kept indefinitely.
//
// Bucket doc: { server, bucketStart, sensors: { <name>: { n, sum, min, max } } }
// IDs: rollupsHourly/<server>_<hourStartMs>, rollupsDaily/<server>_<YYYY-MM-DD>
const HOURLY_COLLECTION = 'rollupsHourly';
const DAILY_COLLECTION = 'rollupsDaily';
const HOUR_MS = 60 * 60 * 1000;

// Chart ranges the dashboard offers beyond the last 24h (which uses raw logs).
const RANGES = {
  '7d': { days: 7, collection: HOURLY_COLLECTION, bucket: 'hour' },
  '30d': { days: 30, collection: HOURLY_COLLECTION, bucket: 'hour' },
  '90d': { days: 90, collection: DAILY_COLLECTION, bucket: 'day' },
  '180d': { days: 180, collection: DAILY_COLLECTION, bucket: 'day' },
  '365d': { days: 365, collection: DAILY_COLLECTION, bucket: 'day' }
};

function db() {
  return getFirestore();
}

// { sensor1: 60.1, m: 4423 } from a reading's [{ sensor1: 60.1 }, { m: 4423 }].
// Also accepts a plain { sensor1: 60.1 } object (some early test readings used
// it), and ignores anything else rather than failing the log write.
function readingValues(tempData) {
  const values = {};
  const { sensorData } = tempData;
  let entries = [];
  if (Array.isArray(sensorData)) entries = sensorData;
  else if (sensorData && typeof sensorData === 'object') entries = [sensorData];
  entries.forEach((entry) => {
    Object.entries(entry || {}).forEach(([name, raw]) => {
      const value = Number(raw);
      if (Number.isFinite(value)) values[name] = value;
    });
  });
  return values;
}

function readingTime(tempData) {
  return Number.isFinite(tempData.timeStamp) ? tempData.timeStamp : Date.now();
}

// The hourly and daily bucket refs (and starts) a reading at timeStampMs lands in.
function bucketsFor(firestore, server, timeStampMs) {
  const hourStart = Math.floor(timeStampMs / HOUR_MS) * HOUR_MS;
  const day = houseDay(timeStampMs);
  return [
    { ref: firestore.collection(HOURLY_COLLECTION).doc(`${server}_${hourStart}`), bucketStart: hourStart },
    { ref: firestore.collection(DAILY_COLLECTION).doc(`${server}_${day.key}`), bucketStart: day.start }
  ];
}

// Folds a list of { name: value } readings into an existing bucket's data.
function mergeBucket(existing, server, bucketStart, valueSets) {
  const sensors = { ...((existing && existing.sensors) || {}) };
  valueSets.forEach((values) => {
    Object.entries(values).forEach(([name, value]) => {
      const prev = sensors[name];
      sensors[name] = prev
        ? {
          n: prev.n + 1, sum: prev.sum + value, min: Math.min(prev.min, value), max: Math.max(prev.max, value)
        }
        : {
          n: 1, sum: value, min: value, max: value
        };
    });
  });
  return { server, bucketStart, sensors };
}

// Writes a raw log and folds it into its hourly and daily buckets in one
// transaction. The log is marked rolledUp so the backfill script never counts it
// a second time.
async function logWithRollups(logData) {
  const firestore = db();
  const time = readingTime(logData);
  const values = readingValues(logData);
  const buckets = bucketsFor(firestore, logData.server, time);
  const logRef = firestore.collection('temperatureLogs').doc();

  await firestore.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...buckets.map((b) => b.ref));
    snaps.forEach((snap, i) => {
      const { ref, bucketStart } = buckets[i];
      tx.set(ref, mergeBucket(snap.exists ? snap.data() : null, logData.server, bucketStart, [values]));
    });
    tx.set(logRef, { ...logData, rolledUp: true });
  });
}

// Bucketed history for one of RANGES, oldest first:
// { bucket: 'hour'|'day', since, points: [{ server, t, s: { name: [avg, min, max] } }] }
async function getHistory(rangeKey) {
  const range = RANGES[rangeKey];
  if (!range) return null;
  const since = Date.now() - range.days * 24 * HOUR_MS;
  // Filtering on bucketStart alone uses Firestore's automatic single-field index.
  const snapshot = await db().collection(range.collection)
    .where('bucketStart', '>=', since)
    .orderBy('bucketStart')
    .get();

  const round = (v) => Math.round(v * 100) / 100;
  const points = snapshot.docs.map((doc) => {
    const { server, bucketStart, sensors } = doc.data();
    const s = {};
    Object.entries(sensors || {}).forEach(([name, agg]) => {
      if (agg.n > 0) s[name] = [round(agg.sum / agg.n), round(agg.min), round(agg.max)];
    });
    return { server, t: bucketStart, s };
  });
  return { bucket: range.bucket, since, points };
}

module.exports = {
  HOURLY_COLLECTION,
  DAILY_COLLECTION,
  RANGES,
  readingValues,
  readingTime,
  bucketsFor,
  mergeBucket,
  logWithRollups,
  getHistory
};
