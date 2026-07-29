import path from "node:path";
import {
  FileHostedJobStore,
  HostedJobController,
  type HostedJobStore,
} from "@evavo/job-control";

export type HostedJobStoreMode = "disabled" | "file";

export type HostedJobRuntime = Readonly<{
  available: boolean;
  mode: HostedJobStoreMode;
  controller: HostedJobController | null;
  store: HostedJobStore | null;
  storePath: string | null;
  persistentRecords: boolean;
  remoteExecutionAvailable: false;
  reason: string | null;
}>;

let retainedRuntime: Promise<HostedJobRuntime> | undefined;

function disabled(reason: string): HostedJobRuntime {
  return Object.freeze({
    available: false,
    mode: "disabled",
    controller: null,
    store: null,
    storePath: null,
    persistentRecords: false,
    remoteExecutionAvailable: false,
    reason,
  });
}

async function createRuntime(): Promise<HostedJobRuntime> {
  const rawMode = process.env.VECTOR_JOB_STORE_MODE?.trim().toLowerCase();
  const mode = rawMode || "disabled";
  if (mode === "disabled") {
    return disabled("VECTOR_JOB_STORE_MODE is disabled or unset.");
  }
  if (mode !== "file") {
    return disabled(`VECTOR_JOB_STORE_MODE=${mode} is not supported.`);
  }

  const production = process.env.NODE_ENV === "production";
  const persistentAcknowledgement =
    process.env.VECTOR_JOB_FILE_STORE_PERSISTENT?.trim().toLowerCase() === "true";
  if (production && !persistentAcknowledgement) {
    return disabled(
      "Production file storage remains disabled until VECTOR_JOB_FILE_STORE_PERSISTENT=true confirms a persistent mounted volume.",
    );
  }

  const requestedPath = process.env.VECTOR_JOB_STORE_PATH?.trim() ||
    path.join(process.cwd(), ".evavo-vector-api-jobs");
  const store = await FileHostedJobStore.open(requestedPath);
  const controller = new HostedJobController(store);
  return Object.freeze({
    available: true,
    mode: "file",
    controller,
    store,
    storePath: store.rootPath,
    persistentRecords: true,
    remoteExecutionAvailable: false,
    reason: null,
  });
}

export function getHostedJobRuntime(): Promise<HostedJobRuntime> {
  retainedRuntime ??= createRuntime();
  return retainedRuntime;
}

export function resetHostedJobRuntimeForTests(): void {
  retainedRuntime = undefined;
}
