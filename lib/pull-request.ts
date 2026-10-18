export type UniquePatchResult = {
  updatedSource: string;
  replacementCount: 1;
  changedLineCount: number;
};

/**
 * Applies a proposed patch only when the exact old block appears once.
 * Newline conversion is limited to the patch block, preserving the file's line-ending style.
 */
export function applyUniquePatch(source: string, oldText: string, newText: string): UniquePatchResult {
  if (!oldText.trim()) throw new Error("The proposed old-text block is empty.");
  if (!newText.trim()) throw new Error("The proposed replacement is empty.");
  if (oldText.length > 100_000 || newText.length > 100_000 || source.length > 500_000) {
    throw new Error("The source file or patch is too large for this MVP.");
  }
  if (oldText === newText) throw new Error("The proposed patch does not change the source.");
  if (source.includes("\u0000") || oldText.includes("\u0000") || newText.includes("\u0000")) {
    throw new Error("Binary or invalid source content cannot be patched.");
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const oldWithSourceNewlines = oldText.replace(/\r?\n/g, newline);
  const newWithSourceNewlines = newText.replace(/\r?\n/g, newline);
  let count = 0;
  let from = 0;
  while (true) {
    const index = source.indexOf(oldWithSourceNewlines, from);
    if (index < 0) break;
    count += 1;
    from = index + oldWithSourceNewlines.length;
  }
  if (count !== 1) {
    throw new Error(count === 0
      ? "The selected source has changed since the repair preview. Scan again and generate a new repair."
      : "The proposed old-text block occurs more than once. API Guardian will not guess which occurrence to change.");
  }

  const updatedSource = source.replace(oldWithSourceNewlines, newWithSourceNewlines);
  if (updatedSource === source) throw new Error("The proposed patch did not modify the source.");
  const changedLineCount = Math.max(oldWithSourceNewlines.split(/\r?\n/).length, newWithSourceNewlines.split(/\r?\n/).length);
  return { updatedSource, replacementCount: 1, changedLineCount };
}

const SOURCE_FILE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|php|rb|cs|swift|kt|rs|vue|svelte|dart)$/i;
const BLOCKED_SOURCE_NAMES = new Set([".env.ts", ".env.js", "secrets.ts", "secrets.js"]);

/** Limits PR writes to ordinary source files; the MVP cannot edit workflow/config/security files. */
export function isSafeSourcePath(path: string): boolean {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\") || path.includes("\u0000")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  if (parts.some((part) => ["node_modules", ".git", "vendor", "dist", "build", ".next"].includes(part.toLowerCase()))) return false;
  const fileName = parts[parts.length - 1].toLowerCase();
  if (BLOCKED_SOURCE_NAMES.has(fileName)) return false;
  return SOURCE_FILE_EXTENSIONS.test(fileName);
}

export function sanitizeOneLine(value: string, maxLength = 160): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}
