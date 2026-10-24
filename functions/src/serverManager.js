const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const axios = require('axios');
const logger = require('firebase-functions/logger');
const { HOUSE_TIMEZONE, houseMidnight } = require('./houseTime');
const { logWithRollups } = require('./rollups');

// How long a reading survives in `temperatureLogs` before Firestore's TTL policy
// reaps it. This only sets the per-document `expireAt` field -- the TTL policy
// itself is enabled once, out of band (see SETUP.md).
const LOG_RETENTION_DAYS = 30;

const TEMP_ALERT_THRESHOLD_F = 38.0;
const MOISTURE_ALERT_THRESHOLD = 1500;
const NTFY_TOPIC_URL = 'https://ntfy.sh/HomeAlerts-fortbouldermoshers';

const CURRENT_COLLECTION = 'currentTemperatures';
const LOG_COLLECTION = 'temperatureLogs';
const META_DOC = 'meta/alertState';

// Houses expected to check in. One silent for longer than OFFLINE_AFTER_MS gets
// an ntfy alert, repeated every OFFLINE_REPEAT_MS until it reports again. Listed
// explicitly (rather than every doc in currentTemperatures) so a retired or test
// sender doesn't alert forever -- add/remove names here when houses change.
const MONITORED_SERVERS = ['boulder', 'pheasant'];
const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const OFFLINE_REPEAT_MS = 60 * 60 * 1000;
// { <server>: { lastSeen, alertedAt } } for each house currently offline.
const OFFLINE_STATE_DOC = 'meta/offlineAlerts';

function db() {
  return getFirestore();
}

function formatHouseLocalTime(timeStampMs) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(timeStampMs));
}

// "7 min", "1 hr 7 min", "2 days 3 hr"
function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hr` : ''}`;
  if (hours > 0) return `${hours} hr${mins ? ` ${mins} min` : ''}`;
  return `${mins} min`;
}

async function sendAlert(alertMsg) {
  try {
    await axios.post(NTFY_TOPIC_URL, alertMsg);
  } catch (e) {
    logger.error(`Failed to send ntfy alert: ${e}`);
  }
}

async function isAlertingPaused() {
  const snap = await db().doc(META_DOC).get();
  if (!snap.exists) return false;
  const { pausedUntil } = snap.data();
  return !!pausedUntil && pausedUntil.toMillis() > Date.now();
}

// Evaluates one reading's sensors against the fixed thresholds and fires ntfy
// alerts for anything out of range, unless alerting has been manually paused.
async function checkAlerts(tempData) {
  const sensorDatas = tempData.sensorData;
  if (sensorDatas === undefined) return;

  const paused = await isAlertingPaused();

  for (let i = 0, count = sensorDatas.length; i < count; i += 1) {
    const sensorName = Object.keys(sensorDatas[i])[0];
    const sensorValue = sensorDatas[i][sensorName];
    let alertMsg = null;

    if (sensorName.startsWith('sensor') && sensorValue < TEMP_ALERT_THRESHOLD_F) {
      alertMsg = `ALERT: Temperature sensor ${sensorName} at location ${tempData.server} reading ${sensorValue}!`;
    } else if (sensorName.startsWith('m') && sensorValue < MOISTURE_ALERT_THRESHOLD) {
      alertMsg = `ALERT: Moisture sensor ${sensorName} at location ${tempData.server} reading ${sensorValue}!`;
    }

    if (alertMsg !== null) {
      logger.warn(alertMsg);
      if (paused) {
        logger.info(`Alerting is paused; suppressed: ${alertMsg}`);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await sendAlert(alertMsg);
      }
    }
  }
}

