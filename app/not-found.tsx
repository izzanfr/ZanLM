import Link from "next/link";
import { en } from "@/lib/i18n/en";
export default function NotFound(){return <main id="main" className="shell error-page"><span className="eyebrow">404</span><h1>{en.errors.notFound}</h1><Link className="button" href="/">{en.errors.home}</Link></main>;}
