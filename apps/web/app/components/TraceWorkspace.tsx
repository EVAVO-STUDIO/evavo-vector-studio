"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import styles from "./TraceWorkspace.module.css";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const PROFILE_COLOURS = {
  auto: 16,
  logo: 12,
  icon: 24,
  "line-art": 2,
  illustration: 64,
  photo: 128,
} as const;

type Profile = keyof typeof PROFILE_COLOURS;

type TraceEvidence = {
  analysis: {
    source: { width: number; height: number; inputBytes: number; mimeType: string; sha256: string };
    suggestedProfile: string;
    colour: { estimatedColours: number; dominantColours: Array<{ hex: string; share: number }> };
    detail: { edgeDensity: number };
  };
  trace: { requestedProfile: string; resolvedProfile: string };
  output: { bytes: number; pathCount: number; groupCount: number; viewBox: [number, number, number, number] | null };
  comparison: {
    quality: "excellent" | "good" | "review";
    aggregate: {
      visualMae: number;
      alphaMae: number;
      mismatchFraction: number;
      aspectRatioDelta: number;
      comparedPixelCount: number;
      largestComparedDimension: number;
    };
    scales: Array<{ width: number; height: number; visualMae: number; mismatchFraction: number }>;
  };
  qualityGates: { renderComparison: "passed" | "review-required"; productionApproval: "review-required" };
  warnings: Array<{ code: string; severity: string; message: string }>;
};

