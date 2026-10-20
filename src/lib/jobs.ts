import { getStore } from "./store";
import { provision, deprovision } from "./provisioner";

// Provisioning takes minutes, so it runs in this Node process after the signup request has
// already returned. This needs a long-running server (`next start`), not a serverless host,
// and a single instance: the job list below lives in memory.
const g = globalThis as unknown as {
  __gsJobs?: Map<string, Promise<void>>;
  __gsSlots?: { active: number; waiters: (() => void)[] };
};
const jobs = (g.__gsJobs ??= new Map());
const slots = (g.__gsSlots ??= { active: 0, waiters: [] });

const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_PROVISIONS ?? 2));

async function acquire(): Promise<() => void> {
  if (slots.active >= MAX_CONCURRENT) await new Promise<void>((resolve) => slots.waiters.push(resolve));
  slots.active++;
  return () => {
    slots.active--;
    slots.waiters.shift()?.();
  };
}

export const isRunning = (username: string) => jobs.has(username);

/** Starts provisioning in the background. `clean` removes any half-built resources first. */
export function startProvisioning(username: string, opts: { clean?: boolean } = {}): void {
  if (jobs.has(username)) return;
  const job = run(username, !!opts.clean).finally(() => jobs.delete(username));
  jobs.set(username, job);
}

async function run(username: string, clean: boolean) {
  const store = getStore();
  await store.updateUser(username, { status: "provisioning", step: 0, error: "" }).catch(() => {});
  const release = await acquire();

  // Progress writes happen one after another so a late one can never overwrite the final state.
  let writes: Promise<unknown> = Promise.resolve();
  try {
    if (clean) await deprovision(username);
    const result = await provision(username, (p) => {
      writes = writes.then(() => store.updateUser(username, { step: p.step })).catch(() => {});
    });
    await writes;
    await store.updateUser(username, { status: "ready", step: 4, error: "", endpoints: result.endpoints });
  } catch (e) {
    // Full detail stays in the server log; the user only sees a safe summary.
    console.error(`[provision] ${username} failed:`, e);
    await writes;
    await store
      .updateUser(username, { status: "failed", error: "We couldn't finish setting up your account. Nothing was kept. Try again." })
      .catch(() => {});
  } finally {
    release();
  }
}
