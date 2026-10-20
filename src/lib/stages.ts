// Shared by the server (progress numbers) and the browser (labels, silo level).
export const STAGES = [
  "Tables, access keys and storage",
  "Dev function",
  "Prod function",
  "Credentials",
] as const;

export type Status = "provisioning" | "ready" | "failed";

/** How full the silo is, 0 to 1. Each stage fills a quarter; a running stage is half filled. */
export function fillRatio(status: Status, step: number): number {
  if (status === "ready") return 1;
  if (step <= 0) return 0.03;
  return Math.min((step - 1) / STAGES.length + 0.125, 0.97);
}
