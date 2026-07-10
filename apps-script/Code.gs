// ============================================================================
// CollegePlannerPro / Google Calendar proxy for the Anderson Homepage
//
// Hybrid design — ONE proxy, ONE token, two internal routes:
//   Route 1 (Google):  URL is a Google "secret iCal" address whose calendar this
//                       account can read -> Advanced Calendar Service. Richest path
//                       (Google Meet links + server-side recurrence expansion).
//   Route 2 (generic): anything else (CollegePlannerPro, iCloud, any .ics feed) ->
//                       fetch the URL over HTTP and parse the ICS ourselves.
// Route 1 transparently falls back to Route 2 if the API can't read that calendar.
//
// Deploy: Deploy > New deployment > Web app > Execute as "Me", access "Anyone".
// After editing: Deploy > Manage deployments > edit (pencil) > New version > Deploy
// (otherwise /exec keeps running the old code).
// ============================================================================

var SECRET_TOKEN = '(hidden)';   // <-- keep your existing token so Settings still matches

// Run once to grant Calendar permission (incl. the Advanced Calendar Service scope).
function authorize() {
  CalendarApp.getAllCalendars();
  Calendar.CalendarList.list();   // touches the Advanced service so its scope is granted
}

function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.token !== SECRET_TOKEN) {
      return _respond(e, { error: 'Unauthorized' });
    }
    var icsUrl = e.parameter.url;
    if (!icsUrl) return _respond(e, { error: 'Missing url parameter' });
    var days = parseInt(e.parameter.days) || 7;
    var daysBack = _daysBack(e);

    // ---- Route 1: Google secret iCal URL readable via the Calendar API ----
    // Richest result (Meet links, recurrence). On ANY failure (not subscribed,
    // no access, API hiccup) fall through to the generic fetch below so a URL we
    // could still read as a raw feed never hard-fails here.
    var calId = _calIdFromIcs(icsUrl);
    if (calId) {
      try {
        var viaApi = _eventsViaCalendarApi(calId, days, daysBack);
        if (viaApi) return _respond(e, { events: viaApi });
      } catch (apiErr) { /* fall through to generic ICS fetch */ }
    }

    // ---- Route 2: generic — fetch ANY ICS feed over HTTP and parse it ----
    var fetched = _fetchIcs(icsUrl);
    if (fetched.error) return _respond(e, { error: fetched.error, snippet: fetched.snippet });
    return _respond(e, { events: parseICS(e, fetched.text) });
  } catch (err) {
    return _respond(e, { error: String((err && err.message) || err) });
  }
}

// Days of past events to fetch. Client sends &daysBack=; default 7 for older
// clients, clamped to a sane 0–90 so the range can't blow up.
function _daysBack(e) {
  var n = parseInt(e && e.parameter && e.parameter.daysBack);
  if (isNaN(n)) n = 7;
  return Math.min(90, Math.max(0, n));
}

// ---- Route 1 helper: Advanced Calendar Service (Calendar API v3) ------------

function _eventsViaCalendarApi(calId, days, daysBack) {
  if (daysBack == null) daysBack = 7;
  var now = new Date();
  var rangeStart = new Date(now.getTime() - daysBack * 86400000);  // back-window for day views
  var rangeEnd = new Date(now.getTime() + days * 86400000);

  // Unlike CalendarApp, this returns the Google Meet link (hangoutLink /
  // conferenceData) and expands recurrences for us. maxResults is high (and
  // orderBy startTime) so a wider back-window can't truncate future events.
  var resp = Calendar.Events.list(calId, {
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    showDeleted: false,
    maxResults: 2500
  });
  var items = (resp && resp.items) || [];

  var events = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item.start) continue;
    var allDay = !!item.start.date;                 // all-day events use .date (YYYY-MM-DD)
    if (!allDay && !item.start.dateTime) continue;  // skip anything malformed
    events.push({
      title: item.summary || '',
      location: item.location || '',
      description: item.description || '',
      conferenceUrl: _conferenceUrl(item),
      allDay: allDay,
      start: allDay ? _isoDateUTC(item.start.date) : new Date(item.start.dateTime).toISOString(),
      end:   allDay ? _isoDateUTC(item.end.date)   : new Date(item.end.dateTime).toISOString()
    });
  }
  events.sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  return events;
}

