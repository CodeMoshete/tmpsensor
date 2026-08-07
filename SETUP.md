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

## Cost expectations

On Blaze, you're billed pay-as-you-go, but the free tier underneath likely
covers this entirely at your traffic volume:

- Cloud Functions: 2M invocations/month free
- Firestore: 50K reads, 20K writes, 20K deletes per day free

A sensor posting every few minutes plus occasional dashboard reads is nowhere
close to those limits. Worth setting a [budget alert](https://console.cloud.google.com/billing/budgets)
in GCP for peace of mind, but expect $0/month.

## Local testing (optional)

```bash
cd functions
firebase emulators:start --only functions,firestore
```

The emulator UI (prints a localhost URL) lets you browse the emulated
Firestore data and hit the function locally without touching production.
