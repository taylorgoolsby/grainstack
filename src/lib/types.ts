import type { Status } from "./stages";

export interface StatusResponse {
  username: string;
  email: string;
  status: Status;
  /** 0 = queued, 1-4 = the stage currently running (see STAGES) */
  step: number;
  error: string;
  endpoints?: { dev: string; prod: string };
}
