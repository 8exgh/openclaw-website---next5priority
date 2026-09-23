// Descriptions and comments are plain text with one addition: an image
// marker, ![alt](attachment:file-name), shows the attachment with that name
// inline. Pasting a screenshot stages it as an attachment and inserts the
// marker; the text stays readable wherever it is shown as-is.
const MARKER = /!\[([^\]\n]*)\]\(attachment:([^)\n]+)\)/g;
export type RichSegment =
  | { type: "text"; text: string }
  | { type: "image"; alt: string; name: string; marker: string };
export const imageMarker = (name: string) => `![${name}](attachment:${name})`;
export function richSegments(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    if (match.index > last)
      segments.push({ type: "text", text: text.slice(last, match.index) });
    segments.push({
      type: "image",
      alt: match[1] || match[2],
      name: match[2],
      marker: match[0],
    });
    last = match.index + match[0].length;
  }
  if (last < text.length)
    segments.push({ type: "text", text: text.slice(last) });
  return segments;
}
// Text for previews and search snippets, without image markers.
export const plainText = (text: string) =>
  text
    .replace(MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};
// The next free pasted-image-N name among the given attachment names.
export function nextPastedName(taken: Iterable<string>, mime: string) {
  const names = new Set(taken);
  const extension = EXTENSIONS[mime] || "png";
  for (let n = 1; ; n++) {
    const name = `pasted-image-${n}.${extension}`;
    if (!names.has(name)) return name;
  }
}
