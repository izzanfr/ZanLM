// CSS tokens are the runtime source of truth for both CSS and GSAP timing.
export function motionSeconds(name:"feedback"|"panel"|"page"|"hero"|"stagger") {
  const value=getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`).trim();
  return Number.parseFloat(value)/1000;
}
