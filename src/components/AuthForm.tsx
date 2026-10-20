"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode, requireInvite = false }: { mode: "signup" | "login"; requireInvite?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    }).catch(() => undefined);
    const data = await res?.json().catch(() => ({}));
    if (!res || !res.ok) {
      setError(data?.error ?? "We couldn't reach the server. Try again.");
      setBusy(false);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false}
          {...(signup ? { pattern: "[a-z0-9]{4,12}", title: "4 to 12 lowercase letters or numbers" } : {})} />
        {signup && <p className="hint">4 to 12 lowercase letters or numbers. It becomes part of the name of every AWS resource we create for you.</p>}
      </div>
      {signup && (
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
      )}
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 10 : undefined} />
        {signup && <p className="hint">At least 10 characters.</p>}
      </div>
      {signup && requireInvite && (
        <div className="field">
          <label htmlFor="inviteCode">Invite code</label>
          <input id="inviteCode" name="inviteCode" required autoComplete="off" />
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? (signup ? "Creating account…" : "Logging in…") : signup ? "Create account" : "Log in"}
        </button>
      </div>
    </form>
  );
}
