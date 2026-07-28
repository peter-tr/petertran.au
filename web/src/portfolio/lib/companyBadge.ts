const STOPWORDS = new Set(["of", "and", "the", "&"]);
const ACCENT_VARS = ["var(--signal)", "var(--type)", "var(--string)"];

export function companyInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => !STOPWORDS.has(word.toLowerCase()));

  return words
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function companyAccent(name: string): string {
  let sum = 0;
  // `for...of` over a string iterates whole code points, so codePointAt(0)
  // reads each character in full rather than half a surrogate pair.
  for (const ch of name) sum += ch.codePointAt(0) ?? 0;

  return ACCENT_VARS[sum % ACCENT_VARS.length];
}
