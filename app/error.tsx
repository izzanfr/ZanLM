"use client";
import { en } from "@/lib/i18n/en";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="shell error-page">
      <h1>{en.errors.generic}</h1>
      <button className="button" onClick={reset}>
        {en.errors.retry}
      </button>
    </main>
  );
}
