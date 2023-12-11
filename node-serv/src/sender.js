const serialport = require('serialport');
const debug = require('debug')('node-serv');
const chalk = require('chalk');
const axios = require('axios');
const SerialPort = require('serialport');

const portName = 'COM3';
const endpoints = {
  local: 'http://localhost:8088/temperatures',
  remote: 'http://18.191.101.1:8088/temperatures'
};

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
      axios.post(url, output);
    } catch (e) {
      debug(chalk.yellow(`Temperature update error: ${e}`));
    }
  });
};
