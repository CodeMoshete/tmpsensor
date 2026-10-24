const express = require('express');
const logger = require('firebase-functions/logger');
const serverManager = require('./serverManager');
const rollups = require('./rollups');
const { requireApiKey } = require('./auth');

const router = express.Router();

router.route('/log')
  .post(requireApiKey, async (req, res) => {
    try {
      logger.debug(`Logging temperature: ${JSON.stringify(req.body)}`);
      await serverManager.logTemperature(req.body);
      res.sendStatus(200);
    } catch (e) {
      logger.error(`Error logging temperature: ${e}`);
      res.sendStatus(500);
    }
  });

// https://<function-url>/getForDate?month=2&day=19&year=2021
router.route('/getForDate')
  .get(async (req, res) => {
    const { month, day, year } = req.query;
    if (month !== undefined && day !== undefined && year !== undefined) {
      const temperatureData = await serverManager.getTemperaturesForDate(
        parseInt(month, 10),
        parseInt(day, 10),
        parseInt(year, 10)
      );
      res.send(temperatureData);
    } else {
      res.sendStatus(404);
    }
  });

// https://<function-url>/getHistory?range=30d
// range is one of 7d, 30d (hourly averages) or 90d, 180d, 365d (daily averages).
router.route('/getHistory')
  .get(async (req, res) => {
    try {
      const history = await rollups.getHistory(req.query.range);
      if (!history) {
        res.status(400).send(`range must be one of: ${Object.keys(rollups.RANGES).join(', ')}`);
        return;
      }
      res.send(history);
    } catch (e) {
      logger.error(`Error reading history: ${e}`);
      res.sendStatus(500);
    }
  });

// https://<function-url>/getCurrent
router.route('/getCurrent')
  .get(async (req, res) => {
    const temperatureData = await serverManager.getLatestTemperature();
    res.send(temperatureData);
  });

// https://<function-url>/pauseAlerts   body: { "minutes": 60 }
// Requires x-api-key. Suppresses ntfy sends (readings/logging still happen)
// until the window elapses or /resumeAlerts is called.
router.route('/pauseAlerts')
  .post(requireApiKey, async (req, res) => {
    const minutes = parseInt(req.body && req.body.minutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      res.status(400).send('Provide a positive integer "minutes" in the JSON body.');
      return;
    }
    const pausedUntil = await serverManager.setAlertPause(minutes);
    res.send({ paused: true, pausedUntil });
  });

// https://<function-url>/resumeAlerts
// Requires x-api-key. Cancels an active pause immediately.
router.route('/resumeAlerts')
  .post(requireApiKey, async (req, res) => {
    await serverManager.clearAlertPause();
    res.send({ paused: false });
  });

// https://<function-url>/alertStatus
router.route('/alertStatus')
  .get(async (req, res) => {
    const status = await serverManager.getAlertStatus();
    res.send(status);
  });

router.route('/')
  .get(async (req, res) => {
    res.send('Server running!');
  });

module.exports = router;
