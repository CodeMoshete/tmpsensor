const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const axios = require('axios');
const logger = require('firebase-functions/logger');

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

// The house is on Eastern time -- getForDate's month/day/year is interpreted as an
// Eastern calendar day, and readings in its response get an added Eastern-local
// time string so swings can be read against time of day at a glance.
const HOUSE_TIMEZONE = 'America/New_York';

function db() {
  return getFirestore();
}

// Returns the UTC offset (in minutes, signed -- e.g. -240 for EDT, -300 for EST)
// in effect for the given Y/M/D in HOUSE_TIMEZONE. Probing at noon UTC keeps this
// clear of the DST-transition instant itself.
function getHouseUtcOffsetMinutes(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    timeZoneName: 'shortOffset'
  }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-4"
  const match = tzName.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1], 10) : -5; // fall back to EST
  return offsetHours * 60;
}

function formatHouseLocalTime(timeStampMs) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(timeStampMs));
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

  // Overwrites this server's "latest reading" doc -- backs getCurrent.
  const currentWrite = firestore.collection(CURRENT_COLLECTION).doc(tempData.server).set(tempData);

  // Appends to the historical log -- backs getForDate. expireAt is what the
  // Firestore TTL policy watches to auto-delete old readings.
  const expireAt = Timestamp.fromMillis(Date.now() + LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const logWrite = firestore.collection(LOG_COLLECTION).add({ ...tempData, expireAt });

  await Promise.all([currentWrite, logWrite]);
  await checkAlerts(tempData);
};

module.exports.getTemperaturesForDate = async function getTemperaturesForDate(month, day, year) {
  // month/day/year is an Eastern-time calendar day. Each boundary uses the offset
  // in effect on its own side of midnight, so this stays correct across the
  // spring-forward/fall-back transition day itself.
  const startOffsetMin = getHouseUtcOffsetMinutes(year, month, day);
  const startOfDay = Date.UTC(year, month - 1, day, 0, 0, 0) - startOffsetMin * 60000;

  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endOffsetMin = getHouseUtcOffsetMinutes(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate()
  );
  const endOfDay = Date.UTC(year, month - 1, day + 1, 0, 0, 0) - endOffsetMin * 60000;

  const snapshot = await db().collection(LOG_COLLECTION)
    .where('timeStamp', '>=', startOfDay)
    .where('timeStamp', '<', endOfDay)
    .orderBy('timeStamp')
    .get();

  return snapshot.docs.map((doc) => {
    const { expireAt, ...tempData } = doc.data();
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
