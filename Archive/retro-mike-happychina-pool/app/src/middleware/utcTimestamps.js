/**
 * UTC Timestamp Middleware
 * 
 * SQLite's CURRENT_TIMESTAMP returns UTC time in format "YYYY-MM-DD HH:MM:SS"
 * but WITHOUT a timezone marker. When JavaScript's new Date() parses this string,
 * it treats it as LOCAL time (not UTC), causing wrong relative times.
 * 
 * For example, in UTC+8 timezone:
 *   DB stores: "2026-02-25 04:00:00" (UTC)
 *   JS parses: new Date("2026-02-25 04:00:00") → 4:00 AM LOCAL = 20:00 UTC (previous day!)
 *   Result: "8 hours ago" instead of "just now"
 * 
 * This middleware intercepts ALL res.json() calls and converts SQLite timestamps
 * to proper ISO 8601 format with "Z" suffix: "2026-02-25T04:00:00Z"
 * This ensures JavaScript correctly interprets them as UTC everywhere.
 * 
 * This is a GLOBAL fix - no need to patch individual routes.
 */

const SQLITE_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function fixTimestampsDeep(obj) {
  if (obj === null || obj === undefined) return obj;

  // String: check if it matches SQLite datetime format
  if (typeof obj === 'string') {
    if (SQLITE_DATETIME_REGEX.test(obj)) {
      return obj.replace(' ', 'T') + 'Z';
    }
    return obj;
  }

  // Array: recurse into each element
  if (Array.isArray(obj)) {
    return obj.map(fixTimestampsDeep);
  }

  // Object: recurse into each value
  if (typeof obj === 'object') {
    const fixed = {};
    for (const [key, value] of Object.entries(obj)) {
      fixed[key] = fixTimestampsDeep(value);
    }
    return fixed;
  }

  // Numbers, booleans, etc: pass through
  return obj;
}

/**
 * Express middleware that patches res.json() to automatically fix all timestamps
 */
function utcTimestamps(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    return originalJson(fixTimestampsDeep(data));
  };
  next();
}

module.exports = { utcTimestamps, fixTimestampsDeep };
