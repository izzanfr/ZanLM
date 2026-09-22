"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Logo } from "./logo";
import { en } from "@/lib/i18n/en";
import { motionSeconds } from "@/lib/motion";
gsap.registerPlugin(useGSAP);
export function Header({ initialTheme }: { initialTheme: "light" | "dark" }) {
  const path = usePathname();
  const [theme, setTheme] = useState(initialTheme);
  const [hidden, setHidden] = useState(false);
  const [compact, setCompact] = useState(false);
  const [activeHash, setActiveHash] = useState("");
  const header = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    function scroll() {
      const y = window.scrollY;
      setCompact(y > 48);
      if (Math.abs(y - last) > 8 || y < 48) {
        setHidden(y > last && y > 180);
        last = y;
      }
    }
    function hash() {
      setActiveHash(window.location.hash);
    }
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);
  useGSAP(
    () => {
      const active = header.current?.querySelector<HTMLElement>(".desktop-nav [aria-current]");
      const marker = header.current?.querySelector(".nav-marker");
      if (!active || !marker) return;
      const update = () =>
        gsap.to(marker, {
          x: active.offsetLeft,
          width: active.offsetWidth,
          opacity: 1,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : motionSeconds("panel"),
          ease: "power2.out",
        });
      update();
      const observer = new ResizeObserver(update);
      observer.observe(active);
      return () => observer.disconnect();
    },
    { scope: header, dependencies: [path, activeHash] },
  );
  const links = [
    { href: "/", label: en.nav.home, active: path === "/" && activeHash !== "#how-it-works" },
    {
      href: "/#how-it-works",
      label: en.nav.how,
      active: path === "/" && activeHash === "#how-it-works",
    },
    {
      href: "/workspace",
      label: en.nav.workspace,
      active: path === "/workspace" || path === "/sign-in",
    },
  ];
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `zanlm_theme=${next}; path=/; max-age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function closeMenu() {
    dialog.current?.close();
    setMenuOpen(false);
    menuButton.current?.focus();
  }
  return (
    <>
      <a className="skip-link" href="#main">
        {en.nav.skip}
      </a>
      <header
        ref={header}
        className={`site-header ${hidden && !menuOpen ? "nav-hidden" : ""} ${compact ? "compact" : ""}`}
        onFocusCapture={() => setHidden(false)}
      >
        <Link href="/" className="logo-link" aria-label={en.nav.home}>
          <Logo />
        </Link>
        <nav className="desktop-nav" aria-label={en.nav.label}>
          <span className="nav-marker" aria-hidden="true" />
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={link.active ? "page" : undefined}
              onClick={() => setActiveHash(link.href.includes("#") ? "#how-it-works" : "")}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button theme-button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? en.nav.dark : en.nav.light}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <Link className="button nav-cta" href="/workspace">
            {en.nav.convert}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <button
            ref={menuButton}
            className="icon-button mobile-menu-button"
            aria-label={en.nav.menu}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => {
              dialog.current?.showModal();
              setMenuOpen(true);
            }}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>
      <dialog
        ref={dialog}
        id="mobile-menu"
        className="mobile-menu"
        onClose={() => {
          setMenuOpen(false);
          menuButton.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeMenu();
        }}
      >
        <div className="mobile-menu-top">
          <Logo />
          <button autoFocus className="icon-button" onClick={closeMenu} aria-label={en.nav.close}>
            <X />
          </button>
        </div>
        <nav aria-label={en.nav.label}>
          {links.map((link, i) => (
            <Link
              style={{ animationDelay: `${i * 60}ms` }}
              key={link.href}
              href={link.href}
              onClick={() => {
                setActiveHash(link.href.includes("#") ? "#how-it-works" : "");
                closeMenu();
              }}
            >
              {link.label}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <Link className="button" href="/workspace" onClick={closeMenu}>
          {en.nav.convert}
        </Link>
      </dialog>
    </>
  );
}
