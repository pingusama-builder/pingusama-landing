export function isValidIsbn13(isbn: string): boolean {
  const cleaned = isbn.replace(/-/g, "");
  if (!/^\d{13}$/.test(cleaned)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(cleaned[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(cleaned[12], 10);
}

export function normalizeIsbn13(isbn: string): string {
  return isbn.normalize("NFKC").replace(/[-\s]/g, "");
}

/** Canonical edition identifier; ISBN-10 and its 978 ISBN-13 are equivalent. */
export function canonicalIsbn(value: string): string | null {
  const s = normalizeIsbn13(value).toUpperCase();
  if (isValidIsbn13(s)) return s;
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  if ([...s].reduce((sum, c, i) => sum + (10 - i) * (c === "X" ? 10 : Number(c)), 0) % 11) return null;
  const stem = `978${s.slice(0, 9)}`;
  const sum = [...stem].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
  return stem + ((10 - sum % 10) % 10);
}
