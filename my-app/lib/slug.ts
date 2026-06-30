export function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
}

export function generateSlug(title: string, existingSlugs: string[] = []): string {
  let slug = sanitizeSlug(title)
  if (!slug) {
    slug = "post"
  }

  if (!existingSlugs.includes(slug)) {
    return slug
  }

  let counter = 2
  while (existingSlugs.includes(`${slug}-${counter}`)) {
    counter++
  }
  return `${slug}-${counter}`
}
