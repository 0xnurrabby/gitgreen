// Bangladesh time (UTC+6, no DST) helpers and the daily maintenance window.
// Every day from QUIET_START_HOUR to QUIET_END_HOUR (Bangladesh time, default
// 20:00-22:00) no push/commit happens for any user, so the server can be
// changed or maintained safely. On a new server the app resumes exactly where
// it left off because state lives in Neon.

const BD_TZ_OFFSET_MIN = 6 * 60; // Bangladesh = UTC+6

const QUIET_START = (Number(process.env.QUIET_START_HOUR) || 20) * 60; // 20:00 BD
const QUIET_END = (Number(process.env.QUIET_END_HOUR) || 22) * 60;     // 22:00 BD

// Minutes since midnight in Bangladesh time for a Date.
function bdMinutesFromDate(d) {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMin + BD_TZ_OFFSET_MIN) % 1440;
}

function bdMinutesNow() {
  return bdMinutesFromDate(new Date());
}

// 'YYYY-MM-DD' date string for the Bangladesh day containing d.
function bdDateStr(d) {
  return new Date(d.getTime() + BD_TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

function todayBDStr() {
  return bdDateStr(new Date());
}

function daysAgoBDStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return bdDateStr(d);
}

// Set a Date to a given Bangladesh minute (0-1439) on the same UTC day.
function bdMinToDate(bdMin, d) {
  const utcMin = (bdMin - BD_TZ_OFFSET_MIN + 1440) % 1440;
  d.setUTCHours(Math.floor(utcMin / 60), utcMin % 60, 0, 0);
  return d;
}

// Is the given Bangladesh minute inside the maintenance window?
function isInQuietWindow(bdMin) {
  return bdMin >= QUIET_START && bdMin < QUIET_END;
}

// Is right now inside the maintenance window?
function isQuietNow() {
  return isInQuietWindow(bdMinutesNow());
}

// Clip a time window (in Bangladesh minutes) so it never overlaps the quiet
// window. Returns an array of 0, 1 or 2 windows.
function clipWindow(w) {
  const out = [];
  if (w.to <= QUIET_START || w.from >= QUIET_END) {
    out.push({ from: w.from, to: w.to });
    return out;
  }
  if (w.from < QUIET_START && w.to > QUIET_START) {
    out.push({ from: w.from, to: Math.min(w.to, QUIET_START) });
  }
  if (w.from < QUIET_END && w.to > QUIET_END) {
    out.push({ from: Math.max(w.from, QUIET_END), to: w.to });
  }
  return out.filter((x) => x.to > x.from);
}

function clipWindows(windows) {
  return windows.flatMap(clipWindow);
}

// Weekday (0=Sun..6=Sat) for a Bangladesh date string.
function weekdayOf(dateStr) {
  return new Date(dateStr + 'T12:00:00+06:00').getUTCDay();
}

module.exports = {
  BD_TZ_OFFSET_MIN,
  QUIET_START,
  QUIET_END,
  bdMinutesFromDate,
  bdMinutesNow,
  bdDateStr,
  todayBDStr,
  daysAgoBDStr,
  bdMinToDate,
  isInQuietWindow,
  isQuietNow,
  clipWindow,
  clipWindows,
  weekdayOf
};
