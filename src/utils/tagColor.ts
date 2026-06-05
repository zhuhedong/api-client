/**
 * Deterministic color picker for request tags. Hashes the tag string into
 * one of the app's accent palette colors so the same tag always renders
 * the same color across all surfaces (sidebar, request panel, palette).
 *
 * Returns a tuple of [textClass, bgClass] so callers can style chip bodies
 * and inline dots independently. All classes are present in the project's
 * tailwind config (see tailwind.config.js).
 */
const PALETTE: Array<[string, string]> = [
  ["text-primary", "bg-primary/15"],
  ["text-success", "bg-success/15"],
  ["text-orange", "bg-orange/15"],
  ["text-purple", "bg-purple/15"],
  ["text-teal", "bg-teal/15"],
  ["text-destructive", "bg-destructive/15"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function tagColor(tag: string): { text: string; bg: string } {
  const [text, bg] = PALETTE[hash(tag) % PALETTE.length];
  return { text, bg };
}
