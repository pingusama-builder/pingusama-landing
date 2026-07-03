export const BLOG_CATEGORIES = [
  "Movies",
  "Books/Reading",
  "App Engineering",
  "AI",
  "Fiction",
] as const

export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export function isBlogCategory(value: string): value is BlogCategory {
  return (BLOG_CATEGORIES as readonly string[]).includes(value)
}

export function categoryPath(category: string): string {
  return `/blog/category/${encodeURIComponent(category)}`
}
