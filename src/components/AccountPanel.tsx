"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Silo } from "./Silo";
import { STAGES } from "@/lib/stages";
import type { StatusResponse } from "@/lib/types";

export function AccountPanel({ initial }: { initial: StatusResponse }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);

  // Poll while setup is running; stop as soon as it is ready or has failed.
  useEffect(() => {
    if (s.status !== "provisioning") return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/account/status", { cache: "no-store" }).catch(() => undefined);
      if (res?.status === 401) location.href = "/login";
      else if (res?.ok) setS(await res.json());
    }, 3000);
    return () => clearInterval(timer);
  }, [s.status]);

  async function retry() {
    setBusy(true);
    const res = await fetch("/api/account/retry", { method: "POST" });
    if (res.ok) setS({ ...s, status: "provisioning", step: 0, error: "" });
    setBusy(false);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const label =
    s.status === "ready" ? "Setup complete" : s.status === "failed" ? "Setup failed" : `Setup in progress, stage ${Math.max(s.step, 1)} of ${STAGES.length}`;

  return (
    <div className="wrap account">
      <Silo status={s.status} step={s.step} label={label} />
      <div className="account-body">
        {s.status === "provisioning" && (
          <>
            <h2>Setting up your AWS resources</h2>
            <p>This usually takes a few minutes. You can close this page. Setup keeps running, and your progress is saved here.</p>
            <ol className="stages">
              {STAGES.map((name, i) => {
                const n = i + 1;
                const state = n < s.step ? "done" : n === s.step ? "current" : "waiting";
                return (
                  <li key={name} className={state}>
                    <span className="dot" aria-hidden="true" />
                    {name}
                    <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : " (waiting)"}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {s.status === "failed" && (
          <>
            <h2>Setup didn&apos;t finish</h2>
            <p className="error" role="alert">{s.error}</p>
            <div>
              <button className="btn primary" onClick={retry} disabled={busy}>{busy ? "Starting…" : "Try again"}</button>
            </div>
          </>
        )}

        {s.status === "ready" && (
          <>
            <h2>Your project is ready</h2>
            <p>
              Download it, unzip it and run it. The zip contains your access keys, so keep it private and
              never commit <code>.env.local</code> or <code>.env.deploy</code>.
            </p>
            <div>
              <a className="btn primary" href="/api/account/download" download>Download project (.zip)</a>
            </div>
            <div>
              <p><strong>Run it on your computer</strong></p>
              <pre className="code">{`unzip grainstack-${s.username}.zip\ncd grainstack-${s.username}\nnpm install\nnpm run dev`}</pre>
            </div>
            <div>
              <p><strong>Deploy it</strong></p>
              <pre className="code">{`npm run package\nnpm run deploy:dev\nnpm run deploy:prod`}</pre>
              <p className="hint">Prod only receives the version you already deployed to dev. Variables your deployed app needs go in <code>.env.dev</code> and <code>.env.prod</code>; each deploy sends them to the matching function.</p>
            </div>
            {s.endpoints && (
              <div className="endpoints">
                <div>
                  <span>Dev address</span>
                  <a href={s.endpoints.dev} target="_blank" rel="noreferrer">{s.endpoints.dev}</a>
                </div>
                <div>
                  <span>Prod address</span>
                  <a href={s.endpoints.prod} target="_blank" rel="noreferrer">{s.endpoints.prod}</a>
                </div>
                <p className="hint">Both addresses are public until you add sign-in to your app.</p>
              </div>
            )}
          </>
        )}

        <div>
          <p className="muted">Signed in as {s.username} ({s.email})</p>
          <button className="btn quiet" onClick={logout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
