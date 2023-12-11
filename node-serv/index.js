const chalk = require('chalk');
const bodyParser = require('body-parser');
const cors = require('cors');
const debug = require('debug')('node-serv');
const express = require('express');
const path = require('path');// Load configuration
const sender = require('./src/sender.js');
const receiver = require('./src/receiver.js');

if (process.argv[2] === 'send') {
  const endpoint = process.argv[3] !== undefined ? process.argv[3] : 'remote';
  const serverName = process.argv[4] !== undefined ? process.argv[4] : 'boulder';
  sender.listenForData(endpoint, serverName);
} else if (process.argv[2] === 'receive') {
  global.appRoot = path.resolve(__dirname);
  const app = express();
  app.use(bodyParser.json()); // Set up express to use json parser.
  app.use(cors()); // Enable cross-origin resource sharing (web security thing).// Set up routing.
  app.use('/temperatures', receiver);
  app.use(express.static('./bin'));
  const listenPort = 8088;
  app.listen(listenPort, () => {
    debug(`Listening on port ${chalk.green(listenPort)}`);
  });
}
