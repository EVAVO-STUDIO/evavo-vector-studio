import { VECTOR_PIPELINE } from "@evavo/vector-core";

const outputCards = [
  ["Clean SVG", "Editable paths, compound shapes, restrained anchor counts and production metadata."],
  ["Animated SVG", "Layer-aware motion, morph-safe geometry, CSS or SMIL export and reduced-motion fallback."],
  ["Lottie", "Portable timelines with supported features, validation and renderer compatibility evidence."]
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
        <span className="status"><i /> Local first</span>
      </header>

      <section id="top" className="hero">
        <p className="eyebrow">EVAVO PRODUCTION TOOL  /  VECTOR 01</p>
        <h1>Trace less.<br /><em>Reconstruct properly.</em></h1>
        <p className="lede">A governed vector production workspace for turning raster artwork into deliberate, editable SVG, animated SVG and Lottie assets without generic auto-trace debris.</p>
        <div className="heroActions">
          <a className="primary" href="#workspace">Open workspace</a>
          <a className="secondary" href="#pipeline">Inspect the process</a>
        </div>
      </section>

      <section id="workspace" className="workspace">
        <div className="panel uploadPanel">
          <div className="panelHeading"><span>01</span><div><p>Source</p><h2>Bring in artwork</h2></div></div>
          <label className="dropzone">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/tiff,image/svg+xml" />
            <strong>Drop an image here</strong>
            <span>PNG, JPG, WebP, TIFF or SVG reference</span>
            <small>Source files remain local until a job is deliberately submitted.</small>
          </label>
          <div className="settings">
            <label>Artwork class<select defaultValue="logo"><option value="logo">Logo or brand mark</option><option value="icon">Icon</option><option value="line-art">Line art</option><option value="illustration">Illustration</option><option value="photo">Photographic source</option></select></label>
            <label>Maximum colours<input type="number" min="1" max="256" defaultValue="16" /></label>
            <label>Visual error budget<input type="number" min="0.01" max="1" step="0.01" defaultValue="0.08" /></label>
          </div>
        </div>
        <div className="panel previewPanel">
          <div className="panelHeading"><span>02</span><div><p>Review</p><h2>Compare before export</h2></div></div>
          <div className="canvas"><div className="specimen"><span>V</span></div><p>Source and reconstructed output will appear here with zoom, overlays and difference inspection.</p></div>
          <div className="metrics"><span><b>Topology</b> pending</span><span><b>Anchor economy</b> pending</span><span><b>Render match</b> pending</span></div>
        </div>
      </section>

      <section id="pipeline" className="pipeline section">
        <div className="sectionIntro"><p className="eyebrow">PROCESS, NOT A FILTER</p><h2>Every output carries its reasoning and evidence.</h2></div>
        <ol>{VECTOR_PIPELINE.map((stage, index) => <li key={stage.id}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{stage.label}</h3><p>{stage.purpose}</p></div><small>{stage.deterministic ? "Deterministic" : "Directed"}</small></li>)}</ol>
      </section>

      <section id="automation" className="section outputs">
        <div className="sectionIntro"><p className="eyebrow">ONE ENGINE, THREE SURFACES</p><h2>UI for judgement. API and CLI for repeatability.</h2></div>
        <div className="outputGrid">{outputCards.map(([title, copy]) => <article key={title}><span>OUTPUT</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        <pre><code>{`curl -X POST /api/v1/jobs \\
  -H "content-type: application/json" \\
  -d '{"sourceName":"mark.png","sourceMimeType":"image/png","kind":"logo","outputs":["svg"],"preservePalette":true,"maxColours":16,"targetError":0.08}'`}</code></pre>
      </section>

      <footer><span>EVAVO VECTOR STUDIO</span><span>Deliberate geometry. Verifiable output.</span></footer>
    </main>
  );
}
