import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conditional `clsx` inputs, de-duplicating
 * conflicting utilities (the later class wins). Standard shadcn/ui helper —
 * every primitive in `src/components/ui/*` relies on it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
