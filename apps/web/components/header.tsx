"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/draws", label: "Draw History" },
  { href: "/system", label: "System" }
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="app-container header-inner">
        <Link href="/" className="brand">
          <span className="brand-dot" />
          <span>Bags Holder Rewards</span>
        </Link>
        <nav className="nav-links">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? "is-active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
