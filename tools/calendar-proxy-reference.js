// ==========================================
// CALENDAR-PROXY-REFERENCE.JS - Server-side reference
// Anderson Homepage
//
// Google Apps Script CORS-proxy template and setup
// instructions for the calendar feature, moved out of
// the top of scripts/5-calendar.js (v4.29). This file
// is NOT loaded by the app — it is copy-paste reference
// for deploying the proxy. The Anderson Calendar Widget
// Android app talks to the same proxy deployment.
// ==========================================

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

