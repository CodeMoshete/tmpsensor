// The house is on Eastern time -- calendar days (getForDate's month/day/year, and
// the daily rollup buckets) are Eastern calendar days.
const HOUSE_TIMEZONE = 'America/New_York';

// Returns the UTC offset (in minutes, signed -- e.g. -240 for EDT, -300 for EST)
// in effect at Eastern midnight starting the given Y/M/D. Probes at 00:00 UTC
// (the previous Eastern evening): DST switches happen at 2am local, so the
// offset at that probe is the one still in effect at midnight, including on the
// switch days themselves.
function getHouseUtcOffsetMinutes(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    timeZoneName: 'shortOffset'
  }).formatToParts(probe);
  const tzName = parts.find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-4"
  const match = tzName.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1], 10) : -5; // fall back to EST
  return offsetHours * 60;
}

// UTC millis of Eastern midnight starting the given Eastern calendar day.
function houseMidnight(year, month, day) {
  return Date.UTC(year, month - 1, day, 0, 0, 0) - getHouseUtcOffsetMinutes(year, month, day) * 60000;
}

// The Eastern calendar day containing timeStampMs, as a "YYYY-MM-DD" key plus
// the UTC millis of that day's Eastern midnight.
function houseDay(timeStampMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date(timeStampMs));
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { key, start: houseMidnight(year, month, day) };
}

module.exports = {
  HOUSE_TIMEZONE,
  getHouseUtcOffsetMinutes,
  houseMidnight,
  houseDay
};
