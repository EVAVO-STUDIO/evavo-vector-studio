import { VECTOR_PIPELINE } from "@evavo/vector-core";
import TraceWorkspace from "./components/TraceWorkspace";

const outputCards = [
  ["Clean SVG", "Available now", "Adaptive spline reconstruction, measured candidate selection, geometry inspection and optional difference PNG evidence."],
  ["Animated SVG", "UI + API + CLI + MCP available", "Direct ID-targeted opacity and transform motion in the browser, then verify deterministic CSS, reduced-motion fallback and output evidence."],
  ["Lottie + dotLottie", "UI + API + CLI + MCP available", "Governed shape-layer JSON, deterministic dotLottie v2 packaging, browser verification and official-player review are available. Independent source-to-player render validation remains review work."],
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
          <a href="#workspace">Trace workspace</a>
          <a href="/motion">Motion Director</a>
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
          <a className="primary" href="#workspace">Open trace workspace</a>
          <a className="secondary" href="/motion">Direct SVG motion</a>
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
        <pre><code>{`POST /api/v1/trace
file=mark.png
profile=auto
includeDifference=true
differenceMaxDimension=512
format=json

POST /api/v1/motion/svg
file=mark.svg
motionFile=mark.motion.json
format=svg

POST /api/v1/motion/lottie
file=mark.svg
motionFile=mark.motion.json
frameRate=60
precision=4
format=lottie

POST /api/v1/motion/dotlottie
file=mark.svg
motionFile=mark.motion.json
animationId=mark-intro
format=dotlottie

pnpm vector:dotlottie:package -- \
  mark.lottie.json \
  --out mark.lottie \
  --animation-id mark-intro

vector_export_lottie {
  "inputPath": "mark.svg",
  "motionPath": "mark.motion.json",
  "outputLottiePath": "mark.lottie.json",
  "evidenceOutputPath": "mark.lottie.evidence.json"
}`}</code></pre>
      </section>

      <footer><span>EVAVO VECTOR STUDIO</span><span>Deliberate geometry. Verifiable output.</span></footer>
    </main>
  );
}
