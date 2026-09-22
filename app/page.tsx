import Link from "next/link";
import { ArrowUpRight, ArrowDown, FileUp, ScanLine, MousePointer2 } from "lucide-react";
import { HeroTitle } from "@/components/hero-title";
import { SlideDemo } from "@/components/slide-demo";
import { Limitations } from "@/components/limitations";
import { AnimatedBackground } from "@/components/animated-background";
import { LineMotif } from "@/components/line-motif";
import { Magnetic } from "@/components/magnetic";
import { en } from "@/lib/i18n/en";
export default function Home() {
  const icons = [FileUp, ScanLine, MousePointer2];
  return (
    <main id="main" className="shell landing">
      <section className="hero">
        <div className="hero-topline">
          <span className="eyebrow">{en.hero.eyebrow}</span>
          <span className="edition">{en.footer.stage}</span>
        </div>
        <HeroTitle />
        <p className="hero-description">{en.hero.description}</p>
        <div className="hero-actions">
          <Magnetic>
            <Link href="/workspace" className="button button-large">
              {en.nav.convert}
              <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
          </Magnetic>
          <a href="#demo" className="text-button">
            {en.hero.demo}
            <ArrowDown size={16} aria-hidden="true" />
          </a>
        </div>
        <p className="hero-note">{en.hero.note}</p>
        <AnimatedBackground
          variant="hero"
          fallback={<LineMotif className="right-5 bottom-[51px] max-[1000px]:hidden" />}
        />
      </section>
      <SlideDemo />
      <section id="how-it-works" className="how-section">
        <p className="eyebrow">{en.how.eyebrow}</p>
        <h2>{en.how.title}</h2>
        <div className="steps">
          {en.how.steps.map((step, i) => {
            const Icon = icons[i];
            return (
              <article key={step.number}>
                <div className="step-top">
                  <span>{step.number}</span>
                  <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>
      <Limitations />
      <section className="final-cta">
        <h2>{en.cta.title}</h2>
        <Link href="/workspace" className="button">
          {en.cta.button}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
