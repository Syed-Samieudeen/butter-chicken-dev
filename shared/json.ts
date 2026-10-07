/** Reject duplicate members and ambiguous value encodings; permit insignificant JSON whitespace. */
export function parseStrictJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  const compact = raw.replace(/"(?:\\.|[^"\\])*"|[\t\n\r ]+/g, (token) =>
    token.startsWith('"') ? token : "",
  );
  if (JSON.stringify(value) !== compact)
    throw new Error("Noncanonical or duplicate JSON fields");
  return value;
}
