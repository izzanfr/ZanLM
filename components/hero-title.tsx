"use client";
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { en } from "@/lib/i18n/en";
const BlurText=dynamic(()=>import("./reactbits/BlurText"),{ssr:false,loading:()=> <span>{en.hero.second}</span>});
function subscribe(callback:()=>void){const m=matchMedia("(prefers-reduced-motion: reduce)");m.addEventListener("change",callback);return()=>m.removeEventListener("change",callback);}
export function HeroTitle(){
  const reduce=useSyncExternalStore(subscribe,()=>matchMedia("(prefers-reduced-motion: reduce)").matches,()=>true);
  return <h1><span>{en.hero.title}</span><span className="hero-second">{reduce?en.hero.second:<><span className="sr-only">{en.hero.second}</span><span aria-hidden="true"><BlurText text={en.hero.second} delay={60} animateBy="words" direction="bottom" className="hero-blur"/></span></>}</span></h1>;
}
