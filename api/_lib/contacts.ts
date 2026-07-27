/** Helpers for contact detection and normalization — recurring client recognition. */

/**
 * Normalize a phone number: remove spaces/dashes/parens/dots,
 * convert +33 → 0, keep leading 0 only once.
 * Returns null if input is empty/null.
 */
export function normalizePhone(txt: string | null | undefined): string | null {
  if (!txt || txt.trim() === '') return null;
  return txt
    .replace(/[^\d+]/g, '') // Remove all non-digits except +
    .replace(/^\+33/, '0') // +33 → 0
    .replace(/^0+/, '0'); // Remove leading zeros beyond one
}

/**
 * Normalize an email: lowercase, trim.
 * Returns null if input is empty/null.
 */
export function normalizeEmail(txt: string | null | undefined): string | null {
  if (!txt || txt.trim() === '') return null;
  return txt.toLowerCase().trim();
}

/**
 * Extract a phone number from text using simple regex.
 * Looks for patterns like: +33..., 0..., 06..., (0)6..., etc.
 * Returns the first match, normalized, or null.
 */
export function extractPhone(text: string): string | null {
  // Match: optional +, optional (0), 1-3 digits, then 7-10 more digits (with optional separators)
  const phoneRegex = /(?:\+33|0)?[\s(]*[\d]{1,3}[\s).-]*[\d\s.-]{6,12}[\d]/g;
  const matches = text.match(phoneRegex);
  if (!matches || matches.length === 0) return null;
  // Take the longest match (most complete)
  const best = matches.reduce((a, b) => (a.length > b.length ? a : b));
  return normalizePhone(best);
}

/**
 * Extract an email from text using simple regex.
 * Returns the first match, normalized, or null.
 */
export function extractEmail(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const match = text.match(emailRegex);
  return match ? normalizeEmail(match[0]) : null;
}

/**
 * Extract a name from text (basic: look for capitalized words at the start).
 * Very naive — assumes the first 1-3 capitalized words form a name.
 */
export function extractName(text: string): string | null {
  const nameRegex = /^(?:[A-ZÀ-ÿ][a-zà-ÿ]*\s*){1,3}/m;
  const match = text.match(nameRegex);
  return match ? match[0].trim() : null;
}

/**
 * Search for identifiers (phone/email) in a text.
 * Returns { phone, email, name } with normalized values or null.
 */
export function detectIdentifiers(text: string): {
  phone: string | null;
  email: string | null;
  name: string | null;
} {
  return {
    phone: extractPhone(text),
    email: extractEmail(text),
    name: extractName(text),
  };
}
