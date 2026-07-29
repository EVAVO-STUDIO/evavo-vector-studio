import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentVectorWorkspaceContext } from "../../lib/workspace-access";
import MotionWorkspace from "./components/MotionWorkspace";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Motion Director · EVAVO Vector Studio",
  description: "Direct, generate and verify accessible animated SVG motion from governed vector artwork.",
};

const principles = [
  ["01", "Target deliberately", "Animate named SVG elements instead of guessing layers from pixels."],
  ["02", "Keep it inspectable", "Timing, easing, keyframes, hashes and reduced-motion behaviour remain explicit."],
  ["03", "Review the result", "A valid build is evidence-backed, not automatically approved creative direction."],
] as const;

const boundaries = [
  ["Available", "Opacity, translate, scale and rotate"],
  ["Required", "Portable IDs and reduced-motion fallback"],
  ["Rejected", "Scripts, external assets and stacked animation"],
  ["Not implied", "Lottie export or production approval"],
] as const;

export default function MotionDirectorPage() {
  const workspace = currentVectorWorkspaceContext();
  if (!workspace) redirect("/access");

  return (
    <main className={styles.page}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="EVAVO Vector Studio home">
          <span className="mark">E</span>
          <span>VECTOR STUDIO</span>
        </a>
        <nav aria-label="Motion Director navigation">
          <a href="/">Trace workspace</a>
          <a href="#director">Motion Director</a>
          <a href="#boundary">Contract</a>
          {workspace.actorType === "client" ? <a href="/api/auth/logout">Sign out</a> : null}
        </nav>
        <span className="status" title={workspace.organisation.name}>
          <i /> {workspace.workspace.name}
        </span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>EVAVO VECTOR STUDIO / MOTION DIRECTOR</p>
            <h1 className={styles.title}>Direct motion.<span>Keep intent visible.</span></h1>
            <p className={styles.copy}>Build script-free animated SVG for {workspace.organisation.name} from identified artwork layers, then verify the source, output, motion identity and accessibility fallback before the result is shown.</p>
          </div>
          <div className={styles.heroRail} aria-label="Motion Director capability summary">
            <div className={styles.railItem}><span>01</span><div><strong>Static source</strong><small>Governed SVG with portable target IDs.</small></div></div>
            <div className={styles.railItem}><span>02</span><div><strong>Directed plan</strong><small>Explicit tracks, keyframes, easing and playback.</small></div></div>
            <div className={styles.railItem}><span>03</span><div><strong>Verified output</strong><small>Hashes, identity, safety and reduced-motion evidence.</small></div></div>
          </div>
        </div>
      </section>

      <section className={styles.intro} aria-labelledby="motion-principles">
        <p id="motion-principles">Motion, not decoration</p>
        <div className={styles.introGrid}>
          {principles.map(([number, title, copy]) => (
            <article key={number}>
              <small>{number}</small>
              <h2>{title}</h2>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <div id="director">
        <MotionWorkspace />
      </div>

      <section id="boundary" className={styles.boundary}>
        <p className={styles.boundaryLabel}>Governed boundary</p>
        <div className={styles.boundaryCopy}>
          <h2>Deterministic animation is a production surface, not a substitute for art direction.</h2>
          <p>Motion Director makes supported behaviour explicit and rejects unsafe or ambiguous source conditions. It does not silently flatten existing animation, replace base transforms, infer missing layer intent, or claim that a technically valid movement is creatively finished.</p>
          <div className={styles.boundaryGrid}>
            {boundaries.map(([title, copy]) => <span key={title}><b>{title}</b>{copy}</span>)}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>EVAVO VECTOR STUDIO · MOTION DIRECTOR</span>
        <span>{workspace.workspace.name} · Script-free output · verified evidence · human review</span>
      </footer>
    </main>
  );
}
