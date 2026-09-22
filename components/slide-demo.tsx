"use client";
import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Layers, RotateCcw, Check, Type, ImageIcon, Square, Wallpaper } from "lucide-react";
import { en } from "@/lib/i18n/en";
import { motionSeconds } from "@/lib/motion";
gsap.registerPlugin(useGSAP,ScrollTrigger);
const layerKeys=["background","panels","objects","text"] as const;
type Layer=typeof layerKeys[number];
const icons={background:Wallpaper,panels:Square,objects:ImageIcon,text:Type};
export function SlideDemo(){
  const ref=useRef<HTMLElement>(null);
  const [exploded,setExploded]=useState(false);
  const [visible,setVisible]=useState<Record<Layer,boolean>>({background:true,panels:true,objects:true,text:true});
  useGSAP(()=>{
    const mm=gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)",()=>{
      const timeline=gsap.timeline({scrollTrigger:{trigger:ref.current,start:"top 85%",end:"top 30%",scrub:1}});
      timeline.fromTo(".reconstructed .layer-panels",{y:12},{y:0},0).fromTo(".reconstructed .layer-objects",{y:24},{y:0},0).fromTo(".reconstructed .layer-text",{y:36},{y:0},0);
    });return()=>mm.revert();
  },{scope:ref});
  // Manual demo uses a separate inner transform, so scroll and user controls never compete.
  useGSAP(()=>{
    const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(".reconstructed .layer-inner",{y:(i:number)=>exploded?[-6,-10,-18,-26][i]:0,x:(i:number)=>exploded?[0,0,12,-6][i]:0,duration:reduced?0:motionSeconds("page"),ease:"power2.out"});
  },{scope:ref,dependencies:[exploded]});
  return <section className="demo-section" ref={ref} id="demo" aria-labelledby="demo-title"><div className="demo-heading"><div><p className="eyebrow">{en.demo.eyebrow}</p><h2 id="demo-title">{en.demo.title}</h2></div><span className="sample-badge">{en.demo.sample}</span></div>
    <div className="comparison"><div className="comparison-side"><div className="slide-label"><span>{en.demo.original}</span><span className="muted">{en.demo.flat}</span></div><div className="slide-frame original"><SlideArt/></div></div><div className="comparison-arrow" aria-hidden="true"><ArrowRight size={20}/></div><div className="comparison-side"><div className="slide-label"><span>{en.demo.editable}</span><span className="editable-dot" aria-hidden="true"/></div><div className={`slide-frame reconstructed ${exploded?"is-exploded":""}`}><SlideArt visible={visible} editable/></div></div></div>
    <div className="demo-controls"><div className="layer-switches" role="group" aria-label={en.demo.separate}>{layerKeys.map(key=>{const Icon=icons[key];return <button key={key} className={`layer-chip ${visible[key]?"selected":""}`} aria-pressed={visible[key]} onClick={()=>setVisible(old=>({...old,[key]:!old[key]}))}><Icon size={14} aria-hidden="true"/>{en.demo[key]}{visible[key]&&<Check size={12} aria-hidden="true"/>}</button>;})}</div><button className="text-button" aria-pressed={exploded} onClick={()=>setExploded(!exploded)}>{exploded?<RotateCcw size={16}/>:<Layers size={16}/>} {exploded?en.demo.reset:en.demo.separate}</button></div><p className="demo-caption">{en.demo.caption}</p>
  </section>;
}
function SlideArt({visible={background:true,panels:true,objects:true,text:true},editable=false}:{visible?:Record<Layer,boolean>;editable?:boolean}){
  return <div className="slide-art" role="img" aria-label={en.demo.canvas}>
    <div className="slide-layer layer-background" style={{opacity:visible.background?1:0}}><div className="layer-inner source-background"/></div>
    <div className="slide-layer layer-panels" style={{opacity:visible.panels?1:0}}><div className="layer-inner"><div className="source-panel"/></div></div>
    <div className="slide-layer layer-objects" style={{opacity:visible.objects?1:0}}><div className="layer-inner"><div className={`source-object ${editable?"selection-object":""}`}><div className="arch arch-one"/><div className="arch arch-two"/><div className="arch arch-three"/>{editable&&<SelectionCorners/>}</div></div></div>
    <div className="slide-layer layer-text" style={{opacity:visible.text?1:0}}><div className="layer-inner"><span className="source-chapter">{en.demo.chapter}</span><span className={`source-title ${editable?"selection-text":""}`}>{en.demo.heading}{editable&&<SelectionCorners/>}</span><span className="source-subtitle">{en.demo.subtitle}</span><span className="source-panel-title">{en.demo.panel}</span><span className="source-panel-detail">{en.demo.detail}</span></div></div>
  </div>;
}
function SelectionCorners(){return <span className="selection-corners" aria-hidden="true"><i/><i/><i/><i/></span>;}
