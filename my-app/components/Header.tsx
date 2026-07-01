import Link from "next/link"

export default function Header() {
  return (
    <header className="top wrap">
      <Link href="/" className="brand">
        Pingusama<span className="dot">.</span>
      </Link>
      <nav>
        <Link href="/blog">blog</Link>
        <a href="#wheel">tools</a>
        <a href="#about">about</a>
        <Link href="/admin/login" className="pill small">
          log in
        </Link>
      </nav>
    </header>
  );
}
