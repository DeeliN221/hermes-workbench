/** Recover legacy prompt separators for display without rewriting the stored source. */
export function normalizeTaskMarkdown(source: string): string {
  // Code, quoted JSON values and paths can intentionally contain literal \n.
  const protectedText = /(`+)[\s\S]*?\1|(~{3,})[\s\S]*?\2|"(?:\\.|[^"\\])*"|(?:\b[a-z]:\\|\\\\)[^\s`"<>]*|^(?: {4}|\t)[^\n]*/gim;
  const parts: { text: string; protected: boolean }[] = [];
  let offset = 0;
  for (const match of source.matchAll(protectedText)) {
    parts.push({ text: source.slice(offset, match.index), protected: false });
    parts.push({ text: match[0], protected: true });
    offset = match.index + match[0].length;
  }
  parts.push({ text: source.slice(offset), protected: false });

  // A lone escape may be an instruction about newline syntax. Only recover
  // documents containing paragraph breaks or explicit Markdown block markers.
  const structure = /(?:\\r\\n|\\n){2,}|(?:\\r\\n|\\n)(?=[ \t]*(?:#{1,6}[ \t]|(?:[-+*]|\d+[.)])[ \t]|>[ \t]))/;
  if (!parts.some(part => !part.protected && structure.test(part.text))) return source;
  return parts.map(part => part.protected ? part.text : part.text.replace(
    /(\\+)(?:r\\n|n)/g,
    (match, slashes: string) => slashes.length === 1 ? "\n" : match,
  )).join("");
}
