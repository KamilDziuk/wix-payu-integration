// @ts-nocheck
// One searchable line per event: "[PayU <scope>] <message> {json}".
// Filter Wix Logs by "[PayU" to follow the whole payment flow.

function serialize(data) {
  if (data instanceof Error) {
    return JSON.stringify({ error: data.message, stack: data.stack });
  }
  try {
    return JSON.stringify(data);
  } catch (_err) {
    return String(data);
  }
}

function format(scope, message, data) {
  const line = "[PayU " + scope + "] " + message;
  return data === undefined ? line : line + " " + serialize(data);
}

// Short error text for log data; thrown values are not always Errors.
export function describeError(error) {
  return error?.message || String(error);
}

export function logInfo(scope, message, data) {
  console.log(format(scope, message, data));
}

export function logWarn(scope, message, data) {
  console.warn(format(scope, message, data));
}

export function logError(scope, message, data) {
  console.error(format(scope, message, data));
}
