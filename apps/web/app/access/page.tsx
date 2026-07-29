import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentVectorWorkspaceContext } from "../../lib/workspace-access";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private access · EVAVO Vector Studio",
  description: "Return to the EVAVO hub to open an assigned Vector Studio workspace.",
  robots: { index: false, follow: false, nocache: true },
};

const REASONS: Readonly<Record<string, Readonly<{ title: string; copy: string }>>> = Object.freeze({
  invalid: Object.freeze({
    title: "That launch could not be verified.",
    copy: "Nothing was opened or changed. Return to the EVAVO hub and create a fresh workspace launch.",
  }),
  used: Object.freeze({
    title: "That launch has already been used.",
    copy: "Vector Studio handoffs are intentionally single use. Return to the hub for a fresh private launch.",
  }),
  "temporarily-unavailable": Object.freeze({
    title: "Private launch is temporarily unavailable.",
    copy: "The signed launch or replay boundary is not safely available. Existing sessions remain unchanged; try again from the hub after the configuration is restored.",
  }),
});

function reasonValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value in REASONS ? value : null;
}

export default function VectorAccessPage({
  searchParams,
}: Readonly<{
  searchParams?: Readonly<{ reason?: string | string[] }>;
}>) {
  if (currentVectorWorkspaceContext()) redirect("/");
  const reason = reasonValue(searchParams?.reason);
  const message = reason ? REASONS[reason] : null;

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="vector-access-title">
        <div className={styles.brand}>
          <span aria-hidden="true">E</span>
          <div><strong>EVAVO</strong><small>Vector Studio</small></div>
        </div>

        <div className={styles.hero}>
          <p>Private production workspace</p>
          <h1 id="vector-access-title">
            Open Vector Studio<br /><em>from the EVAVO hub.</em>
          </h1>
          <span>
            Access is bound to a verified EVAVO session, organisation, workspace and application assignment. The launch is exchanged once for an app-private HttpOnly session before tracing or motion tools open.
          </span>
        </div>

        {message ? (
          <div className={styles.notice} role="alert">
            <strong>{message.title}</strong>
            <p>{message.copy}</p>
          </div>
        ) : null}

        <div className={styles.actions}>
          <a href="https://evavo.com.au/client">Return to EVAVO hub</a>
          <span>No provider, billing or deployment action runs from this screen.</span>
        </div>

        <div className={styles.proof} aria-label="Private launch safeguards">
          <article><small>Handoff</small><strong>Two minutes</strong><p>Bound to the exact Vector Studio host and workspace.</p></article>
          <article><small>Replay</small><strong>Single use</strong><p>Consumed atomically before a private session is returned.</p></article>
          <article><small>Session</small><strong>App private</strong><p>Separate signing authority, HttpOnly cookie and eight-hour expiry.</p></article>
        </div>
      </section>
    </main>
  );
}
