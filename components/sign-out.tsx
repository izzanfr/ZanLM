"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { en } from "@/lib/i18n/en";
export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div>
      <button
        className="text-button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            const res = await fetch("/api/auth/logout", { method: "POST" });
            if (!res.ok && res.status !== 401) throw new Error();
            window.location.replace("/sign-in");
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
      >
        <LogOut size={16} aria-hidden="true" />
        {pending ? en.nav.signingOut : en.nav.signout}
      </button>
      {error && (
        <p role="alert" className="error-text">
          {en.login.network}
        </p>
      )}
    </div>
  );
}
