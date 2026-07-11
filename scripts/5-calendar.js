// ==========================================
// 5-CALENDAR.JS - Google Calendar Integration
// Anderson Homepage v3.0
//
// Fetches calendar events via a Google Apps Script
// CORS proxy that reads an ICS feed URL.
//
// Setup:
// 1. Deploy the Apps Script proxy (see SETUP below)
// 2. Get your Google Calendar's secret ICS URL
// 3. Paste both into Settings (hamburger menu)
//
// SETUP - Google Apps Script Template:
// ------------------------------------
// Create a new Apps Script at https://script.google.com
// Paste the following code, set your SECRET_TOKEN,
// then Deploy > Web app > Execute as "Me",
// "Anyone" can access.
//
// --- BEGIN APPS SCRIPT ---
// var SECRET_TOKEN = 'CHANGE_ME_TO_A_RANDOM_STRING';
//
// function doGet(e) {
//   if (e.parameter.token !== SECRET_TOKEN) {
//     return _respond(e, { error: 'Unauthorized' });
//   }
//   var icsUrl = e.parameter.url;
//   if (!icsUrl) {
//     return _respond(e, { error: 'Missing url parameter' });
//   }
//   var response = UrlFetchApp.fetch(icsUrl);
//   var icsText = response.getContentText();
//   var events = parseICS(e, icsText);
//   return _respond(e, { events: events });
// }
//
// function _respond(e, data) {
//   var json = JSON.stringify(data);
//   var callback = e.parameter.callback;
//   if (callback) {
//     return ContentService.createTextOutput(callback + '(' + json + ')')
//       .setMimeType(ContentService.MimeType.JAVASCRIPT);
//   }
//   return ContentService.createTextOutput(json)
//     .setMimeType(ContentService.MimeType.JSON);
// }
//
// // ---- Main ICS Parser ----
//
// function parseICS(e, icsText) {
//   var now = new Date();
//   var rangeEnd = new Date(now);
//   var days = parseInt(e.parameter.days) || 7;
//   rangeEnd.setDate(rangeEnd.getDate() + days);
//
//   var blocks = icsText.split('BEGIN:VEVENT');
//   var masters = [];
//   var exceptions = {};
//
//   for (var i = 1; i < blocks.length; i++) {
//     var block = blocks[i].split('END:VEVENT')[0];
//     var uid = extractValue(block, 'UID');
//     var recId = extractProp(block, 'RECURRENCE-ID');
//     if (recId.value) {
//       if (!exceptions[uid]) exceptions[uid] = {};
//       var key = normalizeKey(recId);
//       exceptions[uid][key] = block;
//     } else {
//       masters.push({ block: block, uid: uid });
//     }
//   }
//
//   var events = [];
//   for (var i = 0; i < masters.length; i++) {
//     processEvent(masters[i], exceptions, now, rangeEnd, events);
//   }
//
//   events.sort(function(a, b) { return new Date(a.start) - new Date(b.start); });
//   return events;
// }
//
// function processEvent(master, exceptions, rangeStart, rangeEnd, out) {
//   var block = master.block;
//   var uid = master.uid;
//   var title = extractValue(block, 'SUMMARY');
//   var location = extractValue(block, 'LOCATION') || '';
//   var description = extractValue(block, 'DESCRIPTION') || '';
//   // Google Meet link lives in its own property (not always in DESCRIPTION).
//   var conference = extractValue(block, 'X-GOOGLE-CONFERENCE') || '';
//   var dtstart = extractProp(block, 'DTSTART');
//   var dtend = extractProp(block, 'DTEND');
//   var rrule = extractValue(block, 'RRULE');
//
//   if (!dtstart.value) return;
//
//   var isAllDay = dtstart.value.length === 8;
//   var start = isAllDay ? parseICSDate(dtstart.value) : parseICSDateTime(dtstart.value, dtstart.tzid);
//   var end = dtend.value
//     ? (isAllDay ? parseICSDate(dtend.value) : parseICSDateTime(dtend.value, dtend.tzid))
//     : new Date(start);
//   var durationMs = end.getTime() - start.getTime();
//
//   if (!rrule) {
//     var inWindow = (start >= rangeStart && start <= rangeEnd) || (start < rangeStart && end > rangeStart);
//     if (inWindow) {
//       out.push(makeEvent(title, location, description, isAllDay, start, end, conference));
//     }
//     return;
//   }
//
//   var exdates = collectExdates(block, dtstart.tzid);
//   var occurrences = expandRRule(rrule, start, durationMs, rangeStart, rangeEnd, exdates);
//   var uidExc = exceptions[uid] || {};
//
//   for (var i = 0; i < occurrences.length; i++) {
//     var occ = occurrences[i];
//     var key = dateToKey(occ.start);
//     if (uidExc[key]) {
//       var exEv = parseExceptionBlock(uidExc[key], durationMs);
//       if (exEv && exEv.start >= rangeStart && exEv.start <= rangeEnd) {
//         out.push(makeEvent(
//           exEv.title || title, exEv.location, exEv.description,
//           exEv.allDay, exEv.start, exEv.end, exEv.conference || conference
//         ));
//       }
//     } else {
//       out.push(makeEvent(title, location, description, isAllDay, occ.start, occ.end, conference));
//     }
//   }
// }
//
// function parseExceptionBlock(block, fallbackDurationMs) {
//   var dtstart = extractProp(block, 'DTSTART');
//   var dtend = extractProp(block, 'DTEND');
//   if (!dtstart.value) return null;
//   var isAllDay = dtstart.value.length === 8;
//   var s = isAllDay ? parseICSDate(dtstart.value) : parseICSDateTime(dtstart.value, dtstart.tzid);
//   var e = dtend.value
//     ? (isAllDay ? parseICSDate(dtend.value) : parseICSDateTime(dtend.value, dtend.tzid))
//     : new Date(s.getTime() + fallbackDurationMs);
//   return {
//     title: extractValue(block, 'SUMMARY'),
//     location: extractValue(block, 'LOCATION') || '',
//     description: extractValue(block, 'DESCRIPTION') || '',
//     conference: extractValue(block, 'X-GOOGLE-CONFERENCE') || '',
//     allDay: isAllDay, start: s, end: e
//   };
// }
//
// function makeEvent(title, location, description, allDay, start, end, conferenceUrl) {
//   return {
//     title: title, location: location, description: description,
//     conferenceUrl: conferenceUrl || '',
//     allDay: allDay, start: start.toISOString(), end: end.toISOString()
//   };
// }
//
// // ---- ICS Property Extraction ----
//
// function extractValue(block, key) {
//   var regex = new RegExp('(?:^|\\n)' + key + '[^:\\r\\n]*:([^\\r\\n]*(?:\\r?\\n [^\\r\\n]*)*)');
//   var match = block.match(regex);
//   if (!match) return '';
//   return match[1].replace(/\r?\n /g, '').replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
// }
//
// function extractProp(block, key) {
//   var regex = new RegExp('(?:^|\\n)' + key + '([^:\\r\\n]*):([^\\r\\n]*(?:\\r?\\n [^\\r\\n]*)*)');
//   var match = block.match(regex);
//   if (!match) return { value: '', tzid: '' };
//   var params = match[1];
//   var value = match[2].replace(/\r?\n /g, '').trim();
//   var tzid = '';
//   var tzMatch = params.match(/TZID=([^;:]+)/);
//   if (tzMatch) tzid = tzMatch[1].trim();
//   return { value: value, tzid: tzid };
// }
//
// // ---- Date Parsing ----
//
// function parseICSDate(str) {
//   return new Date(Date.UTC(+str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2)));
// }
//
// function parseICSDateTime(str, tzid) {
//   str = str.replace(/[^0-9TZ]/g, '');
//   var y = +str.substr(0,4), mo = +str.substr(4,2)-1, d = +str.substr(6,2);
//   var h = +str.substr(9,2), mi = +str.substr(11,2), s = +str.substr(13,2);
//   if (str.endsWith('Z')) {
//     return new Date(Date.UTC(y, mo, d, h, mi, s));
//   }
//   if (tzid) {
//     var guessUTC = new Date(Date.UTC(y, mo, d, h, mi, s));
//     var fmt = new Intl.DateTimeFormat('en-US', {
//       timeZone: tzid,
//       year: 'numeric', month: '2-digit', day: '2-digit',
//       hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
//     });
//     var localStr = fmt.format(guessUTC);
//     var m = localStr.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
//     if (m) {
//       var localAsUTC = Date.UTC(+m[3], +m[1]-1, +m[2], +m[4]%24, +m[5], +m[6]);
//       var offset = localAsUTC - guessUTC.getTime();
//       return new Date(guessUTC.getTime() - offset);
//     }
//   }
//   return new Date(Date.UTC(y, mo, d, h, mi, s));
// }
//
// // ---- EXDATE Handling ----
//
// function collectExdates(block, defaultTzid) {
//   var exdates = {};
//   var regex = /(?:^|\n)EXDATE([^:\r\n]*):([^\r\n]*)/g;
//   var match;
//   while ((match = regex.exec(block)) !== null) {
//     var params = match[1];
//     var values = match[2].replace(/\r?\n /g, '').trim();
//     var tzid = '';
//     var tzMatch = params.match(/TZID=([^;:]+)/);
//     if (tzMatch) tzid = tzMatch[1].trim();
//     var dates = values.split(',');
//     for (var i = 0; i < dates.length; i++) {
//       var dt = dates[i].trim();
//       if (!dt) continue;
//       var parsed = dt.length === 8
//         ? parseICSDate(dt)
//         : parseICSDateTime(dt, tzid || defaultTzid);
//       exdates[dateToKey(parsed)] = true;
//     }
//   }
//   return exdates;
// }
//
// function dateToKey(d) { return d.toISOString(); }
//
// function normalizeKey(prop) {
//   if (!prop.value) return '';
//   var d = prop.value.length === 8
//     ? parseICSDate(prop.value)
//     : parseICSDateTime(prop.value, prop.tzid);
//   return dateToKey(d);
// }
//
// // ---- RRULE Expansion ----
//
// var DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
//
// function expandRRule(rruleStr, dtstart, durationMs, rangeStart, rangeEnd, exdates) {
//   var p = {};
//   rruleStr.split(';').forEach(function(s) {
//     var kv = s.split('='); if (kv[1]) p[kv[0]] = kv[1];
//   });
//
//   var freq = p.FREQ;
//   if (!freq) return [];
//   var interval = parseInt(p.INTERVAL) || 1;
//   var until = p.UNTIL ? parseRRuleUntil(p.UNTIL) : null;
//   var count = p.COUNT ? parseInt(p.COUNT) : 0;
//   var byday = p.BYDAY ? p.BYDAY.split(',') : null;
//   var bymonthday = p.BYMONTHDAY ? p.BYMONTHDAY.split(',').map(Number) : null;
//   var bysetpos = p.BYSETPOS ? parseInt(p.BYSETPOS) : 0;
//
//   var hardEnd = until && until < rangeEnd ? until : rangeEnd;
//   var maxOcc = count || 1000000;
//   var results = [];
//   var n = 0;
//   var timeH = dtstart.getUTCHours(), timeMi = dtstart.getUTCMinutes(), timeS = dtstart.getUTCSeconds();
//
//   function stamp(d) {
//     return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), timeH, timeMi, timeS));
//   }
//   function collect(c) {
//     if (n >= maxOcc || c > hardEnd) return false;
//     if (c < dtstart) return true;
//     n++;
//     var cEnd = new Date(c.getTime() + durationMs);
//     var inWindow = (c >= rangeStart || cEnd > rangeStart) && !exdates[dateToKey(c)];
//     if (inWindow) {
//       results.push({ start: c, end: cEnd });
//     }
//     return true;
//   }
//
//   if (freq === 'DAILY') {
//     var cur = new Date(dtstart);
//     if (!count && cur < rangeStart) {
//       var skip = Math.floor((rangeStart - cur) / (86400000 * interval));
//       if (skip > 1) cur = addDays(cur, (skip - 1) * interval);
//     }
//     while (cur <= hardEnd && n < maxOcc) {
//       if (!collect(stamp(cur))) break;
//       cur = addDays(cur, interval);
//     }
//
//   } else if (freq === 'WEEKLY') {
//     var days = byday
//       ? byday.map(function(s) { return DAY_MAP[s.replace(/[^A-Z]/g, '')]; })
//       : [dtstart.getUTCDay()];
//     days.sort(function(a, b) { return a - b; });
//     var ws = addDays(dtstart, -dtstart.getUTCDay()); // Sunday of dtstart's week
//     if (!count && ws < rangeStart) {
//       var skip = Math.floor((rangeStart - ws) / (7 * 86400000 * interval));
//       if (skip > 1) ws = addDays(ws, (skip - 1) * 7 * interval);
//     }
//     outer:
//     while (ws <= hardEnd && n < maxOcc) {
//       for (var di = 0; di < days.length; di++) {
//         var cand = stamp(addDays(ws, days[di]));
//         if (!collect(cand)) break outer;
//       }
//       ws = addDays(ws, 7 * interval);
//     }
//
//   } else if (freq === 'MONTHLY') {
//     var mCur = new Date(Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), 1));
//     if (!count && mCur < rangeStart) {
//       var mSkip = (rangeStart.getUTCFullYear() - mCur.getUTCFullYear()) * 12
//                 + rangeStart.getUTCMonth() - mCur.getUTCMonth();
//       mSkip = Math.floor(mSkip / interval) * interval;
//       if (mSkip > interval) mCur = addUTCMonths(mCur, mSkip - interval);
//     }
//     while (mCur <= hardEnd && n < maxOcc) {
//       var y = mCur.getUTCFullYear(), mo = mCur.getUTCMonth();
//       var cands = [];
//       if (byday) {
//         var hasOrd = byday.some(function(s) { return /^-?\d/.test(s); });
//         if (hasOrd) {
//           for (var bi = 0; bi < byday.length; bi++) {
//             var bd = parseByday(byday[bi]);
//             var found = nthWeekdayUTC(y, mo, bd.day, bd.n || 1);
//             if (found) cands.push(stamp(found));
//           }
//         } else {
//           var pool = [];
//           for (var bi = 0; bi < byday.length; bi++) {
//             var bd = parseByday(byday[bi]);
//             var wd = firstWeekdayUTC(y, mo, bd.day);
//             while (wd.getUTCMonth() === mo) { pool.push(stamp(wd)); wd = addDays(wd, 7); }
//           }
//           pool.sort(function(a, b) { return a - b; });
//           if (bysetpos) {
//             var idx = bysetpos > 0 ? bysetpos - 1 : pool.length + bysetpos;
//             if (idx >= 0 && idx < pool.length) cands.push(pool[idx]);
//           } else {
//             cands = pool;
//           }
//         }
//       } else if (bymonthday) {
//         var lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
//         for (var bmi = 0; bmi < bymonthday.length; bmi++) {
//           var md = bymonthday[bmi];
//           var dd = md > 0 ? md : lastDay + md + 1;
//           if (dd >= 1 && dd <= lastDay) cands.push(stamp(new Date(Date.UTC(y, mo, dd))));
//         }
//       } else {
//         var origDay = dtstart.getUTCDate();
//         var lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
//         cands.push(stamp(new Date(Date.UTC(y, mo, Math.min(origDay, lastDay)))));
//       }
//       cands.sort(function(a, b) { return a - b; });
//       for (var ci = 0; ci < cands.length; ci++) {
//         if (!collect(cands[ci])) break;
//       }
//       mCur = addUTCMonths(mCur, interval);
//     }
//
//   } else if (freq === 'YEARLY') {
//     var yCur = new Date(dtstart);
//     if (!count && yCur < rangeStart) {
//       var skip = Math.floor((rangeStart.getUTCFullYear() - yCur.getUTCFullYear()) / interval) * interval;
//       if (skip > interval) yCur = new Date(Date.UTC(
//         yCur.getUTCFullYear() + skip - interval, dtstart.getUTCMonth(), dtstart.getUTCDate()
//       ));
//     }
//     while (yCur <= hardEnd && n < maxOcc) {
//       if (!collect(stamp(yCur))) break;
//       yCur = new Date(Date.UTC(
//         yCur.getUTCFullYear() + interval, dtstart.getUTCMonth(), dtstart.getUTCDate()
//       ));
//     }
//   }
//
//   return results;
// }
//
// // ---- Recurrence Helpers ----
//
// function parseRRuleUntil(str) {
//   str = str.replace(/[^0-9TZ]/g, '');
//   if (str.length === 8) {
//     return new Date(Date.UTC(+str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2), 23, 59, 59));
//   }
//   return new Date(Date.UTC(
//     +str.substr(0,4), +str.substr(4,2)-1, +str.substr(6,2),
//     +str.substr(9,2), +str.substr(11,2), +str.substr(13,2)
//   ));
// }
//
// function parseByday(str) {
//   var m = str.match(/^(-?\d+)?([A-Z]{2})$/);
//   if (!m) return { n: 0, day: 0 };
//   return { n: m[1] ? parseInt(m[1]) : 0, day: DAY_MAP[m[2]] || 0 };
// }
//
// function nthWeekdayUTC(year, month, weekday, n) {
//   if (n > 0) {
//     var first = new Date(Date.UTC(year, month, 1));
//     var offset = (weekday - first.getUTCDay() + 7) % 7;
//     var day = 1 + offset + (n - 1) * 7;
//     var result = new Date(Date.UTC(year, month, day));
//     return result.getUTCMonth() === month ? result : null;
//   } else {
//     var last = new Date(Date.UTC(year, month + 1, 0));
//     var offset = (last.getUTCDay() - weekday + 7) % 7;
//     var day = last.getUTCDate() - offset + (n + 1) * 7;
//     if (day < 1) return null;
//     var result = new Date(Date.UTC(year, month, day));
//     return result.getUTCMonth() === month ? result : null;
//   }
// }
//
// function firstWeekdayUTC(year, month, weekday) {
//   var first = new Date(Date.UTC(year, month, 1));
//   var offset = (weekday - first.getUTCDay() + 7) % 7;
//   return new Date(Date.UTC(year, month, 1 + offset));
// }
//
// function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
//
// function addUTCMonths(d, months) {
//   var y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
//   y += Math.floor(m / 12);
//   m = ((m % 12) + 12) % 12;
//   return new Date(Date.UTC(y, m, 1));
// }
// --- END APPS SCRIPT ---
// ==========================================

