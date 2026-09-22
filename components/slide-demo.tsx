"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Layers,
  RotateCcw,
  Check,
  Type,
  ImageIcon,
  Square,
  Wallpaper,
} from "lucide-react";
import { en } from "@/lib/i18n/en";
import { motionSeconds } from "@/lib/motion";
import {
  DEMO_CONDITIONS,
  demoMotionMode,
  SEPARATED_OFFSETS,
  SEPARATED_SCALE,
} from "@/lib/demo-motion";
gsap.registerPlugin(useGSAP, ScrollTrigger);
const layerKeys = ["background", "panels", "objects", "text"] as const;
type Layer = (typeof layerKeys)[number];
const icons = { background: Wallpaper, panels: Square, objects: ImageIcon, text: Type };
const layerLabels: Record<Layer, string> = {
  background: en.demo.backgroundLabel,
  panels: en.demo.panelLabel,
  objects: en.demo.imageLabel,
  text: en.demo.textLabel,
};
// Label anchors in slide percentages, next to the element each layer contains.
const labelPositions: Record<Layer, string> = {
  background: "right-[3%] bottom-[3%]",
  panels: "left-[51%] top-[66%]",
  objects: "right-[4%] top-[23%]",
  text: "left-[50%] top-[23%]",
};

export function SlideDemo() {
  const ref = useRef<HTMLElement>(null);
  const [exploded, setExploded] = useState(false);
  const [visible, setVisible] = useState<Record<Layer, boolean>>({
    background: true,
    panels: true,
    objects: true,
    text: true,
  });
  // Scroll storyboard. Outer .slide-layer elements move with scroll; the manual
  // controls below move the inner .layer-inner elements, so they never compete.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DEMO_CONDITIONS, (context) => {
        const conditions = context.conditions as Record<keyof typeof DEMO_CONDITIONS, boolean>;
        const mode = demoMotionMode(conditions);
        const layer = (key: Layer) => `.reconstructed .layer-${key}`;
        const moving = (["panels", "objects", "text"] as const).map(layer);
        const labels = ".reconstructed .layer-label";
        const frame = ".reconstructed";
        const art = ".reconstructed .slide-art";

        if (mode === "static") {
          // Reduced motion: a still, separated diagram with every label visible.
          gsap.set(art, { scale: SEPARATED_SCALE });
          for (const key of ["panels", "objects", "text"] as const) {
            gsap.set(layer(key), SEPARATED_OFFSETS[key]);
          }
          return;
        }

        if (mode === "enter") {
          // Small screens: no pinning, layers settle as the demo scrolls in.
          gsap
            .timeline({
              scrollTrigger: { trigger: ref.current, start: "top 85%", end: "top 30%", scrub: 1 },
            })
            .fromTo(layer("panels"), { y: 12 }, { y: 0 }, 0)
            .fromTo(layer("objects"), { y: 24 }, { y: 0 }, 0)
            .fromTo(layer("text"), { y: 36 }, { y: 0 }, 0);
          return;
        }

        // Desktop: pinned three-phase storyboard.
        gsap.set(labels, { autoAlpha: 0, y: 8 });
        gsap.set(frame, { "--selection-opacity": 0 });
        const timeline = gsap.timeline({
          defaults: { ease: "power1.inOut" },
          scrollTrigger: {
            trigger: ref.current,
            start: "center center",
            end: "+=150%",
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
        // Separate, 0–35%. The slide shrinks slightly so lifted layers stay in the frame.
        timeline.to(art, { scale: SEPARATED_SCALE, duration: 0.35 }, 0);
        for (const key of ["panels", "objects", "text"] as const) {
          timeline.to(layer(key), { ...SEPARATED_OFFSETS[key], duration: 0.35 }, 0);
        }
        // Explain, 35–70%: labels appear next to their layers and hold.
        timeline.to(labels, { autoAlpha: 1, y: 0, duration: 0.15, stagger: 0.04 }, 0.35);
        // Reassemble, 70–100%: layers settle, labels give way to selection boxes.
        timeline.to(moving, { x: 0, y: 0, duration: 0.25 }, 0.7);
        timeline.to(art, { scale: 1, duration: 0.25 }, 0.7);
        timeline.to(labels, { autoAlpha: 0, y: -4, duration: 0.1 }, 0.7);
        timeline.to(frame, { "--selection-opacity": 1, duration: 0.15 }, 0.85);

        // System fonts rarely shift layout, but refresh once they settle so the
        // pin starts exactly where the section is.
        void document.fonts?.ready.then(() => ScrollTrigger.refresh());
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  useGSAP(
    () => {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(".reconstructed .layer-inner", {
        y: (i: number) => (exploded ? [-6, -10, -18, -26][i] : 0),
        x: (i: number) => (exploded ? [0, 0, 12, -6][i] : 0),
        duration: reduced ? 0 : motionSeconds("page"),
        ease: "power2.out",
      });
    },
    { scope: ref, dependencies: [exploded] },
  );
  return (
    <section className="demo-section" ref={ref} id="demo" aria-labelledby="demo-title">
      <div className="demo-heading">
        <div>
          <p className="eyebrow">{en.demo.eyebrow}</p>
          <h2 id="demo-title">{en.demo.title}</h2>
        </div>
        <span className="sample-badge">{en.demo.sample}</span>
      </div>
      <div className="comparison">
        <div className="comparison-side">
          <div className="slide-label">
            <span>{en.demo.original}</span>
            <span className="muted">{en.demo.flat}</span>
          </div>
          <div className="slide-frame original">
            <SlideArt />
          </div>
        </div>
        <div className="comparison-arrow" aria-hidden="true">
          <ArrowRight size={20} />
        </div>
        <div className="comparison-side">
          <div className="slide-label">
            <span>{en.demo.editable}</span>
            <span className="editable-dot" aria-hidden="true" />
          </div>
          <div className={`slide-frame reconstructed ${exploded ? "is-exploded" : ""}`}>
            <SlideArt visible={visible} editable />
          </div>
        </div>
      </div>
      {/* Visible legend on small screens; kept for screen readers on desktop, where
          the same labels appear inside the slide (the slide itself is role="img"). */}
      <ul className="mt-4 grid grid-cols-2 gap-2 lg:sr-only">
        {layerKeys.map((key) => {
          const Icon = icons[key];
          return (
            <li key={key} className="flex items-center gap-2 text-caption text-muted">
              <Icon size={14} aria-hidden="true" className="shrink-0 text-ink" />
              <span>
                <span className="text-ink">{en.demo[key]}</span> · {layerLabels[key]}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="demo-controls">
        <div className="layer-switches" role="group" aria-label={en.demo.separate}>
          {layerKeys.map((key) => {
            const Icon = icons[key];
            return (
              <button
                key={key}
                className={`layer-chip ${visible[key] ? "selected" : ""}`}
                aria-pressed={visible[key]}
                onClick={() => setVisible((old) => ({ ...old, [key]: !old[key] }))}
              >
                <Icon size={14} aria-hidden="true" />
                {en.demo[key]}
                {visible[key] && <Check size={12} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <button
          className="text-button"
          aria-pressed={exploded}
          onClick={() => setExploded(!exploded)}
        >
          {exploded ? <RotateCcw size={16} /> : <Layers size={16} />}{" "}
          {exploded ? en.demo.reset : en.demo.separate}
        </button>
      </div>
      <p className="demo-caption">{en.demo.caption}</p>
    </section>
  );
}
function SlideArt({
  visible = { background: true, panels: true, objects: true, text: true },
  editable = false,
}: {
  visible?: Record<Layer, boolean>;
  editable?: boolean;
}) {
  const label = (key: Layer) =>
    editable && (
      <span
        aria-hidden="true"
        className={`layer-label absolute z-10 rounded-pill border border-border bg-canvas px-2 py-0.5 text-caption whitespace-nowrap text-ink shadow-floating max-lg:hidden ${labelPositions[key]}`}
      >
        {layerLabels[key]}
      </span>
    );
  return (
    <div className="slide-art" role="img" aria-label={en.demo.canvas}>
      <div className="slide-layer layer-background" style={{ opacity: visible.background ? 1 : 0 }}>
        <div className="layer-inner source-background" />
        {label("background")}
      </div>
      <div className="slide-layer layer-panels" style={{ opacity: visible.panels ? 1 : 0 }}>
        <div className="layer-inner">
          <div className="source-panel" />
        </div>
        {label("panels")}
      </div>
      <div className="slide-layer layer-objects" style={{ opacity: visible.objects ? 1 : 0 }}>
        <div className="layer-inner">
          <div className={`source-object ${editable ? "selection-object" : ""}`}>
            <div className="arch arch-one" />
            <div className="arch arch-two" />
            <div className="arch arch-three" />
            {editable && <SelectionCorners />}
          </div>
        </div>
        {label("objects")}
      </div>
      <div className="slide-layer layer-text" style={{ opacity: visible.text ? 1 : 0 }}>
        <div className="layer-inner">
          <span className="source-chapter">{en.demo.chapter}</span>
          <span className={`source-title ${editable ? "selection-text" : ""}`}>
            {en.demo.heading}
            {editable && <SelectionCorners />}
          </span>
          <span className="source-subtitle">{en.demo.subtitle}</span>
          <span className="source-panel-title">{en.demo.panel}</span>
          <span className="source-panel-detail">{en.demo.detail}</span>
        </div>
        {label("text")}
      </div>
    </div>
  );
}
function SelectionCorners() {
  return (
    <span className="selection-corners" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
