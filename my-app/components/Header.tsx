import Link from "next/link"

export default function Header() {
  return (
    <header className="top wrap">
      <Link href="/" className="brand">
        Pingusama<span className="dot">.</span>
      </Link>
      <nav>
        <Link href="/blog">blog</Link>
        <Link href="/tools">tools</Link>
        <a href="#about">about</a>
        <Link href="/admin/login" className="pill small">
          log in
        </Link>
      </nav>
    </header>
  );
}