const CalendarManager = {
    config: {
        defaultRefreshInterval: 5 * 60 * 1000, // 5 minutes
        // How many days of PAST events to fetch and allow paging back to in the
        // day views. Sent to the proxy as &daysBack= (the proxy must be the
        // redeployed apps-script/Code.gs that reads it; older deployments ignore
        // it and fall back to their own 7-day window).
        daysBack: 30,
        calendarColors: [
            { name: 'Blue', value: '#2196F3' },
            { name: 'Red', value: '#F44336' },
            { name: 'Green', value: '#4CAF50' },
            { name: 'Orange', value: '#FF9800' },
            { name: 'Purple', value: '#9C27B0' },
            { name: 'Teal', value: '#009688' },
            { name: 'Pink', value: '#E91E63' },
            { name: 'Indigo', value: '#3F51B5' }
        ],
        storageKeys: {
            proxyUrl: 'calendarProxyUrl',
            proxyToken: 'calendarProxyToken',
            calendars: 'calendarSources',
            cachedEvents: 'calendarCachedEvents',
            calendarBuckets: 'calendarBuckets',
            lastFetched: 'calendarLastFetched',
            refreshInterval: 'calendarRefreshInterval',
            daysAhead: 'calendarDaysAhead',
            grouping: 'calendarGrouping',
            height: 'calendarHeight',
            countdownPlacement: 'calendarCountdownPlacement',
            countdownWindow: 'calendarCountdownWindow',
            countdownWarnMins: 'calendarCountdownWarnMins',
            countdownUrgentMins: 'calendarCountdownUrgentMins',
            viewMode: 'calendarViewMode',
            hiddenCalendars: 'calendarHiddenSources',
            timelineMode: 'calendarTimelineMode',
            upcomingBarCount: 'calendarUpcomingBarCount',
            upcomingBarFormat: 'calendarUpcomingBarFormat'
        }
    },

    state: {
        events: [],
        lastFetched: null,
        intervalId: null,
        isConfigured: false,
        fetchError: null,
        isFetching: false,
        countdownTickerId: null,
        // Days from today the day-view window starts at; always a multiple of
        // the active view's day count (3 or 5).
        dayViewOffset: 0,
        // Per-calendar last-known-good events, keyed by ICS url. Lets a flaky
        // response for one calendar fall back to its previous data instead of
        // silently wiping it from the merged view.
        calendarBuckets: {}
    },

    initialize() {
        this._migrateOldFormat();
        const proxyUrl = this.getProxyUrl();
        const calendars = this.getCalendars();
        const token = this.getProxyToken();
        this.state.isConfigured = !!(proxyUrl && calendars.length > 0 && token);

        // Load cached events + per-calendar last-known-good buckets
        this._loadCachedEvents();
        this._loadCalendarBuckets();

        // Fetch fresh data if configured
        if (this.state.isConfigured) {
            this.fetchEvents();
            this.startAutoRefresh();
        }

        // Live countdown ticker (no-op until countdown elements exist in the DOM).
        // Pause it while the tab is hidden to avoid needless 1Hz work in the background.
        this.startCountdownTicker();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopCountdownTicker();
            } else {
                this._tickCountdowns();      // catch up immediately on return
                this.startCountdownTicker();
            }
        });
    },

    getProxyUrl() {
        return localStorage.getItem(this.config.storageKeys.proxyUrl) || '';
    },

    setProxyUrl(url) {
        Utils.safeLocalStorageSet(this.config.storageKeys.proxyUrl, url);
        this._updateConfiguredState();
    },

    getProxyToken() {
        return localStorage.getItem(this.config.storageKeys.proxyToken) || '';
    },

    setProxyToken(token) {
        Utils.safeLocalStorageSet(this.config.storageKeys.proxyToken, token);
        this._updateConfiguredState();
    },

    // Calendar sources: [{name, color, url}, ...]
    getCalendars() {
        const raw = localStorage.getItem(this.config.storageKeys.calendars);
        if (!raw) return [];
        const parsed = Utils.safeJSONParse(raw, []);
        return Array.isArray(parsed) ? parsed : [];
    },

    setCalendars(calendars) {
        Utils.safeLocalStorageSet(this.config.storageKeys.calendars, JSON.stringify(calendars));
        this._updateConfiguredState();
    },

    addCalendar(name, color, url) {
        const calendars = this.getCalendars();
        calendars.push({ name, color, url });
        this.setCalendars(calendars);
    },

    removeCalendar(index) {
        const calendars = this.getCalendars();
        calendars.splice(index, 1);
        this.setCalendars(calendars);
    },

    updateCalendar(index, name, color, url) {
        const calendars = this.getCalendars();
        if (calendars[index]) {
            calendars[index] = { name, color, url };
            this.setCalendars(calendars);
        }
    },

    // Migrate old plain-text ICS URL format to new structured format
    _migrateOldFormat() {
        const oldIcsUrl = localStorage.getItem('calendarIcsUrl');
        if (oldIcsUrl && !localStorage.getItem(this.config.storageKeys.calendars)) {
            const urls = oldIcsUrl.split('\n').map(u => u.trim()).filter(u => u.length > 0);
            const calendars = urls.map((url, i) => ({
                name: `Calendar ${i + 1}`,
                color: this.config.calendarColors[i % this.config.calendarColors.length].value,
                url
            }));
            this.setCalendars(calendars);
            localStorage.removeItem('calendarIcsUrl');
        }
    },

    getRefreshInterval() {
        const saved = localStorage.getItem(this.config.storageKeys.refreshInterval);
        const parsed = parseInt(saved, 10);
        return isNaN(parsed) ? this.config.defaultRefreshInterval : parsed;
    },

    setRefreshInterval(ms) {
        Utils.safeLocalStorageSet(this.config.storageKeys.refreshInterval, String(ms));
        this.stopAutoRefresh();
        this.startAutoRefresh();
    },

    getDaysAhead() {
        const saved = localStorage.getItem(this.config.storageKeys.daysAhead);
        const parsed = parseInt(saved, 10);
        return isNaN(parsed) ? 7 : parsed;
    },

    setDaysAhead(days) {
        Utils.safeLocalStorageSet(this.config.storageKeys.daysAhead, String(days));
    },

    // ---- Countdown timers ----------------------------------------------------
    // Placement of the per-event countdown: 'pill' | 'time-column' | 'title' | 'right-column'.
    getCountdownPlacement() {
        const v = localStorage.getItem(this.config.storageKeys.countdownPlacement);
        const valid = ['pill', 'time-column', 'title', 'right-column'];
        return valid.includes(v) ? v : 'pill';
    },

    setCountdownPlacement(v) {
        Utils.safeLocalStorageSet(this.config.storageKeys.countdownPlacement, v);
    },

    // Window (in hours) within which an event shows a countdown. 'all' = every future event.
    getCountdownWindow() {
        const v = localStorage.getItem(this.config.storageKeys.countdownWindow);
        const valid = ['24', '36', '48', '72', 'all'];
        return valid.includes(v) ? v : '48';
    },

    setCountdownWindow(v) {
        Utils.safeLocalStorageSet(this.config.storageKeys.countdownWindow, String(v));
    },

    // Minutes-to-start at which the timer turns amber (warning). Clamped 1–180.
    getCountdownWarnMins() {
        const n = parseInt(localStorage.getItem(this.config.storageKeys.countdownWarnMins), 10);
        return isNaN(n) ? 60 : Math.min(180, Math.max(1, n));
    },

    setCountdownWarnMins(n) {
        const v = Math.min(180, Math.max(1, parseInt(n, 10) || 1));
        Utils.safeLocalStorageSet(this.config.storageKeys.countdownWarnMins, String(v));
    },

    // Minutes-to-start at which the timer turns red and pulses (urgent). Clamped 1–180.
    getCountdownUrgentMins() {
        const n = parseInt(localStorage.getItem(this.config.storageKeys.countdownUrgentMins), 10);
        return isNaN(n) ? 10 : Math.min(180, Math.max(1, n));
    },

    setCountdownUrgentMins(n) {
        const v = Math.min(180, Math.max(1, parseInt(n, 10) || 1));
        Utils.safeLocalStorageSet(this.config.storageKeys.countdownUrgentMins, String(v));
    },

    // Format the time until `startMs` as "In [time]". Once the event has started it
    // shows "Ongoing" until `endMs`, then returns null (so the chip is dropped).
    // Shows seconds under an hour so the 1s tick is visible; days/hours otherwise.
    formatCountdown(startMs, endMs) {
        const now = Date.now();
        const diff = startMs - now;

        // Event has already started: show "Ongoing" until it ends, then drop the chip.
        if (diff <= 0) {
            if (endMs != null && now < endMs) {
                return { text: 'Ongoing', tier: 'urgent', ariaLabel: 'Happening now' };
            }
            return null;
        }
        const totalSec = Math.floor(diff / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;

        // Visible text ticks down to the second under an hour so the countdown feels live.
        let text;
        if (days > 0) text = `In ${days}d ${hours}h`;
        else if (hours > 0) text = `In ${hours}h ${mins}m`;
        else if (mins > 0) text = `In ${mins}m ${secs}s`;
        else text = `In ${secs}s`;

        // Warn is the outer band, urgent the inner one. Clamp urgent ≤ warn so the
        // warning band is never empty even if the user sets urgent larger than warn.
        const totalMin = diff / 60000;
        const warnMins = this.getCountdownWarnMins();
        const urgentMins = Math.min(this.getCountdownUrgentMins(), warnMins);
        let tier = 'neutral';
        if (totalMin <= urgentMins) tier = 'urgent';
        else if (totalMin <= warnMins) tier = 'warning';

        // Minute-granular label so screen readers aren't re-announced every second.
        const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
        let ariaLabel;
        if (days > 0) ariaLabel = `Starts in ${plural(days, 'day')} ${plural(hours, 'hour')}`;
        else if (hours > 0) ariaLabel = `Starts in ${plural(hours, 'hour')} ${plural(mins, 'minute')}`;
        else if (mins > 0) ariaLabel = `Starts in ${plural(mins, 'minute')}`;
        else ariaLabel = 'Starts in less than a minute';

        return { text, tier, ariaLabel };
    },

    // Countdown details for one event, or null if it shouldn't show a timer
    // (missing/invalid start, already ended, or outside the chosen window).
    // Events in progress show "Ongoing"; upcoming ones show "In [time]".
    getCountdownInfo(ev) {
        if (!ev || !ev.start) return null;
        let startMs, endMs;
        if (ev.allDay) {
            // All-day events carry no clock time and are stored at midnight UTC; treat
            // them as starting at local midnight of their date. ICS end dates are
            // exclusive, so the stored end is exactly where the span finishes.
            const startDate = new Date(ev.start);
            if (isNaN(startDate)) return null;
            const localMidnight = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
            startMs = localMidnight(startDate);
            const endDate = ev.end ? new Date(ev.end) : null;
            endMs = endDate && !isNaN(endDate) ? localMidnight(endDate) : startMs + 86400000;
        } else {
            startMs = new Date(ev.start).getTime();
            if (isNaN(startMs)) return null;
            endMs = ev.end ? new Date(ev.end).getTime() : startMs;
            if (isNaN(endMs)) endMs = startMs;
        }
        const diff = startMs - Date.now();
        // Upcoming events outside the chosen window show nothing.
        if (diff > 0) {
            const window = this.getCountdownWindow();
            if (window !== 'all' && diff > parseInt(window, 10) * 3600000) return null;
        }
        const info = this.formatCountdown(startMs, endMs);
        return info ? { startMs, endMs, ...info } : null;
    },

    // ---- Upcoming-event bar (day views only) --------------------------------
    // Number of upcoming events shown in the strip above the day-view nav.
    // 0 turns the bar off. Clamped 0–5, default 3.
    getUpcomingBarCount() {
        const n = parseInt(localStorage.getItem(this.config.storageKeys.upcomingBarCount), 10);
        return isNaN(n) ? 3 : Math.min(5, Math.max(0, n));
    },

    setUpcomingBarCount(n) {
        const v = Math.min(5, Math.max(0, parseInt(n, 10) || 0));
        Utils.safeLocalStorageSet(this.config.storageKeys.upcomingBarCount, String(v));
    },

    // Display format for the upcoming bar: 'ticker' (scrolling marquee) | 'list'.
    getUpcomingBarFormat() {
        const v = localStorage.getItem(this.config.storageKeys.upcomingBarFormat);
        return ['ticker', 'list'].includes(v) ? v : 'ticker';
    },

    setUpcomingBarFormat(v) {
        if (!['ticker', 'list'].includes(v)) return;
        Utils.safeLocalStorageSet(this.config.storageKeys.upcomingBarFormat, v);
    },

    // The next N not-yet-started timed events for the upcoming bar. Skips all-day
    // events, anything already started ("ongoing"), and hidden calendars. Drawn
    // from the whole fetched window, NOT just the currently-paged day view.
    getUpcomingBarEvents() {
        const n = this.getUpcomingBarCount();
        if (n <= 0) return [];
        const now = Date.now();
        return this.state.events
            .filter(ev => {
                if (!ev.start || ev.allDay) return false;
                if (this._eventHidden(ev)) return false;
                const startMs = new Date(ev.start).getTime();
                return !isNaN(startMs) && startMs > now;
            })
            .sort((a, b) => new Date(a.start) - new Date(b.start))
            .slice(0, n);
    },

    // Two-unit "in Xd Yh"/"in Xh Ym"/"in Xm" remaining-time text for the upcoming
    // bar. No seconds, so the ticker's item widths don't jitter every tick.
    // Returns null once the event has started (the caller drops it from the bar).
    formatBarCountdown(startMs) {
        const diff = startMs - Date.now();
        if (diff <= 0) return null;
        const totalMin = Math.floor(diff / 60000);
        const days = Math.floor(totalMin / 1440);
        const hours = Math.floor((totalMin % 1440) / 60);
        const mins = totalMin % 60;
        if (days > 0) return `in ${days}d ${hours}h`;
        if (hours > 0) return `in ${hours}h ${mins}m`;
        if (mins > 0) return `in ${mins}m`;
        return 'in <1m';
    },

    startCountdownTicker() {
        if (this.state.countdownTickerId) return;
        this.state.countdownTickerId = setInterval(() => this._tickCountdowns(), 1000);
    },

    stopCountdownTicker() {
        if (this.state.countdownTickerId) {
            clearInterval(this.state.countdownTickerId);
            this.state.countdownTickerId = null;
        }
    },

    // Refresh every rendered countdown in place; drop any whose event has started.
    _tickCountdowns() {
        const els = document.querySelectorAll('.event-countdown[data-countdown-start]');
        for (const el of els) {
            const startMs = parseInt(el.dataset.countdownStart, 10);
            const endRaw = parseInt(el.dataset.countdownEnd, 10);
            const endMs = isNaN(endRaw) ? null : endRaw;
            const info = isNaN(startMs) ? null : this.formatCountdown(startMs, endMs);
            if (!info) { el.remove(); continue; }
            const textEl = el.querySelector('.ec-text');
            // Right-column layout splits "In 2h 51m" into a static "In" label
            // (.ec-prefix) above the ticking value, so strip the prefix here and
            // hide the label once the event starts (text becomes "Ongoing").
            const prefixEl = el.querySelector('.ec-prefix');
            if (prefixEl) {
                const hasIn = info.text.startsWith('In ');
                prefixEl.hidden = !hasIn;
                if (textEl) textEl.textContent = hasIn ? info.text.slice(3) : info.text;
            } else if (textEl) {
                textEl.textContent = info.text;
            }
            if (!el.classList.contains(`tier-${info.tier}`)) {
                el.classList.remove('tier-neutral', 'tier-warning', 'tier-urgent');
                el.classList.add(`tier-${info.tier}`);
            }
            // Only rewrite the label when it actually changes (minute granularity)
            // to avoid re-announcing the countdown to screen readers every second.
            if (el.getAttribute('aria-label') !== info.ariaLabel) {
                el.setAttribute('aria-label', info.ariaLabel);
            }
        }
        this._tickUpcomingBar();
    },

    // Update the upcoming-bar items' remaining-time text in place each tick.
    // When an event starts (formatBarCountdown → null) the bar's contents are
    // stale — re-render the card so the started event drops out and the next
    // upcoming one takes its place. Duplicate ticker copies share a data-bar-start,
    // so a full re-render also keeps the two marquee sequences identical.
    _tickUpcomingBar() {
        const items = document.querySelectorAll('.cal-upcoming-item[data-bar-start]');
        if (!items.length) return;
        for (const el of items) {
            const startMs = parseInt(el.dataset.barStart, 10);
            const text = isNaN(startMs) ? null : this.formatBarCountdown(startMs);
            if (!text) {
                if (window.UIRenderer) UIRenderer.renderCalendarCard();
                return;
            }
            const timeEl = el.querySelector('.cal-upcoming-time');
            if (timeEl && timeEl.dataset.barText !== text) {
                timeEl.dataset.barText = text;
                // The ticker prefixes the time with "· "; the list shows it bare.
                timeEl.textContent = el.classList.contains('cal-upcoming-tick') ? `· ${text}` : text;
            }
            // Keep the accessible name's time in sync with the visible countdown so
            // a focused item never announces a stale "starting …". Skip aria-hidden
            // duplicate ticker items (they carry no label and aren't announced).
            if (el.getAttribute('aria-hidden') !== 'true') {
                const name = el.querySelector('.cal-upcoming-name')?.textContent || '';
                const label = `View details: ${name}, starting ${text}`;
                if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
            }
        }
    },

    // Calendar card height: 'auto' (fit column) or a row-height multiplier '1'..'10' (0.5 steps).
    HEIGHT_OPTIONS: ['auto', ...Array.from({ length: 19 }, (_, i) => String(1 + i * 0.5))],

    getHeight() {
        const v = localStorage.getItem(this.config.storageKeys.height);
        return this.HEIGHT_OPTIONS.includes(v) ? v : 'auto';
    },

    setHeight(val) {
        Utils.safeLocalStorageSet(this.config.storageKeys.height, String(val));
    },

    _updateConfiguredState() {
        const proxyUrl = this.getProxyUrl();
        const calendars = this.getCalendars();
        const token = this.getProxyToken();
        this.state.isConfigured = !!(proxyUrl && calendars.length > 0 && token);
    },

    _loadCachedEvents() {
        const cached = localStorage.getItem(this.config.storageKeys.cachedEvents);
        if (cached) {
            const parsed = Utils.safeJSONParse(cached, []);
            if (Array.isArray(parsed)) {
                this.state.events = parsed;
            }
        }
        const lastFetched = localStorage.getItem(this.config.storageKeys.lastFetched);
        if (lastFetched) {
            this.state.lastFetched = new Date(lastFetched);
        }
    },

    _cacheEvents(events) {
        this.state.events = events;
        this.state.lastFetched = new Date();
        Utils.safeLocalStorageSet(this.config.storageKeys.cachedEvents, JSON.stringify(events));
        Utils.safeLocalStorageSet(this.config.storageKeys.lastFetched, this.state.lastFetched.toISOString());
    },

    _loadCalendarBuckets() {
        const raw = localStorage.getItem(this.config.storageKeys.calendarBuckets);
        const parsed = raw ? Utils.safeJSONParse(raw, {}) : {};
        this.state.calendarBuckets = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        return this.state.calendarBuckets;
    },

    _saveCalendarBuckets() {
        Utils.safeLocalStorageSet(
            this.config.storageKeys.calendarBuckets,
            JSON.stringify(this.state.calendarBuckets)
        );
    },

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async fetchEvents() {
        if (this.state.isFetching) return;
        if (!this.state.isConfigured) return;

        const proxyUrl = this.getProxyUrl();
        const calendars = this.getCalendars();
        const token = this.getProxyToken();

        // Validate proxy URL
        if (!proxyUrl.startsWith('https://script.google.com/')) {
            this.state.fetchError = 'Invalid proxy URL';
            return;
        }

        this.state.isFetching = true;
        this.state.fetchError = null;

        const buckets = this.state.calendarBuckets;
        const problems = [];   // human-readable issues, surfaced as the error indicator
        const diag = [];       // per-calendar counts for the console

        try {
            // Fetch sequentially, not in parallel: both calendars share one Apps
            // Script deployment, and concurrent requests get throttled — which
            // returns truncated/empty ICS data for the second one with no error.
            for (let i = 0; i < calendars.length; i++) {
                const cal = calendars[i];
                const label = cal.name || `Calendar ${i + 1}`;
                const url = (cal.url || '').trim();
                // Skip half-entered calendars (blank url) — they'd all collide on the
                // same bucket key and just produce noise while the user is editing.
                if (!url) continue;

                const prev = Array.isArray(buckets[url]) ? buckets[url] : null;
                // Did the cached copy still have events in the future? Used to decide
                // whether a sudden empty response is worth a second (cache-busted) look.
                const prevHasUpcoming = !!prev && prev.some(ev => {
                    const t = new Date(ev.end || ev.start).getTime();
                    return !isNaN(t) && t > Date.now();
                });

                let events = null;
                let lastErr = null;
                // Up to one retry with a cache-buster, to defeat a stale/throttled
                // response — triggered by an error OR by an unexpected empty result.
                for (let attempt = 0; attempt < 2 && events === null; attempt++) {
                    try {
                        const raw = await this._fetchSingleCalendar(proxyUrl, token, url, attempt);
                        const mapped = raw.map(ev => ({ ...ev, _calName: cal.name, _calColor: cal.color, _calUrl: cal.url }));
                        if (mapped.length === 0 && prevHasUpcoming && attempt === 0) {
                            await this._delay(700);   // suspicious empty — try once more, fresh
                            continue;
                        }
                        events = mapped;
                    } catch (err) {
                        lastErr = err;
                        if (attempt === 0) await this._delay(700);
                    }
                }

                if (events === null) {
                    // Hard (network) failure: keep last-known-good rather than dropping
                    // the calendar. A blip should never blank already-fetched events.
                    diag.push(prev ? `${label}: error (kept ${prev.length})` : `${label}: error`);
                    problems.push(`${label}: ${lastErr?.message || 'fetch failed'}${prev ? ' (showing cached)' : ''}`);
                    continue;
                }

                // A confirmed result (incl. empty after the cache-busted retry) is trusted:
                // two fresh empties is real, so accept it instead of clinging to stale data.
                buckets[url] = events;
                diag.push(events.length === 0 && prevHasUpcoming
                    ? `${label}: 0 (was ${prev.length})`
                    : `${label}: ${events.length}`);
            }

            // Drop buckets for calendars that are no longer configured (or blank-url'd).
            const validUrls = new Set(calendars.map(c => (c.url || '').trim()).filter(Boolean));
            for (const url of Object.keys(buckets)) {
                if (!validUrls.has(url)) delete buckets[url];
            }

            const allEvents = Object.values(buckets).flat();
            this._cacheEvents(allEvents);
            this._saveCalendarBuckets();

            if (problems.length > 0) {
                // file:// is an opaque origin — the browser blocks the cross-origin
                // request to the proxy, so fetches fail and only browser-cached
                // responses (if any) show. Make that the visible reason.
                this.state.fetchError = (location.protocol === 'file:')
                    ? 'Calendar can\'t load from a file:// page (browser blocks the request). Run serve.bat / VS Code Live Server and open the app at http://localhost.'
                    : (problems.length === calendars.length
                        ? problems[0]
                        : `${problems.length} of ${calendars.length} calendars had issues`);
            }
            console.info(`[CalendarManager] fetch — ${diag.join(' | ')}`);
        } catch (err) {
            this.state.fetchError = err.message || 'Failed to fetch events';
            console.warn('[CalendarManager] Fetch error:', err.message);
        } finally {
            this.state.isFetching = false;
            // Scoped re-render: replace only the calendar card so other cards,
            // scroll position, and focused inputs are not disturbed.
            if (window.UIRenderer) {
                UIRenderer.renderCalendarCard();
            }
        }
    },

    isEmbedUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'calendar.google.com' && parsed.pathname.startsWith('/calendar/embed');
        } catch { return false; }
    },

    async _fetchSingleCalendar(proxyUrl, token, icsUrl, attempt = 0) {
        const days = this.getDaysAhead();
        const daysBack = this.config.daysBack;
        const url = `${proxyUrl}?token=${encodeURIComponent(token)}&url=${encodeURIComponent(icsUrl)}&days=${days}&daysBack=${daysBack}`;

        // Use JSONP (a <script> tag), NOT fetch(). The Apps Script /exec URL 302-redirects
        // to googleusercontent.com and that redirect returns no Access-Control-Allow-Origin
        // header, so fetch() is CORS-blocked from EVERY browser origin (localhost included).
        // A <script> tag isn't subject to CORS and follows the redirect fine from a real
        // origin; the proxy supports it via the `callback` parameter. (This needs the app
        // served over http://localhost — it can't work from a file:// page.)
        const data = await this._jsonpFetch(url, 15000);

        if (data && data.error) throw new Error(data.error);
        if (data && Array.isArray(data.events)) {
            return data.events.filter(ev =>
                ev && typeof ev === 'object' && typeof ev.start === 'string'
            );
        }
        return [];
    },

    // JSONP loader: appends &callback=<uniqueFn>, injects a <script>, resolves with the
    // object the proxy passes to that callback. The unique callback name also makes each
    // request URL unique, so responses are never served stale from cache. Self-cleans.
    _jsonpFetch(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const cbName = `__pomoCalCb_${Date.now()}_${this._jsonpSeq = (this._jsonpSeq || 0) + 1}`;
            const script = document.createElement('script');
            let settled = false;

            const cleanup = () => {
                settled = true;
                clearTimeout(timer);
                try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
                if (script.parentNode) script.parentNode.removeChild(script);
            };
            const timer = setTimeout(() => {
                if (!settled) { cleanup(); reject(new Error('Request timed out')); }
            }, timeoutMs);

            window[cbName] = (data) => { if (!settled) { cleanup(); resolve(data); } };
            script.onerror = () => {
                if (!settled) { cleanup(); reject(new Error('Network error / blocked request')); }
            };
            script.src = `${url}&callback=${cbName}`;
            document.head.appendChild(script);
        });
    },

    getUpcomingEvents() {
        const now = new Date();
        const tz = this._getTimezone();
        // Compute "today" (midnight) in the configured timezone
        const dateOpts = { year: 'numeric', month: '2-digit', day: '2-digit' };
        if (tz) dateOpts.timeZone = tz;
        const todayParts = now.toLocaleDateString('en-CA', dateOpts).split('-'); // YYYY-MM-DD
        const today = new Date(Date.UTC(+todayParts[0], +todayParts[1] - 1, +todayParts[2]));
        const maxDate = new Date(today);
        maxDate.setUTCDate(maxDate.getUTCDate() + this.getDaysAhead());
        const anchorTz = this.getAnchorTimezone();
        const todayAnchorStr = this._dateOnly(now, anchorTz);
        return this.state.events
            .filter(ev => {
                if (!ev.start) return false;
                if (this._eventHidden(ev)) return false;
                const start = new Date(ev.start);
                const end = ev.end ? new Date(ev.end) : start;
                // The visible end: zero-/negative-duration events end where they start.
                const effectiveEnd = end > start ? end : start;
                // Ongoing/upcoming: show while it hasn't ended and starts inside the window.
                if (effectiveEnd > now) return start < maxDate;
                // Unparseable start: _dateOnly would yield "Invalid Date", which compares
                // lexicographically >= any "YYYY-MM-DD" string — drop it explicitly.
                if (isNaN(start)) return false;
                // Already ended: keep it (rendered struck-through) while "today" in the
                // grouping/anchor timezone still falls on one of the event's visible days.
                const lastVisible = ev.allDay && !isNaN(end)
                    ? new Date(Math.max(start.getTime(), end.getTime() - 86400000)) // all-day end is exclusive
                    : effectiveEnd;   // unparseable end: treat as single-day (effectiveEnd === start)
                return this._dateOnly(lastVisible, anchorTz) >= todayAnchorStr;
            })
            .sort((a, b) => new Date(a.start) - new Date(b.start));
    },

    // Events whose [start, effectiveEnd) intersects [rangeStart, rangeEnd). NO "already ended" filter.
    getEventsInRange(rangeStart, rangeEnd) {
        return this.state.events.filter(ev => {
            if (!ev.start) return false;
            if (this._eventHidden(ev)) return false;
            const start = new Date(ev.start);
            const end = ev.end ? new Date(ev.end) : start;
            const effectiveEnd = end > start ? end : start;
            return start < rangeEnd && effectiveEnd > rangeStart;
        }).sort((a, b) => new Date(a.start) - new Date(b.start));
    },

    // Buckets state.events into the window's days (anchor tz), duplicating multi-day spans
    // with _overnight markers. Mirrors groupEventsByDay semantics but WITHOUT its today-onward filter.
    bucketEventsForDayView(win) {   // win = getDayViewWindow()
        const { days, tz } = win;
        const first = days[0].dateStr, last = days[days.length - 1].dateStr;
        const buckets = Object.fromEntries(days.map(d => [d.dateStr, []]));
        for (const ev of this.state.events) {
            if (!ev.start) continue;
            if (this._eventHidden(ev)) continue;
            const start = new Date(ev.start);
            const end = ev.end ? new Date(ev.end) : start;
            // all-day end is EXCLUSIVE -> last visible day is end - 1 day (guard zero-length)
            const lastDate = ev.allDay ? new Date(Math.max(start.getTime(), end.getTime() - 86400000)) : (end > start ? end : start);
            const startStr = this._dateOnly(start, tz);
            const lastStr = this._dateOnly(lastDate, tz);
            if (lastStr < first || startStr > last) continue;
            const multi = startStr !== lastStr;
            for (const d of days) {
                if (d.dateStr < startStr || d.dateStr > lastStr) continue;
                buckets[d.dateStr].push(multi
                    ? { ...ev, _overnight: d.dateStr === startStr ? 'continues'
                                         : d.dateStr === lastStr ? 'started' : 'spanning' }
                    : ev);
            }
        }
        for (const key of Object.keys(buckets)) {
            buckets[key].sort((a, b) => (Number(b.allDay) - Number(a.allDay)) || (new Date(a.start) - new Date(b.start)));
        }
        return buckets;
    },

    getLastFetchedLabel() {
        if (!this.state.lastFetched) return '';
        const diffMs = Date.now() - this.state.lastFetched.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    },

    startAutoRefresh() {
        this.stopAutoRefresh();
        if (!this.state.isConfigured) return;
        const interval = this.getRefreshInterval();
        this.state.intervalId = setInterval(() => this.fetchEvents(), interval);
    },

    stopAutoRefresh() {
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
            this.state.intervalId = null;
        }
    },

    // ---- Grouping mode: group by any enabled Settings clock (Clocks page), or none ----
    groupingModes: ['tz1', 'tz2', 'tz3', 'none'],

    getGrouping() {
        const v = localStorage.getItem(this.config.storageKeys.grouping);
        if (!this.groupingModes.includes(v)) return 'tz1';
        if (v === 'none') return v;
        // A grouping pinned to a since-disabled clock falls back to Clock #1.
        const zone = this._resolveZone(`timezone${v.slice(2)}`);
        if (!zone) return 'tz1';
        // Normalize to the first clock resolving to the same zone, so the active
        // mode is always one of the menu's de-duplicated entries.
        for (const mode of ['tz1', 'tz2', 'tz3']) {
            if (this._resolveZone(`timezone${mode.slice(2)}`) === zone) return mode;
        }
        return v;
    },

    setGrouping(mode) {
        if (!this.groupingModes.includes(mode)) return;
        Utils.safeLocalStorageSet(this.config.storageKeys.grouping, mode);
        if (window.UIRenderer) UIRenderer.renderCalendarCard();
    },

    // Options for the grouping dropdown: one entry per enabled Settings clock
    // (Clock #1–#3, skipping disabled clocks and duplicate zones), plus 'none'.
    getGroupingOptions() {
        const seen = new Set();
        const out = [];
        ['tz1', 'tz2', 'tz3'].forEach(mode => {
            const id = this._resolveZone(`timezone${mode.slice(2)}`);
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push({ mode, label: this._tzLabel(id) });
        });
        out.push({ mode: 'none', label: 'No grouping' });
        return out;
    },

    // ---- View mode (3-way toggle: list, rolling 3-day, rolling 5-day) ----
    // Ordered options for the view dropdown.
    viewModes: ['list', '3day', '5day', 'week'],

    getViewMode() {
        const v = localStorage.getItem(this.config.storageKeys.viewMode);
        return this.viewModes.includes(v) ? v : 'list';
    },

    setViewMode(mode) {
        if (!this.viewModes.includes(mode)) return;
        Utils.safeLocalStorageSet(this.config.storageKeys.viewMode, mode);
        this.state.dayViewOffset = 0;
        if (window.UIRenderer) UIRenderer.renderCalendarCard();
    },

    getViewModeLabel() {
        return { list: 'List', '3day': '3-Day', '5day': '5-Day', week: 'Week' }[this.getViewMode()];
    },

    getViewDayCount() {
        return { list: 0, '3day': 3, '5day': 5, week: 7 }[this.getViewMode()];
    },

    // ---- Per-calendar visibility -------------------------------------------
    // Hidden calendars stay subscribed (their url/ics is kept) but their events
    // are filtered out of every display path. Persisted as an array of urls.
    getHiddenCalendars() {
        const raw = localStorage.getItem(this.config.storageKeys.hiddenCalendars);
        if (!raw) return [];
        const parsed = Utils.safeJSONParse(raw, []);
        return Array.isArray(parsed) ? parsed : [];
    },

    isCalendarHidden(url) {
        return this.getHiddenCalendars().includes(url);
    },

    // Toggle a calendar's visibility by its index in getCalendars(). Taking an
    // index (not a url) keeps untrusted url strings out of inline onclick markup.
    toggleCalendarVisibility(index) {
        const cal = this.getCalendars()[index];
        if (!cal) return;
        const hidden = this.getHiddenCalendars();
        const at = hidden.indexOf(cal.url);
        if (at === -1) hidden.push(cal.url); else hidden.splice(at, 1);
        Utils.safeLocalStorageSet(this.config.storageKeys.hiddenCalendars, JSON.stringify(hidden));
        // Scoped refresh: update the events + legend in place so the (already-open)
        // legend popover the user just clicked in stays open, and restore focus to
        // the toggled row for keyboard users.
        if (window.UIRenderer) UIRenderer.refreshCalendarEventsAndLegend(index);
    },

    // True when the event belongs to a hidden calendar. Matches by url; legacy
    // cached events (fetched before _calUrl tagging) fall back to name matching.
    _eventHidden(ev) {
        const hidden = this.getHiddenCalendars();
        if (!hidden.length) return false;
        if (ev._calUrl) return hidden.includes(ev._calUrl);
        if (ev._calName) {
            const hiddenNames = this.getCalendars()
                .filter(c => hidden.includes(c.url))
                .map(c => c.name);
            return hiddenNames.includes(ev._calName);
        }
        return false;
    },

    // ---- Hour-by-hour timeline mode (day views only) -----------------------
    getTimelineMode() {
        return localStorage.getItem(this.config.storageKeys.timelineMode) === 'on';
    },

    toggleTimelineMode() {
        Utils.safeLocalStorageSet(this.config.storageKeys.timelineMode, this.getTimelineMode() ? 'off' : 'on');
        if (window.UIRenderer) UIRenderer.renderCalendarCard();
    },

    // UTC-ms of local midnight for `dateStr` (YYYY-MM-DD) in zone `tz`. Used to
    // convert event instants into minutes-of-day for timeline positioning.
    _zonedDayStartMs(dateStr, tz) {
        const [y, mo, d] = dateStr.split('-').map(Number);
        const utcGuess = Date.UTC(y, mo - 1, d);
        if (!tz) return new Date(y, mo - 1, d).getTime();   // local zone
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
            day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(new Date(utcGuess));
        const m = {};
        for (const p of parts) m[p.type] = p.value;
        let hh = +m.hour; if (hh === 24) hh = 0;   // some engines emit '24' for midnight
        const localAsUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hh, +m.minute, +m.second);
        const offset = localAsUTC - utcGuess;      // how far tz is ahead of UTC here
        return utcGuess - offset;
    },

    // Build positioned geometry for the timeline view. Returns a shared hour
    // range plus, per day, all-day events and time-positioned (lane-packed)
    // timed events as percentages of the total grid height.
    buildTimelineModel(win) {
        const { days, tz } = win;
        const buckets = this.bucketEventsForDayView(win);
        const DAY_MS = 86400000;

        // First pass: compute each timed event's day-clamped [startMin, endMin]
        // and track the global min/max to size the shared hour axis.
        let minStart = Infinity, maxEnd = -Infinity;
        const perDay = days.map(d => {
            const dayStart = this._zonedDayStartMs(d.dateStr, tz);
            const dayEnd = dayStart + DAY_MS;
            const allDay = [];
            const timed = [];
            for (const ev of (buckets[d.dateStr] || [])) {
                if (ev.allDay || ev._overnight === 'spanning') { allDay.push(ev); continue; }
                const s = new Date(ev.start).getTime();
                const e = (ev.end ? new Date(ev.end).getTime() : s);
                if (!Number.isFinite(s) || !Number.isFinite(e)) continue;  // unparseable date → skip
                const segStart = Math.max(s, dayStart);
                const segEnd = Math.min(Math.max(e, s + 60000), dayEnd);   // min 1-min duration
                // No in-day extent (e.g. an event ending exactly at this day's
                // midnight boundary) — occupies no time today, so skip it here
                // rather than misfiling it into the all-day band.
                if (segEnd <= segStart) continue;
                const startMin = (segStart - dayStart) / 60000;
                const endMin = (segEnd - dayStart) / 60000;
                minStart = Math.min(minStart, startMin);
                maxEnd = Math.max(maxEnd, endMin);
                timed.push({ ev, startMin, endMin });
            }
            return { day: d, dayStart, allDay, timed };
        });

        // Shared hour range: fit to events (hour-aligned), fall back to 8–18.
        let rangeStartMin, rangeEndMin;
        if (minStart === Infinity) { rangeStartMin = 8 * 60; rangeEndMin = 18 * 60; }
        else {
            rangeStartMin = Math.max(0, Math.floor(minStart / 60) * 60);
            rangeEndMin = Math.min(1440, Math.ceil(maxEnd / 60) * 60);
            if (rangeEndMin - rangeStartMin < 60) rangeEndMin = Math.min(1440, rangeStartMin + 60);
        }
        // Merged free stretches: 2+ consecutive hour slots with no timed event on
        // ANY visible day. Detected BEFORE positioning because each stretch is
        // COLLAPSED to a single reduced-height row in the display, which warps
        // the minutes→pixels mapping for everything positioned below it.
        const GAP_ROW_MIN = 39;   // a merged gap renders at 65% of an hour-row
        const rawGaps = [];
        let runStart = null;
        for (let m = rangeStartMin; m <= rangeEndMin; m += 60) {
            const free = m < rangeEndMin
                && !perDay.some(pd => pd.timed.some(t => t.startMin < m + 60 && t.endMin > m));
            if (free) { if (runStart === null) runStart = m; continue; }
            if (runStart !== null && m - runStart >= 120) {
                rawGaps.push({ startMin: runStart, endMin: m });
            }
            runStart = null;
        }

        // Piecewise minutes → display-minutes: time inside a collapsed gap is
        // squeezed into its single row; time below it shifts up by the rows
        // removed. Events can never straddle a gap (gaps are event-free on every
        // day by construction), so event heights are preserved. Hour boundaries
        // below a gap leave the fixed hour lattice (the collapsed row is
        // sub-hour), so gridlines are drawn per hour off this same mapping.
        const dispMin = (m) => {
            let d = m - rangeStartMin;
            for (const g of rawGaps) {
                if (m <= g.startMin) break;
                const len = g.endMin - g.startMin;
                d -= m >= g.endMin ? (len - GAP_ROW_MIN)
                                   : (m - g.startMin) * (1 - GAP_ROW_MIN / len);
            }
            return d;
        };
        const displaySpanMin = dispMin(rangeEndMin);
        const pct = (min) => (dispMin(min) / displaySpanMin) * 100;
        const hourLabel = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:00`;

        // Hour-axis labels: boundary hours only — hours interior to a collapsed
        // gap have no gridline of their own (the band's label names the range).
        const hours = [];
        for (let m = rangeStartMin; m <= rangeEndMin; m += 60) {
            if (rawGaps.some(g => g.startMin < m && m < g.endMin)) continue;
            hours.push({ min: m, label: String(Math.floor(m / 60)).padStart(2, '0'), topPct: pct(m) });
        }

        const nowMs = Date.now();
        const days2 = perDay.map(pd => {
            // Lane-pack overlapping timed events. Events are already sorted by start
            // (bucketEventsForDayView). We first split the day into connected overlap
            // *clusters* (a new cluster begins where an event starts at/after every
            // prior event's end), then greedily assign lanes WITHIN each cluster so a
            // lane count is local to its cluster — an isolated afternoon event stays
            // full width even when the morning has a 2-way overlap.
            const visible = pd.timed.filter(t => t.endMin > rangeStartMin && t.startMin < rangeEndMin);
            const positioned = [];
            let cluster = [], clusterMaxEnd = -Infinity;
            const flush = () => {
                if (!cluster.length) return;
                const laneEnds = [];
                for (const t of cluster) {
                    let lane = laneEnds.findIndex(end => end <= t.startMin);
                    if (lane === -1) { lane = laneEnds.length; laneEnds.push(t.endMin); }
                    else laneEnds[lane] = t.endMin;
                    t._lane = lane;
                }
                const laneCount = laneEnds.length;
                for (const t of cluster) {
                    const vs = Math.max(t.startMin, rangeStartMin);
                    const ve = Math.min(t.endMin, rangeEndMin);
                    positioned.push({ ev: t.ev, topPct: pct(vs), heightPct: pct(ve) - pct(vs), lane: t._lane, laneCount });
                }
                cluster = []; clusterMaxEnd = -Infinity;
            };
            for (const t of visible) {
                if (cluster.length && t.startMin >= clusterMaxEnd) flush();
                cluster.push(t);
                clusterMaxEnd = Math.max(clusterMaxEnd, t.endMin);
            }
            flush();
            // Current-time indicator on the day the wall-clock now falls in.
            let nowTopPct = null;
            if (nowMs >= pd.dayStart && nowMs < pd.dayStart + DAY_MS) {
                const nm = (nowMs - pd.dayStart) / 60000;
                if (nm >= rangeStartMin && nm <= rangeEndMin) nowTopPct = pct(nm);
            }
            return { day: pd.day, allDay: pd.allDay, timed: positioned, nowTopPct };
        });

        // Display geometry for the collapsed gap bands, labeled with the real
        // hour range they stand in for.
        const gaps = rawGaps.map(g => ({
            startMin: g.startMin,
            endMin: g.endMin,
            label: `${hourLabel(g.startMin)} – ${hourLabel(g.endMin)}`,
            topPct: pct(g.startMin),
            heightPct: pct(g.endMin) - pct(g.startMin)   // exactly GAP_ROW_MIN tall
        }));

        return { rangeStartMin, rangeEndMin, displaySpanMin, hours, days: days2, gaps, tz };
    },

    // Resolve a stored clock setting ('local'/'UTC'/IANA id) to a concrete IANA zone.
    // Returns undefined for disabled ('none'). Defaults match the clock settings:
    // Clock #1 → local, Clock #2 → UTC, Clock #3 → none (disabled).
    _resolveZone(key) {
        const defaults = { timezone1: 'local', timezone2: 'UTC', timezone3: 'none' };
        const raw = localStorage.getItem(key) || defaults[key] || 'local';
        if (raw === 'none') return undefined;
        if (raw === 'local') return Intl.DateTimeFormat().resolvedOptions().timeZone;
        return raw;
    },

    // IANA zone that the day-grouping headers are anchored to (undefined when ungrouped).
    getGroupingTimezone() {
        const mode = this.getGrouping();
        if (mode === 'none') return undefined;
        return this._resolveZone(`timezone${mode.slice(2)}`);
    },

    // IANA zone that day-view columns are anchored to. Day columns always need one
    // concrete zone, but getGroupingTimezone() returns undefined when grouping='none' —
    // fall back to Clock #1, then the browser's own zone (never undefined).
    getAnchorTimezone() {
        return this.getGroupingTimezone() || this._resolveZone('timezone1')
            || Intl.DateTimeFormat().resolvedOptions().timeZone;
    },

    // { days: [{dateStr:'YYYY-MM-DD', label:'Tue Jul 8', isToday}], tz, offset }
    // Days from today to the window's first day when dayViewOffset === 0.
    // 0 for the rolling n-day views; for 'week' it snaps back to Monday of the
    // week that contains today (so week view always runs Mon–Sun).
    _baseOffsetFromToday() {
        if (this.getViewMode() !== 'week') return 0;
        const todayStr = this._dateOnly(new Date(), this.getAnchorTimezone());
        const [y, mo, d] = todayStr.split('-').map(Number);
        const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();  // 0=Sun..6=Sat
        return -((dow + 6) % 7);                                    // days since Monday
    },

    getDayViewWindow() {
        const n = this.getViewDayCount();
        const tz = this.getAnchorTimezone();
        const now = new Date();
        const todayStr = this._dateOnly(now, tz);
        // Anchor the day sequence in the anchor tz using date-only (UTC) arithmetic
        // so it stays DST-immune: shifting a wall-clock Date by local calendar days
        // and reprojecting into a different tz can skip or duplicate a day across a
        // DST boundary. Labels are formatted in UTC to match the date-only base.
        const [ty, tm, td] = todayStr.split('-').map(Number);
        const base = new Date(Date.UTC(ty, tm - 1, td));
        const startOffset = this._baseOffsetFromToday() + this.state.dayViewOffset;
        const labelOpts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
        const days = [];
        for (let i = 0; i < n; i++) {
            const d = new Date(base);
            d.setUTCDate(base.getUTCDate() + startOffset + i);
            const dateStr = this._dateOnly(d, 'UTC');
            days.push({ dateStr, label: d.toLocaleDateString('en-US', labelOpts), isToday: dateStr === todayStr });
        }
        return { days, tz, offset: this.state.dayViewOffset };
    },

    // Enable paging while the candidate window still overlaps the fetched data
    // range [today - daysBack, today + daysAhead - 1]. Works for the rolling
    // views and the Monday-anchored week view alike.
    canPageDayView(dir) {           // dir: -1 | +1
        const n = this.getViewDayCount();
        const first = this._baseOffsetFromToday() + this.state.dayViewOffset + dir * n;
        const last = first + n - 1;
        return last >= -this.config.daysBack && first <= this.getDaysAhead() - 1;
    },

    pageDayView(dir) {
        if (!this.canPageDayView(dir)) return;
        this.state.dayViewOffset += dir * this.getViewDayCount();
        if (window.UIRenderer) UIRenderer.renderCalendarCard();
    },

    resetDayViewToToday() {
        this.state.dayViewOffset = 0;
        if (window.UIRenderer) UIRenderer.renderCalendarCard();
    },

    // Label shown on the header toggle button.
    getGroupingLabel() {
        if (this.getGrouping() === 'none') return 'No grouping';
        const id = this.getGroupingTimezone();
        return id ? this._tzLabel(id) : 'No grouping';
    },

    // Zones shown on every event row (Clock #1, #2, then #3 if enabled), de-duplicated.
    _displayTimezones() {
        const seen = new Set();
        const out = [];
        for (const key of ['timezone1', 'timezone2', 'timezone3']) {
            const id = this._resolveZone(key);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push({ id, label: this._tzLabel(id) });
        }
        return out;
    },

    // Friendly short label for a zone: curated names, then DST-aware abbreviation, then path tail.
    _tzLabel(id) {
        const friendly = {
            'Asia/Ho_Chi_Minh': 'VN',
            'America/New_York': 'ET'
        };
        if (friendly[id]) return friendly[id];
        try {
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'short' })
                .formatToParts(new Date());
            const name = parts.find(p => p.type === 'timeZoneName')?.value;
            if (name && !/^(GMT|UTC[+-])/.test(name)) return name; // e.g. EST/EDT/ICT
            if (name) return name; // UTC or GMT±N fallback is still meaningful
        } catch (_) { /* invalid zone — fall through */ }
        return id.split('/').pop().replace(/_/g, ' ');
    },

    // Build the per-zone "date + time" lines for one event: [{ label, when }, ...].
    // When grouped by a zone, that zone's row is shown first. `withDate` appends
    // the weekday/calendar date to relative (Today/Tomorrow) days.
    formatEventTimeZones(ev, withDate = false) {
        const zones = this._displayTimezones();
        const groupId = this.getGroupingTimezone();
        if (groupId) {
            const idx = zones.findIndex(z => z.id === groupId);
            if (idx > 0) zones.unshift(zones.splice(idx, 1)[0]);
        }
        // Relative labels (Today/Yesterday/Tomorrow) are anchored to ONE reference
        // zone — the grouping/anchor zone — so a single event reads coherently
        // across rows (grouped by VN: VN "Today", an earlier PDT date "Yesterday")
        // instead of every row saying "Today" against its own local date.
        const refTz = this.getAnchorTimezone();
        return zones.map(z => ({
            label: z.label,
            when: this._formatWhen(ev, z.id, withDate, refTz)
        }));
    },

    // Date + time indicator for a single event in a single zone. `refTz` is the
    // zone whose "today" the relative labels are measured against (defaults to tz).
    _formatWhen(ev, tz, withDate = false, refTz = tz) {
        const start = new Date(ev.start);
        const end = ev.end ? new Date(ev.end) : start;

        if (ev.allDay) {
            // ICS all-day end is exclusive, so the last visible day is end - 1 day.
            const lastDay = new Date(end.getTime() - 86400000);
            if (end <= start || this._dateOnly(start, tz) === this._dateOnly(lastDay, tz)) {
                return `${this._dayIndicator(start, tz, withDate, refTz)} (All)`;
            }
            return `${this._dayIndicator(start, tz, withDate, refTz)} → ${this._dayIndicator(lastDay, tz, withDate, refTz)} (All)`;
        }

        const startTime = this._timeStr(start, tz);
        const endTime = this._timeStr(end, tz);
        if (this._dateOnly(start, tz) === this._dateOnly(end, tz)) {
            return `${this._dayIndicator(start, tz, withDate, refTz)} · ${startTime}–${endTime}`;
        }
        // Crosses midnight in this zone
        return `${this._dayIndicator(start, tz, withDate, refTz)} ${startTime} → ${this._dayIndicator(end, tz, withDate, refTz)} ${endTime}`;
    },

    // Non-relative: 'Mon, Jun 1'. Relative days: 'Today' (compact) or, when
    // withDate is set, 'Today · Mon, Jun 1'. Computed in the given zone, so the
    // date is correct per timezone. List-view rows stay compact (withDate false);
    // the detail modal and day-view date fields pass withDate true.
    _dayIndicator(date, tz, withDate = false, refTz = tz) {
        const now = new Date();
        const dStr = this._dateOnly(date, tz);            // event's calendar date in the row zone
        // "Today" is measured against refTz's current date, so every row of one
        // event shares a single reference day. Yesterday/Tomorrow via UTC
        // date-string arithmetic off that reference (DST-immune).
        const todayStr = this._dateOnly(now, refTz);
        const [ry, rm, rd] = todayStr.split('-').map(Number);
        const shift = (n) => this._dateOnly(new Date(Date.UTC(ry, rm - 1, rd + n)), 'UTC');
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (tz) opts.timeZone = tz;
        const abs = date.toLocaleDateString('en-US', opts);
        let label = null;
        if (dStr === todayStr) label = 'Today';
        else if (dStr === shift(1)) label = 'Tomorrow';
        else if (dStr === shift(-1)) label = 'Yesterday';
        if (!label) return abs;
        return withDate ? `${label} · ${abs}` : label;
    },

    _dateOnly(date, tz) {
        const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
        if (tz) opts.timeZone = tz;
        return date.toLocaleDateString('en-CA', opts);
    },

    _timeStr(date, tz) {
        const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
        if (tz) opts.timeZone = tz;
        return date.toLocaleTimeString('en-US', opts);
    },

    // Group events by day label, duplicating multi-day events across each day they span.
    // `tz` is the IANA zone the day boundaries are anchored to.
    groupEventsByDay(events, tz) {
        const groups = {};
        const dateOpts = { year: 'numeric', month: '2-digit', day: '2-digit' };
        if (tz) dateOpts.timeZone = tz;
        const labelOpts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (tz) labelOpts.timeZone = tz;

        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', dateOpts);
        const tomorrowDate = new Date(now);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', dateOpts);

        const getDayLabel = (date) => {
            const dateStr = date.toLocaleDateString('en-CA', dateOpts);
            if (dateStr === todayStr) return 'Today - ' + date.toLocaleDateString('en-US', labelOpts);
            if (dateStr === tomorrowStr) return 'Tomorrow - ' + date.toLocaleDateString('en-US', labelOpts);
            return date.toLocaleDateString('en-US', labelOpts);
        };

        const addToGroup = (label, ev) => {
            if (!groups[label]) groups[label] = [];
            groups[label].push(ev);
        };

        for (const ev of events) {
            const startDate = new Date(ev.start);
            const endDate = ev.end ? new Date(ev.end) : startDate;
            const startDayStr = startDate.toLocaleDateString('en-CA', dateOpts);
            // For all-day events, end date in ICS is exclusive (day after last day)
            // so the last visible day is endDate - 1 day
            const lastDate = ev.allDay ? new Date(endDate.getTime() - 86400000) : endDate;
            const lastDayStr = lastDate.toLocaleDateString('en-CA', dateOpts);

            if (startDayStr === lastDayStr) {
                // Single-day event
                addToGroup(getDayLabel(startDate), ev);
                continue;
            }

            // Multi-day event: add a copy for each day it spans
            const cursor = new Date(startDate);
            const maxDays = this.getDaysAhead() + 2;
            for (let i = 0; i < maxDays; i++) {
                const curDayStr = cursor.toLocaleDateString('en-CA', dateOpts);
                let overnight;
                if (curDayStr === startDayStr) {
                    overnight = 'continues';
                } else if (curDayStr === lastDayStr) {
                    overnight = 'started';
                } else if (cursor > startDate && cursor < lastDate) {
                    overnight = 'spanning';
                } else if (cursor > lastDate) {
                    break;
                }
                // Only add to groups for today or future days
                if (curDayStr >= todayStr) {
                    addToGroup(getDayLabel(cursor), {
                        ...ev,
                        _overnight: overnight,
                        _spanStart: startDate,
                        _spanEnd: lastDate,
                        _allDaySpan: ev.allDay
                    });
                }
                if (curDayStr === lastDayStr) break;
                cursor.setDate(cursor.getDate() + 1);
                if (!ev.allDay) cursor.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
            }
        }
        return groups;
    },

    _getTimezone() {
        const tz = localStorage.getItem('timezone1') || 'local';
        return tz === 'local' ? undefined : tz;
    }
};

window.CalendarManager = CalendarManager;
