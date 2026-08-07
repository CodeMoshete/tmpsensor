const { defineSecret } = require('firebase-functions/params');

// Shared secret the sender device (and any manual admin call) must present via the
// `x-api-key` header on protected routes. Set the value once with:
//   firebase functions:secrets:set INGEST_API_KEY
module.exports.INGEST_API_KEY = defineSecret('INGEST_API_KEY');
