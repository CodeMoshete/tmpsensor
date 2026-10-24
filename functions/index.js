const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const receiver = require('./src/receiver');
const serverManager = require('./src/serverManager');
const { INGEST_API_KEY } = require('./src/config');

admin.initializeApp();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/', receiver);

// Exported as `temperatures`, mounted at the app root, so the deployed URL's
// paths line up exactly with the old `/temperatures/*` routes, e.g.
// https://<region>-<project>.cloudfunctions.net/temperatures/getCurrent
exports.temperatures = onRequest(
  { secrets: [INGEST_API_KEY], region: 'us-central1' },
  app
);

// Every minute, alert via ntfy if a house has stopped checking in (see
// checkForOfflineHouses for the thresholds).
exports.offlineCheck = onSchedule(
  { schedule: 'every 1 minutes', region: 'us-central1' },
  () => serverManager.checkForOfflineHouses()
);
