const SQLITE_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function fixTimestampsDeep(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (SQLITE_DATETIME_REGEX.test(obj)) {
      return obj.replace(" ", "T") + "Z";
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(fixTimestampsDeep);
  }
  if (typeof obj === "object") {
    const fixed = {};
    for (const [key, value] of Object.entries(obj)) {
      fixed[key] = fixTimestampsDeep(value);
    }
    return fixed;
  }
  return obj;
}

function utcTimestamps(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    return originalJson(fixTimestampsDeep(data));
  };
  next();
}

module.exports = { utcTimestamps, fixTimestampsDeep };
