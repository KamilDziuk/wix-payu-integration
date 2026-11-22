// Minimal wix-fetch response: a JSON object, or a string for raw text.
export function fakeResponse(status, body) {
  const text = typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  };
}
