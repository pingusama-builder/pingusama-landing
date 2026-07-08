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
  return isbn.replace(/-/g, "").trim();
}
