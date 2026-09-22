import { Logo } from "./logo";
import { en } from "@/lib/i18n/en";
export function Footer() {
  return (
    <footer className="footer shell">
      <div>
        <Logo />
        <p>{en.footer.note}</p>
      </div>
      <div className="footer-meta">
        <span>{en.footer.credit}</span>
        <span>{en.footer.stage}</span>
      </div>
    </footer>
  );
}
