import { cookies } from "next/headers";
import type { VectorWorkspaceContext } from "@evavo/hub-auth";
import { getVectorHubAuthRuntime } from "./hub-runtime";
import {
  localOrSignedVectorWorkspaceContext,
  vectorWorkspaceSessionCookieName,
} from "./hub-session";

export function currentVectorWorkspaceContext(): VectorWorkspaceContext | null {
  const runtime = getVectorHubAuthRuntime();
  const token = cookies().get(
    vectorWorkspaceSessionCookieName(runtime.production),
  )?.value;
  return localOrSignedVectorWorkspaceContext(token);
}
