import { VECTOR_PIPELINE } from "@evavo/vector-core";
import TraceWorkspace from "./components/TraceWorkspace";

const outputCards = [
  ["Clean SVG", "Available now", "Adaptive spline reconstruction, measured candidate selection, geometry inspection and optional difference PNG evidence."],
  ["Animated SVG", "CLI + MCP available", "Validated ID-targeted opacity and transform motion, deterministic CSS, reduced-motion fallback and review evidence. Browser authoring is planned."],
  ["Lottie", "Planned", "Portable timelines remain unavailable until feature-subset, schema and renderer compatibility validation is implemented."],
] as const;

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="EVAVO Vector Studio home">
          <span className="mark">E</span>
          <span>VECTOR STUDIO</span>
        </a>
        <nav aria-label="Workspace navigation">
          <a href="#workspace">Workspace</a>
          <a href="#pipeline">Pipeline</a>
          <a href="#automation">Automation</a>
        </nav>
        <span className="status"><i /> Bounded runtime</span>
      </header>

      <section id="top" className="hero">
        <p className="eyebrow">EVAVO PRODUCTION TOOL  /  VECTOR 01</p>
        <h1>Trace less.<br /><em>Reconstruct properly.</em></h1>
        <p className="lede">A governed raster-to-vector workspace that inspects the source, compares bounded reconstruction candidates, measures the selected SVG and shows exactly where human review is still required.</p>
        <div className="heroActions">
          <a className="primary" href="#workspace">Open workspace</a>
          <a className="secondary" href="#pipeline">Inspect the process</a>
        </div>
      </section>

      <TraceWorkspace />

      <section id="pipeline" className="pipeline section">
        <div className="sectionIntro"><p className="eyebrow">PROCESS, NOT A FILTER</p><h2>Every output carries its reasoning and evidence.</h2></div>
        <ol>{VECTOR_PIPELINE.map((stage, index) => <li key={stage.id}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{stage.label}</h3><p>{stage.purpose}</p></div><small>{stage.deterministic ? "Deterministic" : "Directed"}</small></li>)}</ol>
      </section>

      <section id="automation" className="section outputs">
        <div className="sectionIntro"><p className="eyebrow">ONE ENGINE, MULTIPLE SURFACES</p><h2>UI for judgement. API, CLI and MCP for repeatability.</h2></div>
        <div className="outputGrid">{outputCards.map(([title, status, copy]) => <article key={title}><span>{status}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        <pre><code>{`vector_animate_svg {
  "inputPath": "mark.svg",
  "motionPath": "mark.motion.json",
  "outputSvgPath": "mark.animated.svg",
  "evidenceOutputPath": "mark.motion.evidence.json"
}`}</code></pre>
      </section>

      <footer><span>EVAVO VECTOR STUDIO</span><span>Deliberate geometry. Verifiable output.</span></footer>
    </main>
  );
}
