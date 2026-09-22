"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { en } from "@/lib/i18n/en";
import { z } from "zod";
const responseSchema = z.object({ ok: z.boolean().optional(), error: z.string().optional() });
export function SignInForm() {
  const input = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (error && !pending) input.current?.focus();
  }, [error, pending]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.current?.value ?? "" }),
      });
      const parsed = responseSchema.safeParse(await result.json());
      if (!result.ok) {
        setError(parsed.success && parsed.data.error ? parsed.data.error : en.login.network);
        return;
      }
      window.location.replace("/workspace");
    } catch {
      setError(en.login.network);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="sign-in-form">
      <label htmlFor="access-code">{en.login.label}</label>
      <div className={`password-field ${error ? "has-error" : ""}`}>
        <input
          ref={input}
          id="access-code"
          name="code"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          required
          maxLength={512}
          aria-invalid={!!error}
          aria-describedby={error ? "login-error" : undefined}
          disabled={pending}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? en.login.hide : en.login.show}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div className="form-message" aria-live="polite">
        <p id="login-error" role={error ? "alert" : undefined}>
          {error}
        </p>
      </div>
      <button type="submit" className="button button-wide" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
            {en.login.busy}
          </>
        ) : (
          <>
            {en.login.submit}
            <ArrowRight size={18} aria-hidden="true" />
          </>
        )}
      </button>
      <p className="form-note">{en.login.privacy}</p>
    </form>
  );
}
