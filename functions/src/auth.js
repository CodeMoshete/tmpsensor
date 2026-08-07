const logger = require('firebase-functions/logger');
const { INGEST_API_KEY } = require('./config');

// Guards routes that write data or change alert behavior. Reads (getCurrent,
// getForDate, alertStatus) stay open, same as the old EC2 setup.
module.exports.requireApiKey = function requireApiKey(req, res, next) {
  const expected = INGEST_API_KEY.value();
  if (!expected) {
    logger.error('INGEST_API_KEY secret is not configured for this function.');
    res.status(500).send('Server missing API key configuration');
    return;
  }

  const provided = req.get('x-api-key');
  if (provided !== expected) {
    res.sendStatus(401);
    return;
  }

  next();
};
