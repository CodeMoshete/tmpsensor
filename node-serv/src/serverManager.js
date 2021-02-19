const debug = require('debug')('ohhell-server');
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
  fs.writeFileSync(currentTempLogFilePath, JSON.stringify(tempData));

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
