const chalk = require('chalk');
const debug = require('debug')('node-serv');
const path = require('path');
const fs = require('fs');

module.exports.logTemperature = function logTemperature(tempData) {
  const dateSuffix = tempData.dateTime.split(',')[0].split('/').join('-');
  const temperatureLogName = `log-${dateSuffix}`;
  const temperatureLogBasePath = path.join(global.appRoot, 'temperature-logs');

  if (!fs.existsSync(temperatureLogBasePath)) {
    fs.mkdirSync(temperatureLogBasePath, { recursive: true });
  }

  const currentTempLogFilePath = path.join(temperatureLogBasePath, 'currentTemp');
  let currentTempData = {};
  if (fs.existsSync(currentTempLogFilePath)) {
    debug('Current temp file exists...');
    currentTempData = JSON.parse(fs.readFileSync(currentTempLogFilePath));
    if (currentTempData.sensorData !== undefined) {
      debug(chalk.yellow('Obsolete data format!'));
      const newTempData = {
        boulder: currentTempData
      };
      currentTempData = newTempData;
    }
  } else {
    debug(`Missing temp log file ${currentTempLogFilePath}`);
  }

  if (tempData.serverName !== undefined) {
    currentTempData[tempData.serverName] = tempData;
  } else {
    debug(chalk.red(`Missing server name for ${JSON.stringify(tempData)}`));
  }

  fs.writeFileSync(currentTempLogFilePath, JSON.stringify(currentTempData));

  const temperatureLogFilePath = path.join(temperatureLogBasePath, temperatureLogName);
  let logContents = [];
  if (fs.existsSync(temperatureLogFilePath)) {
    logContents = JSON.parse(fs.readFileSync(temperatureLogFilePath));
  }
  logContents.push(tempData);

  debug(`SET GAME STATE: ${temperatureLogFilePath}`);
  fs.writeFileSync(temperatureLogFilePath, JSON.stringify(logContents));
};

module.exports.getTemperaturesForDate = function getTemperaturesForDate(month, day, year) {
  const temperatureLogName = `log-${month}-${day}-${year}`;
  const temperatureLogBasePath = path.join(global.appRoot, 'temperature-logs');

  const temperatureLogFilePath = path.join(temperatureLogBasePath, temperatureLogName);
  let logContents = [];
  if (fs.existsSync(temperatureLogFilePath)) {
    logContents = JSON.parse(fs.readFileSync(temperatureLogFilePath));
  }

  return logContents;
};

module.exports.getLatestTemperature = function getLatestTemperature() {
  const temperatureLogBasePath = path.join(global.appRoot, 'temperature-logs');
  const currentTempLogFilePath = path.join(temperatureLogBasePath, 'currentTemp');
  let logContents = {};
  if (fs.existsSync(currentTempLogFilePath)) {
    logContents = JSON.parse(fs.readFileSync(currentTempLogFilePath));
  }
  return logContents;
};
