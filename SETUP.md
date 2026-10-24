# Deploying the receiver to Firebase Functions

You already have a Blaze-plan project shell. This walks through everything else,
in order. Run all commands from the repo root unless noted.

## 1. Point the Firebase CLI at your project

```bash
firebase login          # if you haven't already
firebase use --add      # pick your project from the list, alias it "default"
```

This creates a `.firebaserc` file (gitignored-safe to commit, it just records
the alias -> project ID mapping).

## 2. Create the Firestore database (one-time, console)

The Firestore database itself isn't created automatically. In the
[Firebase console](https://console.firebase.google.com/) → your project →
**Firestore Database** → **Create database** → **Native mode** → pick a region
(e.g. `us-central1`, matching the function's region in `functions/index.js`).

## 3. Set the shared secret

This is the value the sender device (and you, for the pause/resume endpoints)
must send as the `x-api-key` header. Generate a random one and store it in
Secret Manager via the Firebase CLI:

```bash
openssl rand -hex 32     # copy this value
firebase functions:secrets:set INGEST_API_KEY
# paste the value when prompted
```

Keep that value somewhere safe (password manager) — you'll need it again in
step 6.

## 4. Install function dependencies

```bash
cd functions
npm install
cd ..
```

## 5. Deploy

```bash
firebase deploy --only functions,firestore:rules
```

The CLI will print the deployed function's URL at the end, something like:

```
https://us-central1-<your-project-id>.cloudfunctions.net/temperatures
```

Copy that down — it replaces the old `http://<ec2-ip>:8088/temperatures` URL.

## 6. Enable the log TTL (one-time)

Firestore's TTL policy is what makes old readings in `temperatureLogs`
auto-delete after 30 days. It isn't set via `firebase.json` — configure it
either:

- **Console:** Firestore Database → your database → **TTL** tab → **Create
  policy** → collection group `temperatureLogs`, field `expireAt`.
- **gcloud CLI**, if you have it installed:
  ```bash
  gcloud firestore fields ttls update expireAt \
    --collection-group=temperatureLogs \
    --enable-ttl \
    --project=<your-project-id>
  ```

Until this is enabled, old logs just accumulate (harmless, just uses more
Firestore storage than intended).

## 7. Point the sender at the new URL

Edit `node-serv/src/sender.js`:

```js
const endpoints = {
  local: 'http://localhost:8088/temperatures',
  remote: 'https://us-central1-<your-project-id>.cloudfunctions.net/temperatures', // <-- from step 5
};
```

Then, wherever you run the sender (the machine with the Arduino attached), set
the API key you generated in step 3 as an environment variable before
launching it:

```bash
export TMPSENSOR_API_KEY=<the value from step 3>
node index.js send remote boulder
```

## 8. Smoke test

```bash
# Public reads still work with no auth:
curl https://us-central1-<your-project-id>.cloudfunctions.net/temperatures/getCurrent
curl https://us-central1-<your-project-id>.cloudfunctions.net/temperatures/alertStatus

# Unauthenticated write should be rejected (expect 401):
curl -i -X POST https://.../temperatures/log -H 'Content-Type: application/json' -d '{}'

# Authenticated write should succeed (expect 200):
curl -i -X POST https://.../temperatures/log \
  -H 'Content-Type: application/json' \
  -H "x-api-key: $TMPSENSOR_API_KEY" \
  -d '{"server":"boulder","dateTime":"1/1/2026, 12:00:00 PM","timeStamp":1767283200000,"sensorData":[{"sensor1":45.2}]}'

# Then confirm it shows up:
curl https://.../temperatures/getCurrent
```

## 9. Pausing alerts when you know about a problem already

```bash
# Pause for 120 minutes:
curl -X POST https://.../temperatures/pauseAlerts \
  -H 'Content-Type: application/json' -H "x-api-key: $TMPSENSOR_API_KEY" \
  -d '{"minutes": 120}'

# Resume early:
curl -X POST https://.../temperatures/resumeAlerts -H "x-api-key: $TMPSENSOR_API_KEY"

# Check status (no auth needed):
curl https://.../temperatures/alertStatus
```

Consider making a phone Shortcut / Home Screen button that fires the
`pauseAlerts` curl for you — that was the point of making it a callable
endpoint instead of automatic.

## 9b. Offline alerts

A scheduled function (`offlineCheck`) runs every minute and sends an ntfy alert
when a house in `MONITORED_SERVERS` (`functions/src/serverManager.js`) hasn't
checked in for more than 5 minutes, repeats it hourly while the house stays
silent, and sends a "reporting again" message when it comes back. It respects
`pauseAlerts` like the temperature alerts do; anything suppressed during a
pause goes out as soon as the pause ends. Add or remove house names in
`MONITORED_SERVERS` when houses change.

The first `firebase deploy --only functions` after adding it may ask to enable
the Cloud Scheduler API -- say yes. Cloud Scheduler includes 3 free jobs per
billing account; this uses one.

## 10. Long-range history (hourly/daily averages)

Every reading is also folded into running hourly and daily averages
(`rollupsHourly`, `rollupsDaily`), which back `/getHistory?range=7d|30d|90d|180d|365d`
and the dashboard's 1 week – 1 year views. Unlike raw logs, these have no
`expireAt`, so they outlive the 30-day TTL.

After deploying this for the first time (`firebase deploy --only functions`),
backfill the averages from the raw logs already stored. This only needs doing
once; re-running is harmless (already-counted readings are skipped):

```bash
gcloud auth application-default login     # if you haven't already
cd functions
GCLOUD_PROJECT=<your-project-id> node scripts/backfillRollups.js
```

It reads every stored log once and marks each one as counted — roughly 200K
reads and 200K writes for the history as of October 2026, i.e. well under $1,
one time.

## Cost expectations

On Blaze, you're billed pay-as-you-go, but the free tier underneath likely
covers this entirely at your traffic volume:

- Cloud Functions: 2M invocations/month free
- Firestore: 50K reads, 20K writes, 20K deletes per day free

The offline check adds ~5.8K reads/day (4 per run) and a handful of writes.
Two sensors posting once a minute come to ~11.5K writes/day (each reading
writes its log, the latest-reading doc, and two rollup buckets). Reads are
mostly the dashboard: opening it reads ~4K raw logs for the 24h charts, and up
to ~1.3K rollups for the 1-month view; left open, it repeats that hourly. Checking
it a few times a day stays inside the free tier. A tab left open around the clock
on the 24h view runs ~100K reads/day, about $0.03/day over the free tier. Worth
setting a [budget alert](https://console.cloud.google.com/billing/budgets) in GCP
for peace of mind, but expect $0 to a dollar or so a month.

## Local testing (optional)

```bash
cd functions
firebase emulators:start --only functions,firestore
```

The emulator UI (prints a localhost URL) lets you browse the emulated
Firestore data and hit the function locally without touching production.
