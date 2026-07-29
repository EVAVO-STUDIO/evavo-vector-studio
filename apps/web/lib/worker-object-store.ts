import path from "node:path";
import {
  FileVectorObjectStore,
  type VectorObjectStore,
} from "@evavo/worker-engine/object-store";

export type WorkerObjectStoreMode = "disabled" | "file";

export type WorkerObjectStoreRuntime = Readonly<{
  available: boolean;
  mode: WorkerObjectStoreMode;
  store: VectorObjectStore | null;
  storePath: string | null;
  persistentObjects: boolean;
  objectTransferAvailable: boolean;
  reason: string | null;
}>;

let retainedRuntime: Promise<WorkerObjectStoreRuntime> | undefined;

function disabled(reason: string): WorkerObjectStoreRuntime {
  return Object.freeze({
    available: false,
    mode: "disabled",
    store: null,
    storePath: null,
    persistentObjects: false,
    objectTransferAvailable: false,
    reason,
  });
}

async function createRuntime(): Promise<WorkerObjectStoreRuntime> {
  const rawMode = process.env.VECTOR_OBJECT_STORE_MODE?.trim().toLowerCase();
  const mode = rawMode || "disabled";
  if (mode === "disabled") {
    return disabled("VECTOR_OBJECT_STORE_MODE is disabled or unset.");
  }
  if (mode !== "file") {
    return disabled(`VECTOR_OBJECT_STORE_MODE=${mode} is not supported.`);
  }

  const production = process.env.NODE_ENV === "production";
  const persistentAcknowledgement =
    process.env.VECTOR_OBJECT_FILE_STORE_PERSISTENT?.trim().toLowerCase() ===
      "true";
  if (production && !persistentAcknowledgement) {
    return disabled(
      "Production file object storage remains disabled until VECTOR_OBJECT_FILE_STORE_PERSISTENT=true confirms a persistent mounted volume.",
    );
  }

  const requestedPath = process.env.VECTOR_OBJECT_STORE_PATH?.trim() ||
    path.join(process.cwd(), ".evavo-vector-api-objects");
  const store = await FileVectorObjectStore.open(requestedPath);
  return Object.freeze({
    available: true,
    mode: "file" as const,
    store,
    storePath: store.rootPath,
    persistentObjects: true,
    objectTransferAvailable: true,
    reason: null,
  });
}

export function getWorkerObjectStoreRuntime(): Promise<WorkerObjectStoreRuntime> {
  retainedRuntime ??= createRuntime();
  return retainedRuntime;
}

export function resetWorkerObjectStoreRuntimeForTests(): void {
  retainedRuntime = undefined;
}
