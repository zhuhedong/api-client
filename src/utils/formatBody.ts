/**
 * Pretty-printers for the request body "Beautify" action. Pure, dependency-free
 * string → string transforms so they stay unit-testable.
 *
 * `formatJson` throws on invalid JSON (the caller surfaces the parser message
 * inline). `formatXml` is a best-effort indenter that never throws — malformed
 * XML is reflowed as-is rather than rejected, since request bodies are often
 * fragments rather than whole documents.
 */

/** Re-serialize JSON with 2-space indentation. Throws `SyntaxError` on invalid
 *  input. */
export function formatJson(src: string): string {
  return JSON.stringify(JSON.parse(src), null, 2);
}

/** Lightweight XML/HTML indenter: break between adjacent tags, then indent by
 *  nesting depth. Best-effort — does not validate, never throws. */
export function formatXml(src: string): string {
  const PAD = "  ";
  // Insert a newline between every `><` boundary so each tag lands on its own
  // line, then walk the lines tracking nesting depth.
  const withBreaks = src.replace(/>\s*</g, ">\n<").trim();
  let depth = 0;
  return withBreaks
    .split("\n")
    .map((raw) => {
      const node = raw.trim();
      if (node.length === 0) return "";
      // A standalone closing tag dedents before it is printed.
      const isClosing = /^<\//.test(node);
      // An opening tag that isn't self-closing and doesn't also close on the
      // same line increases depth for subsequent lines.
      const isSelfContained =
        /^<[^!?][^>]*\/>$/.test(node) || // self-closing <tag/>
        /^<([\w:-]+)[^>]*>.*<\/\1>$/.test(node) || // <tag>text</tag>
        /^<[!?]/.test(node); // declaration / comment / processing instruction
      const isOpening = /^<[^/!?]/.test(node) && !isSelfContained;

      if (isClosing && depth > 0) depth -= 1;
      const line = PAD.repeat(depth) + node;
      if (isOpening) depth += 1;
      return line;
    })
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Format `src` according to `bodyType`. Returns the input unchanged for types
 *  that have no formatter. Throws only for JSON with invalid syntax. */
export function formatBody(src: string, bodyType: string): string {
  if (bodyType === "json") return formatJson(src);
  if (bodyType === "xml") return formatXml(src);
  return src;
}