type TraceResponse = {
  id: string;
  status: "complete";
  approval: "review-required";
  svg: string;
  evidence: TraceEvidence;
};

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function percentage(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function acceptedRaster(file: File): boolean {
  if (/^image\/(png|jpeg|webp|gif|bmp|tiff)$/i.test(file.type)) return true;
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

export default function TraceWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>("auto");
  const [maxColours, setMaxColours] = useState(PROFILE_COLOURS.auto);
  const [preservePalette, setPreservePalette] = useState(true);
  const [optimise, setOptimise] = useState(true);
  const [title, setTitle] = useState("");
  const [token, setToken] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResponse | null>(null);

  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!result?.svg) {
      setSvgUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
    setSvgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  function selectFile(candidate: File | undefined): void {
    if (!candidate) return;
    setError(null);
    setResult(null);
    if (!acceptedRaster(candidate)) {
      setFile(null);
      setError("Choose a PNG, JPEG, WebP, GIF, BMP or TIFF raster image.");
      return;
    }
    if (candidate.size > MAX_INPUT_BYTES) {
      setFile(null);
      setError("The source exceeds the 25 MB guarded input limit.");
      return;
    }
    setFile(candidate);
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("profile", profile);
      form.set("maxColours", String(maxColours));
      form.set("preservePalette", String(preservePalette));
      form.set("optimise", String(optimise));
      form.set("format", "json");
      if (title.trim()) form.set("title", title.trim());
      const response = await fetch("/api/v1/trace", {
        method: "POST",
        headers: token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined,
        body: form,
      });
      const payload = (await response.json()) as TraceResponse & { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || `Trace failed with HTTP ${response.status}.`);
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section id="workspace" className="workspace" aria-label="Vector reconstruction workspace">
      <div className="panel uploadPanel">
        <div className="panelHeading"><span>01</span><div><p>Source</p><h2>Reconstruct artwork</h2></div></div>
        <label
          className={`dropzone ${styles.dropzone} ${dragActive ? styles.dropzoneActive : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,.tif,.tiff"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
          {sourceUrl ? <img className={styles.sourcePreview} src={sourceUrl} alt="Selected raster source preview" /> : <span className={styles.uploadMark}>+</span>}
          <span className={styles.dropPrompt}>{file ? "Choose a different source" : "Drop artwork or browse"}</span>
          <small>PNG, JPEG, WebP, GIF, BMP or TIFF. Guarded at 25 MB and 40 million decoded pixels.</small>
          {file ? <strong className={styles.fileBadge}>{file.name} · {readableBytes(file.size)}</strong> : null}
        </label>

        <form className={styles.form} onSubmit={submit}>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>Trace profile
              <select value={profile} onChange={(event) => { const value = event.target.value as Profile; setProfile(value); setMaxColours(PROFILE_COLOURS[value]); }}>
                <option value="auto">Auto inspect first</option>
                <option value="logo">Logo or brand mark</option>
                <option value="icon">Icon</option>
                <option value="line-art">Line art</option>
                <option value="illustration">Illustration</option>
                <option value="photo">Photographic source</option>
              </select>
            </label>
            <label className={styles.field}>Target colours
              <input type="number" min="1" max="256" value={maxColours} onChange={(event) => setMaxColours(Number(event.target.value))} />
            </label>
            <label className={styles.field}>Accessible title
              <input type="text" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional SVG title" />
            </label>
          </div>

          <div className={styles.switchRow}>
            <label><input type="checkbox" checked={preservePalette} onChange={(event) => setPreservePalette(event.target.checked)} /><span>Preserve source palette</span></label>
            <label><input type="checkbox" checked={optimise} onChange={(event) => setOptimise(event.target.checked)} /><span>Safe multipass optimisation</span></label>
          </div>

          <label className={styles.tokenField}>API token <span>required only when the deployed API is protected</span>
            <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Kept in this browser tab only" />
          </label>

          <div className={styles.submitRow}>
            <button className={styles.submitButton} type="submit" disabled={!file || running}>{running ? "Tracing and comparing…" : "Create governed SVG"}</button>
            <span>{file ? "Source ready for bounded tracing and multi-scale render comparison." : "Select a source to begin."}</span>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form>
      </div>

      <div className="panel previewPanel">
        <div className="panelHeading"><span>02</span><div><p>Review</p><h2>Source against output</h2></div></div>
        <div className={styles.comparison}>
          <figure>
            <figcaption><span>Raster source</span>{file ? readableBytes(file.size) : "Awaiting source"}</figcaption>
            <div className={styles.checker}>{sourceUrl ? <img src={sourceUrl} alt="Raster source" /> : <p>Select artwork to create a local preview.</p>}</div>
          </figure>
          <figure>
            <figcaption><span>SVG reconstruction</span>{result ? readableBytes(result.evidence.output.bytes) : "Not generated"}</figcaption>
            <div className={styles.checker}>{svgUrl ? <img src={svgUrl} alt="Generated SVG reconstruction" /> : <p>The reconstructed SVG will appear here without injecting its markup into the page.</p>}</div>
          </figure>
        </div>

        <div className={styles.metrics} aria-live="polite">
          <span><b>Profile</b>{result ? `${result.evidence.trace.resolvedProfile}${result.evidence.trace.requestedProfile === "auto" ? " · auto" : " · directed"}` : "pending"}</span>
          <span><b>Geometry</b>{result ? `${result.evidence.output.pathCount.toLocaleString()} paths` : "pending"}</span>
          <span><b>Render evidence</b>{result ? `${result.evidence.comparison.quality} · MAE ${percentage(result.evidence.comparison.aggregate.visualMae)}` : "pending"}</span>
        </div>

        {result ? (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <div>
                <small>JOB {result.id}</small>
                <strong>Visual comparison: {result.evidence.comparison.quality}</strong>
                <span>Compared {result.evidence.comparison.aggregate.comparedPixelCount.toLocaleString()} rendered pixels across {result.evidence.comparison.scales.length} scale{result.evidence.comparison.scales.length === 1 ? "" : "s"}, up to {result.evidence.comparison.aggregate.largestComparedDimension}px. Human production approval remains required.</span>
              </div>
              {svgUrl ? <a className={styles.download} href={svgUrl} download={`${file?.name.replace(/\.[^.]+$/, "") || "vector"}.svg`}>Download SVG</a> : null}
            </div>
            <dl className={styles.evidenceGrid}>
              <div><dt>Source</dt><dd>{result.evidence.analysis.source.width} × {result.evidence.analysis.source.height}</dd></div>
              <div><dt>Detected colours</dt><dd>{result.evidence.analysis.colour.estimatedColours.toLocaleString()}</dd></div>
              <div><dt>Visual MAE</dt><dd>{percentage(result.evidence.comparison.aggregate.visualMae)}</dd></div>
              <div><dt>Mismatch pixels</dt><dd>{percentage(result.evidence.comparison.aggregate.mismatchFraction)}</dd></div>
            </dl>
            {result.evidence.warnings.length ? <ul className={styles.warningList}>{result.evidence.warnings.map((warning) => <li key={`${warning.code}-${warning.message}`}><b>{warning.code}</b><span>{warning.message}</span></li>)}</ul> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
