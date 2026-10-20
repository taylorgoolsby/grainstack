import { getSessionUser } from "./auth";
import { getStore } from "./store";
import { isRunning } from "./jobs";
import type { StatusResponse } from "./types";

/** The signed-in user's account status, or undefined when not signed in. */
export async function currentStatus(): Promise<StatusResponse | undefined> {
  let user = await getSessionUser();
  if (!user) return undefined;

  // A "provisioning" account with no job in this process means the server restarted mid-setup.
  if (user.status === "provisioning" && !isRunning(user.username)) {
    await getStore().updateUser(user.username, {
      status: "failed",
      error: "Setup was interrupted. Try again to clear it and start over.",
    });
    user = { ...user, status: "failed", error: "Setup was interrupted. Try again to clear it and start over." };
  }
  return {
    username: user.username,
    email: user.email,
    status: user.status,
    step: user.step,
    error: user.error,
    endpoints: user.endpoints,
  };
}
