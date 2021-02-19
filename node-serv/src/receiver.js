/* eslint-disable prefer-destructuring */
const debug = require('debug')('node-serv');
const express = require('express');
const util = require('util');
const serverManager = require('./serverManager.js');

const router = express.Router();

router.route('/log')
  .post(async (req, res) => {
    debug(`Logging temperature: \n${util.inspect(req.body)}`);
    serverManager.logTemperature(req.body);
    res.sendStatus(200);
  });

// http://localhost:8088/temperatures/getForDate?month=2&day=19&year=2021
router.route('/getForDate')
  .get(async (req, res) => {
    const month = req.query.month;
    const day = req.query.day;
    const year = req.query.year;
    if (month !== undefined && day !== undefined && year !== undefined) {
      const temperatureData =
        serverManager.getTemperaturesForDate(parseInt(month, 10), parseInt(day, 10), parseInt(year, 10));
      res.send(temperatureData);
    } else {
      res.sendStatus(404);
    }
  });

// http://localhost:8088/temperatures/getCurrent
router.route('/getCurrent')
  .get(async (req, res) => {
    const temperatureData = serverManager.getLatestTemperature();
    res.send(temperatureData);
  });

router.route('/')
  .get(async (req, res) => {
    res.send('Server running!');
  });

module.exports = router;
