const serialport = require('serialport');
const debug = require('debug')('node-serv');
const chalk = require('chalk');
const axios = require('axios');
const SerialPort = require('serialport');

const portName = 'COM3';
// After `firebase deploy --only functions`, the CLI prints this function's URL
// (also visible via `firebase functions:list` or the Firebase console). It already
// ends in /temperatures (that's the function's name) -- paste it in as-is, e.g.
// https://us-central1-<project-id>.cloudfunctions.net/temperatures
const endpoints = {
  local: 'http://localhost:8088/temperatures',
  remote: 'https://temperatures-tjsqnvwopa-uc.a.run.app'
};

// Must match the value set via `firebase functions:secrets:set INGEST_API_KEY`.
// Set it in your shell before running the sender, e.g. `export TMPSENSOR_API_KEY=...`.
const apiKey = process.env.TMPSENSOR_API_KEY;

module.exports.listenForData = function listenForData(endpoint, serverName) {
  const baseEndpoint = endpoints[endpoint];
  const sp = new SerialPort(portName);
  const ReadLine = serialport.parsers.Readline;
  const parser = new ReadLine();
  sp.pipe(parser);
  parser.on('data', (input) => {
    try {
      const tempData = JSON.parse(input);
      const output = {
        server: serverName,
        sensorData: tempData
      };
      const dateTime = new Date((new Date()).getTime());
      output.dateTime = dateTime.toLocaleString();
      output.timeStamp = dateTime.getTime();

      const strOutput = JSON.stringify(output);
      debug(chalk.cyan(strOutput));

      const url = `${baseEndpoint}/log`;
      axios.post(url, output, { headers: { 'x-api-key': apiKey } });
      
    } catch (e) {
      debug(chalk.yellow(`Temperature update error: ${e}`));
    }
  });
};