// Google Meet link: hangoutLink is simplest; fall back to a video entry point.
function _conferenceUrl(item) {
  if (item.hangoutLink) return item.hangoutLink;
  var cd = item.conferenceData;
  if (cd && cd.entryPoints) {
    for (var i = 0; i < cd.entryPoints.length; i++) {
      var ep = cd.entryPoints[i];
      if (ep && ep.entryPointType === 'video' && ep.uri) return ep.uri;
    }
  }
  return '';
}

// Pull the calendar id out of a Google iCal "secret address" URL:
//   https://calendar.google.com/calendar/ical/<URL-encoded-id>/private-<key>/basic.ics
// Returns null for non-Google feeds (e.g. CollegePlannerPro) -> generic route.
function _calIdFromIcs(url) {
  var m = url.match(/\/ical\/([^\/]+)\//);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (err) { return m[1]; }
}

// ---- Route 2 helper: robust HTTP fetch of an arbitrary ICS feed ------------
// Sends a browser User-Agent (helps past some Cloudflare bot checks), never
// throws on HTTP errors, and reports what it actually got so failures are visible.
function _fetchIcs(icsUrl) {
  var response = UrlFetchApp.fetch(icsUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/calendar, text/plain, */*'
    }
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200) {
    return { error: 'Feed returned HTTP ' + code, snippet: text.slice(0, 200) };
  }
  if (text.indexOf('BEGIN:VCALENDAR') === -1) {
    return { error: 'Response was not ICS (likely a block page)', snippet: text.slice(0, 200) };
  }
  return { text: text };
}

// ============================================================================
// ICS parser (generic route). Self-contained — no Calendar API.
// ============================================================================

function parseICS(e, icsText) {
  var now = new Date();
  var rangeStart = new Date(now.getTime() - _daysBack(e) * 86400000);  // back-window for day views
  var rangeEnd = new Date(now);
  var days = parseInt(e.parameter.days) || 7;
  rangeEnd.setDate(rangeEnd.getDate() + days);

  var blocks = icsText.split('BEGIN:VEVENT');
  var masters = [];
  var exceptions = {};

  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i].split('END:VEVENT')[0];
    var uid = extractValue(block, 'UID');
    var recId = extractProp(block, 'RECURRENCE-ID');
    if (recId.value) {
      if (!exceptions[uid]) exceptions[uid] = {};
      var key = normalizeKey(recId);
      exceptions[uid][key] = block;
    } else {
      masters.push({ block: block, uid: uid });
    }
  }

  var events = [];
  for (var i = 0; i < masters.length; i++) {
    processEvent(masters[i], exceptions, rangeStart, rangeEnd, events);
  }

  events.sort(function(a, b) { return new Date(a.start) - new Date(b.start); });
  return events;
}

function processEvent(master, exceptions, rangeStart, rangeEnd, out) {
  var block = master.block;
  var uid = master.uid;
  var title = extractValue(block, 'SUMMARY');
  var location = extractValue(block, 'LOCATION') || '';
  var description = extractValue(block, 'DESCRIPTION') || '';
  // Google Meet link lives in its own property (not always in DESCRIPTION).
  var conference = extractValue(block, 'X-GOOGLE-CONFERENCE') || '';
  var dtstart = extractProp(block, 'DTSTART');
  var dtend = extractProp(block, 'DTEND');
  var rrule = extractValue(block, 'RRULE');

  if (!dtstart.value) return;

  var isAllDay = dtstart.value.length === 8;
  var start = isAllDay ? parseICSDate(dtstart.value) : parseICSDateTime(dtstart.value, dtstart.tzid);
  var end = dtend.value
    ? (isAllDay ? parseICSDate(dtend.value) : parseICSDateTime(dtend.value, dtend.tzid))
    : new Date(start);
  var durationMs = end.getTime() - start.getTime();

  if (!rrule) {
    var inWindow = (start >= rangeStart && start <= rangeEnd) || (start < rangeStart && end > rangeStart);
    if (inWindow) {
      out.push(makeEvent(title, location, description, isAllDay, start, end, conference));
    }
    return;
  }

  var exdates = collectExdates(block, dtstart.tzid);
  var occurrences = expandRRule(rrule, start, durationMs, rangeStart, rangeEnd, exdates);
  var uidExc = exceptions[uid] || {};

  for (var i = 0; i < occurrences.length; i++) {
    var occ = occurrences[i];
    var key = dateToKey(occ.start);
    if (uidExc[key]) {
      var exEv = parseExceptionBlock(uidExc[key], durationMs);
      if (exEv && exEv.start >= rangeStart && exEv.start <= rangeEnd) {
        out.push(makeEvent(
          exEv.title || title, exEv.location, exEv.description,
          exEv.allDay, exEv.start, exEv.end, exEv.conference || conference
        ));
      }
    } else {
      out.push(makeEvent(title, location, description, isAllDay, occ.start, occ.end, conference));
    }
  }
}

function parseExceptionBlock(block, fallbackDurationMs) {
  var dtstart = extractProp(block, 'DTSTART');
  var dtend = extractProp(block, 'DTEND');
  if (!dtstart.value) return null;
  var isAllDay = dtstart.value.length === 8;
  var s = isAllDay ? parseICSDate(dtstart.value) : parseICSDateTime(dtstart.value, dtstart.tzid);
  var en = dtend.value
    ? (isAllDay ? parseICSDate(dtend.value) : parseICSDateTime(dtend.value, dtend.tzid))
    : new Date(s.getTime() + fallbackDurationMs);
  return {
    title: extractValue(block, 'SUMMARY'),
    location: extractValue(block, 'LOCATION') || '',
    description: extractValue(block, 'DESCRIPTION') || '',
    conference: extractValue(block, 'X-GOOGLE-CONFERENCE') || '',
    allDay: isAllDay, start: s, end: en
  };
}

function makeEvent(title, location, description, allDay, start, end, conferenceUrl) {
  return {
    title: title, location: location, description: description,
    conferenceUrl: conferenceUrl || '',
    allDay: allDay, start: start.toISOString(), end: end.toISOString()
  };
}

// ---- ICS Property Extraction ----

function extractValue(block, key) {
  var regex = new RegExp('(?:^|\\n)' + key + '[^:\\r\\n]*:([^\\r\\n]*(?:\\r?\\n [^\\r\\n]*)*)');
  var match = block.match(regex);
  if (!match) return '';
  return match[1].replace(/\r?\n /g, '').replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
}

function extractProp(block, key) {
  var regex = new RegExp('(?:^|\\n)' + key + '([^:\\r\\n]*):([^\\r\\n]*(?:\\r?\\n [^\\r\\n]*)*)');
  var match = block.match(regex);
  if (!match) return { value: '', tzid: '' };
  var params = match[1];
  var value = match[2].replace(/\r?\n /g, '').trim();
  var tzid = '';
  var tzMatch = params.match(/TZID=([^;:]+)/);
  if (tzMatch) tzid = tzMatch[1].trim();
  return { value: value, tzid: tzid };
}

// ---- Date Parsing ----

function parseICSDate(str) {
  return new Date(Date.UTC(+str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2)));
}

function parseICSDateTime(str, tzid) {
  str = str.replace(/[^0-9TZ]/g, '');
  var y = +str.substr(0,4), mo = +str.substr(4,2)-1, d = +str.substr(6,2);
  var h = +str.substr(9,2), mi = +str.substr(11,2), s = +str.substr(13,2);
  if (str.endsWith('Z')) {
    return new Date(Date.UTC(y, mo, d, h, mi, s));
  }
  if (tzid) {
    var guessUTC = new Date(Date.UTC(y, mo, d, h, mi, s));
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    var localStr = fmt.format(guessUTC);
    var m = localStr.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
    if (m) {
      var localAsUTC = Date.UTC(+m[3], +m[1]-1, +m[2], +m[4]%24, +m[5], +m[6]);
      var offset = localAsUTC - guessUTC.getTime();
      return new Date(guessUTC.getTime() - offset);
    }
  }
  return new Date(Date.UTC(y, mo, d, h, mi, s));
}

// ---- EXDATE Handling ----

function collectExdates(block, defaultTzid) {
  var exdates = {};
  var regex = /(?:^|\n)EXDATE([^:\r\n]*):([^\r\n]*)/g;
  var match;
  while ((match = regex.exec(block)) !== null) {
    var params = match[1];
    var values = match[2].replace(/\r?\n /g, '').trim();
    var tzid = '';
    var tzMatch = params.match(/TZID=([^;:]+)/);
    if (tzMatch) tzid = tzMatch[1].trim();
    var dates = values.split(',');
    for (var i = 0; i < dates.length; i++) {
      var dt = dates[i].trim();
      if (!dt) continue;
      var parsed = dt.length === 8
        ? parseICSDate(dt)
        : parseICSDateTime(dt, tzid || defaultTzid);
      exdates[dateToKey(parsed)] = true;
    }
  }
  return exdates;
}

function dateToKey(d) { return d.toISOString(); }

function normalizeKey(prop) {
  if (!prop.value) return '';
  var d = prop.value.length === 8
    ? parseICSDate(prop.value)
    : parseICSDateTime(prop.value, prop.tzid);
  return dateToKey(d);
}

// ---- RRULE Expansion ----

var DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandRRule(rruleStr, dtstart, durationMs, rangeStart, rangeEnd, exdates) {
  var p = {};
  rruleStr.split(';').forEach(function(s) {
    var kv = s.split('='); if (kv[1]) p[kv[0]] = kv[1];
  });

  var freq = p.FREQ;
  if (!freq) return [];
  var interval = parseInt(p.INTERVAL) || 1;
  var until = p.UNTIL ? parseRRuleUntil(p.UNTIL) : null;
  var count = p.COUNT ? parseInt(p.COUNT) : 0;
  var byday = p.BYDAY ? p.BYDAY.split(',') : null;
  var bymonthday = p.BYMONTHDAY ? p.BYMONTHDAY.split(',').map(Number) : null;
  var bysetpos = p.BYSETPOS ? parseInt(p.BYSETPOS) : 0;

  var hardEnd = until && until < rangeEnd ? until : rangeEnd;
  var maxOcc = count || 1000000;
  var results = [];
  var n = 0;
  var timeH = dtstart.getUTCHours(), timeMi = dtstart.getUTCMinutes(), timeS = dtstart.getUTCSeconds();

  function stamp(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), timeH, timeMi, timeS));
  }
  function collect(c) {
    if (n >= maxOcc || c > hardEnd) return false;
    if (c < dtstart) return true;
    n++;
    var cEnd = new Date(c.getTime() + durationMs);
    var inWindow = (c >= rangeStart || cEnd > rangeStart) && !exdates[dateToKey(c)];
    if (inWindow) {
      results.push({ start: c, end: cEnd });
    }
    return true;
  }

  if (freq === 'DAILY') {
    var cur = new Date(dtstart);
    if (!count && cur < rangeStart) {
      var skip = Math.floor((rangeStart - cur) / (86400000 * interval));
      if (skip > 1) cur = addDays(cur, (skip - 1) * interval);
    }
    while (cur <= hardEnd && n < maxOcc) {
      if (!collect(stamp(cur))) break;
      cur = addDays(cur, interval);
    }

  } else if (freq === 'WEEKLY') {
    var days = byday
      ? byday.map(function(s) { return DAY_MAP[s.replace(/[^A-Z]/g, '')]; })
      : [dtstart.getUTCDay()];
    days.sort(function(a, b) { return a - b; });
    var ws = addDays(dtstart, -dtstart.getUTCDay()); // Sunday of dtstart's week
    if (!count && ws < rangeStart) {
      var skip = Math.floor((rangeStart - ws) / (7 * 86400000 * interval));
      if (skip > 1) ws = addDays(ws, (skip - 1) * 7 * interval);
    }
    outer:
    while (ws <= hardEnd && n < maxOcc) {
      for (var di = 0; di < days.length; di++) {
        var cand = stamp(addDays(ws, days[di]));
        if (!collect(cand)) break outer;
      }
      ws = addDays(ws, 7 * interval);
    }

  } else if (freq === 'MONTHLY') {
    var mCur = new Date(Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), 1));
    if (!count && mCur < rangeStart) {
      var mSkip = (rangeStart.getUTCFullYear() - mCur.getUTCFullYear()) * 12
                + rangeStart.getUTCMonth() - mCur.getUTCMonth();
      mSkip = Math.floor(mSkip / interval) * interval;
      if (mSkip > interval) mCur = addUTCMonths(mCur, mSkip - interval);
    }
    while (mCur <= hardEnd && n < maxOcc) {
      var y = mCur.getUTCFullYear(), mo = mCur.getUTCMonth();
      var cands = [];
      if (byday) {
        var hasOrd = byday.some(function(s) { return /^-?\d/.test(s); });
        if (hasOrd) {
          for (var bi = 0; bi < byday.length; bi++) {
            var bd = parseByday(byday[bi]);
            var found = nthWeekdayUTC(y, mo, bd.day, bd.n || 1);
            if (found) cands.push(stamp(found));
          }
        } else {
          var pool = [];
          for (var bi = 0; bi < byday.length; bi++) {
            var bd = parseByday(byday[bi]);
            var wd = firstWeekdayUTC(y, mo, bd.day);
            while (wd.getUTCMonth() === mo) { pool.push(stamp(wd)); wd = addDays(wd, 7); }
          }
          pool.sort(function(a, b) { return a - b; });
          if (bysetpos) {
            var idx = bysetpos > 0 ? bysetpos - 1 : pool.length + bysetpos;
            if (idx >= 0 && idx < pool.length) cands.push(pool[idx]);
          } else {
            cands = pool;
          }
        }
      } else if (bymonthday) {
        var lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        for (var bmi = 0; bmi < bymonthday.length; bmi++) {
          var md = bymonthday[bmi];
          var dd = md > 0 ? md : lastDay + md + 1;
          if (dd >= 1 && dd <= lastDay) cands.push(stamp(new Date(Date.UTC(y, mo, dd))));
        }
      } else {
        var origDay = dtstart.getUTCDate();
        var lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        cands.push(stamp(new Date(Date.UTC(y, mo, Math.min(origDay, lastDay)))));
      }
      cands.sort(function(a, b) { return a - b; });
      for (var ci = 0; ci < cands.length; ci++) {
        if (!collect(cands[ci])) break;
      }
      mCur = addUTCMonths(mCur, interval);
    }

  } else if (freq === 'YEARLY') {
    var yCur = new Date(dtstart);
    if (!count && yCur < rangeStart) {
      var skip = Math.floor((rangeStart.getUTCFullYear() - yCur.getUTCFullYear()) / interval) * interval;
      if (skip > interval) yCur = new Date(Date.UTC(
        yCur.getUTCFullYear() + skip - interval, dtstart.getUTCMonth(), dtstart.getUTCDate()
      ));
    }
    while (yCur <= hardEnd && n < maxOcc) {
      if (!collect(stamp(yCur))) break;
      yCur = new Date(Date.UTC(
        yCur.getUTCFullYear() + interval, dtstart.getUTCMonth(), dtstart.getUTCDate()
      ));
    }
  }

  return results;
}

// ---- Recurrence Helpers ----

function parseRRuleUntil(str) {
  str = str.replace(/[^0-9TZ]/g, '');
  if (str.length === 8) {
    return new Date(Date.UTC(+str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2), 23, 59, 59));
  }
  return new Date(Date.UTC(
    +str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2),
    +str.substr(9,2), +str.substr(11,2), +str.substr(13,2)
  ));
}

function parseByday(str) {
  var m = str.match(/^(-?\d+)?([A-Z]{2})$/);
  if (!m) return { n: 0, day: 0 };
  return { n: m[1] ? parseInt(m[1]) : 0, day: DAY_MAP[m[2]] || 0 };
}

function nthWeekdayUTC(year, month, weekday, n) {
  if (n > 0) {
    var first = new Date(Date.UTC(year, month, 1));
    var offset = (weekday - first.getUTCDay() + 7) % 7;
    var day = 1 + offset + (n - 1) * 7;
    var result = new Date(Date.UTC(year, month, day));
    return result.getUTCMonth() === month ? result : null;
  } else {
    var last = new Date(Date.UTC(year, month + 1, 0));
    var offset = (last.getUTCDay() - weekday + 7) % 7;
    var day = last.getUTCDate() - offset + (n + 1) * 7;
    if (day < 1) return null;
    var result = new Date(Date.UTC(year, month, day));
    return result.getUTCMonth() === month ? result : null;
  }
}

function firstWeekdayUTC(year, month, weekday) {
  var first = new Date(Date.UTC(year, month, 1));
  var offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset));
}

function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

function addUTCMonths(d, months) {
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, 1));
}

// ---- Shared helpers ----

// All-day events: emit UTC-midnight of the calendar date (end is exclusive), matching the client.
// Accepts a 'YYYY-MM-DD' string (Calendar API) and returns a UTC ISO string.
function _isoDateUTC(ymd) {
  var p = String(ymd).split('-');
  return new Date(Date.UTC(+p[0], (+p[1]) - 1, +p[2])).toISOString();
}

function _respond(e, data) {
  var json = JSON.stringify(data);
  var cb = e && e.parameter ? e.parameter.callback : null;
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
