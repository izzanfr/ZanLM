import { en } from "@/lib/i18n/en";
export function Logo({markOnly=false,className=""}:{markOnly?:boolean;className?:string}) {
  return <span className={`brand ${className}`}><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M43 10H14a6 6 0 0 0-6 6v34a6 6 0 0 0 6 6h36a6 6 0 0 0 6-6V29" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M20 22h24v6L29 38h15v6H20v-6l15-10H20Z" fill="currentColor"/><rect x="49" y="4" width="13" height="13" rx="2" fill="currentColor"/></svg>{!markOnly&&<span>{en.brand}</span>}</span>;
}
