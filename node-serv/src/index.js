const serialport = require('serialport');
const debug = require('debug')('node-serv');
const chalk = require('chalk');
const SerialPort = require('serialport');

const portName = 'COM3';

const sp = new SerialPort(portName);
const ReadLine = serialport.parsers.Readline;
const parser = new ReadLine();
sp.pipe(parser);
parser.on('data', (input) => {
  const tempData = JSON.parse(input);
  debug(chalk.cyan(JSON.stringify(tempData, null, 2)));
});