module.exports.logTemperature = async function logTemperature(tempData) {
  if (tempData.server === undefined) {
    logger.error(`Missing server name for ${JSON.stringify(tempData)}`);
    throw new Error('Missing server name');
  }

  const firestore = db();

  // Overwrites this server's "latest reading" doc -- backs getCurrent. receivedAt
  // is the server's clock, so the offline check doesn't depend on the sender's.
  const currentWrite = firestore.collection(CURRENT_COLLECTION).doc(tempData.server)
    .set({ ...tempData, receivedAt: Date.now() });

  // Appends to the historical log -- backs getForDate -- and folds the reading
  // into the hourly/daily rollups that back getHistory. expireAt is what the
  // Firestore TTL policy watches to auto-delete old raw readings; rollups are kept.
  const expireAt = Timestamp.fromMillis(Date.now() + LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const logWrite = logWithRollups({ ...tempData, expireAt });

  await Promise.all([currentWrite, logWrite]);
  await checkAlerts(tempData);
};

// Runs on a schedule (see index.js). Alerts once a monitored house has been
// silent for OFFLINE_AFTER_MS, re-alerts every OFFLINE_REPEAT_MS while it stays
// silent, and sends an all-clear when it reports again. Respects pauseAlerts: a
// suppressed alert isn't recorded as sent, so it goes out as soon as the pause ends.
module.exports.checkForOfflineHouses = async function checkForOfflineHouses() {
  const firestore = db();
  const now = Date.now();
  const stateRef = firestore.doc(OFFLINE_STATE_DOC);
  const [stateSnap, paused, ...currentSnaps] = await Promise.all([
    stateRef.get(),
    isAlertingPaused(),
    ...MONITORED_SERVERS.map((server) => firestore.collection(CURRENT_COLLECTION).doc(server).get())
  ]);
  const state = stateSnap.exists ? stateSnap.data() : {};
  const nextState = {};

  for (let i = 0; i < MONITORED_SERVERS.length; i += 1) {
    const server = MONITORED_SERVERS[i];
    const current = currentSnaps[i].exists ? currentSnaps[i].data() : null;
    // Fall back to the sender's timeStamp for docs written before receivedAt existed.
    const lastSeen = current ? (current.receivedAt || current.timeStamp || 0) : 0;
    const silentFor = now - lastSeen;
    const prev = state[server];
    let msg = null;

    if (silentFor > OFFLINE_AFTER_MS) {
      const lastText = lastSeen ? `last check-in ${formatHouseLocalTime(lastSeen)} ET` : 'no check-ins on record';
      if (!prev || !prev.alertedAt) {
        msg = `ALERT: ${server} has stopped reporting -- silent for ${formatDuration(silentFor)} (${lastText}).`;
      } else if (now - prev.alertedAt >= OFFLINE_REPEAT_MS) {
        msg = `ALERT: ${server} is still not reporting -- silent for ${formatDuration(silentFor)} (${lastText}).`;
      }
      const sent = msg !== null && !paused;
      nextState[server] = { lastSeen, alertedAt: sent ? now : ((prev && prev.alertedAt) || null) };
    } else if (prev && prev.alertedAt) {
      msg = `RESOLVED: ${server} is reporting again after ${formatDuration(lastSeen - prev.lastSeen)} offline.`;
    }

    if (msg !== null) {
      logger.warn(msg);
      if (paused) {
        logger.info(`Alerting is paused; suppressed: ${msg}`);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await sendAlert(msg);
      }
    }
  }

  // Skip the write when nothing changed, so a quiet minute costs only reads.
  if (JSON.stringify(nextState) !== JSON.stringify(state)) await stateRef.set(nextState);
};

module.exports.getTemperaturesForDate = async function getTemperaturesForDate(month, day, year) {
  // month/day/year is an Eastern-time calendar day. Each boundary uses the offset
  // in effect on its own side of midnight, so this stays correct across the
  // spring-forward/fall-back transition day itself.
  const startOfDay = houseMidnight(year, month, day);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endOfDay = houseMidnight(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());

  const snapshot = await db().collection(LOG_COLLECTION)
    .where('timeStamp', '>=', startOfDay)
    .where('timeStamp', '<', endOfDay)
    .orderBy('timeStamp')
    .get();

  return snapshot.docs.map((doc) => {
    const { expireAt, rolledUp, ...tempData } = doc.data();
    return { ...tempData, easternTime: formatHouseLocalTime(tempData.timeStamp) };
  });
};

module.exports.getLatestTemperature = async function getLatestTemperature() {
  const snapshot = await db().collection(CURRENT_COLLECTION).get();
  const result = {};
  snapshot.forEach((doc) => {
    result[doc.id] = doc.data();
  });
  return result;
};

module.exports.setAlertPause = async function setAlertPause(minutes) {
  const pausedUntil = Timestamp.fromMillis(Date.now() + minutes * 60 * 1000);
  await db().doc(META_DOC).set({ pausedUntil, pausedAt: Timestamp.now() });
  return pausedUntil.toDate().toISOString();
};

module.exports.clearAlertPause = async function clearAlertPause() {
  await db().doc(META_DOC).set({ pausedUntil: null });
};

module.exports.getAlertStatus = async function getAlertStatus() {
  const snap = await db().doc(META_DOC).get();
  if (!snap.exists) return { paused: false };
  const { pausedUntil } = snap.data();
  const paused = !!pausedUntil && pausedUntil.toMillis() > Date.now();
  return {
    paused,
    pausedUntil: paused ? pausedUntil.toDate().toISOString() : null
  };
};
