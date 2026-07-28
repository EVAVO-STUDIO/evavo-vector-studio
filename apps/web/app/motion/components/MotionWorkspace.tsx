"use client";

import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import LottieReview from "./LottieReview";
import styles from "./MotionWorkspace.module.css";
import {
  MOTION_PRESETS,
  MOTION_SOURCE_MAX_BYTES,
  addInterpolatedKeyframe,
  applyPreset,
  buildMotionPlan,
  createTrack,
  inspectSvgForMotion,
  type KeyframeDraft,
  type MotionDirection,
  type MotionFillMode,
  type MotionPlan,
  type MotionPreset,
  type MotionTarget,
  type ParsedMotionSource,
  type ReducedMotionStrategy,
  type TrackDraft,
} from "./motion-model";

type MotionApiResponse = Readonly<{
  id: string;
  status: "complete";
  approval: "review-required";
  source: Readonly<{
    name: string;
    declaredType: string | null;
    bytes: number;
    sha256: string;
  }>;
  motionPlan: Readonly<{
    mode: "inline" | "file";
    name: string | null;
    declaredType: string | null;
    bytes: number;
    normalized: MotionPlan;
  }>;
  svg: string;
  inspection: Readonly<{
    valid: boolean;
    contractVersion: string | null;
    motionId: string | null;
    styleId: string | null;
    keyframeRuleCount: number;
    targetRuleCount: number;
    reducedMotionFallback: boolean;
    findings: readonly Readonly<{ code: string; severity: string; message: string }>[];
  }>;
  evidence: Readonly<{
    contractVersion: "1.0";
    source: Readonly<{ bytes: number; sha256: string }>;
    motion: Readonly<{
      id: string;
      name: string;
      durationMs: number;
      delayMs: number;
      iterations: number | "infinite";
      direction: string;
      fillMode: string;
      reducedMotion: string;
      trackCount: number;
      keyframeCount: number;
      targets: readonly string[];
    }>;
    output: Readonly<{
      mimeType: "image/svg+xml";
      bytes: number;
      sha256: string;
      styleId: string;
      keyframeRuleCount: number;
    }>;
    safety: Readonly<{
      scriptsAdded: false;
      externalReferencesAdded: false;
      reducedMotionFallback: true;
      deterministicOutput: true;
    }>;
    approval: "review-required";
    warnings: readonly Readonly<{ code: string; severity: string; message: string }>[];
  }>;
}>;

type VerifiedMotionResult = Readonly<{
  response: MotionApiResponse;
  submittedPlan: MotionPlan;
  verifiedAt: string;
}>;

const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
const DIRECTIONS: readonly MotionDirection[] = ["normal", "reverse", "alternate", "alternate-reverse"];
const FILL_MODES: readonly MotionFillMode[] = ["none", "forwards", "backwards", "both"];
const REDUCED_MOTION: readonly ReducedMotionStrategy[] = ["source", "first-frame", "last-frame"];

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify SHA-256 evidence.");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyMotionResponse(
  response: MotionApiResponse,
  sourceText: string,
  submittedPlan: MotionPlan,
): Promise<void> {
  if (!response.inspection?.valid) throw new Error("The animated SVG failed its returned motion inspection.");
  if (response.approval !== "review-required" || response.evidence.approval !== "review-required") {
    throw new Error("The API returned an unsupported production approval state.");
  }
  if (response.evidence.contractVersion !== "1.0" || response.inspection.contractVersion !== "1.0") {
    throw new Error("The animated SVG uses an unsupported motion contract version.");
  }
  if (!response.svg.includes('data-evavo-motion-contract="1.0"')) {
    throw new Error("The animated SVG is missing its motion contract marker.");
  }
  if (/<script\b/i.test(response.svg)) throw new Error("The animated SVG unexpectedly contains script content.");
  if (!response.inspection.reducedMotionFallback || !response.evidence.safety.reducedMotionFallback) {
    throw new Error("The animated SVG is missing the required reduced-motion fallback.");
  }
  if (response.evidence.safety.scriptsAdded !== false || response.evidence.safety.externalReferencesAdded !== false) {
    throw new Error("The animated SVG safety evidence is inconsistent.");
  }
  if (response.evidence.motion.id !== response.inspection.motionId) {
    throw new Error("Motion identity does not match the animated SVG inspection.");
  }
  if (response.evidence.output.styleId !== response.inspection.styleId) {
    throw new Error("Motion style identity does not match the animated SVG inspection.");
  }
  if (response.evidence.motion.trackCount !== submittedPlan.tracks.length) {
    throw new Error("The API response does not contain the submitted number of motion tracks.");
  }
  const expectedTargets = submittedPlan.tracks.map((track) => track.targetId);
  if (JSON.stringify(response.evidence.motion.targets) !== JSON.stringify(expectedTargets)) {
    throw new Error("The animated SVG targets do not match the submitted plan.");
  }

  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(sourceText).byteLength;
  const outputBytes = encoder.encode(response.svg).byteLength;
  if (sourceBytes !== response.evidence.source.bytes || outputBytes !== response.evidence.output.bytes) {
    throw new Error("Source or output byte evidence does not match the returned text.");
  }
  const [sourceHash, outputHash] = await Promise.all([sha256(sourceText), sha256(response.svg)]);
  if (sourceHash !== response.evidence.source.sha256 || sourceHash !== response.source.sha256) {
    throw new Error("The source SVG failed SHA-256 verification.");
  }
  if (outputHash !== response.evidence.output.sha256) {
    throw new Error("The animated SVG failed SHA-256 verification.");
  }
}

function evidenceDocument(result: VerifiedMotionResult): string {
  return JSON.stringify({
    id: result.response.id,
    status: result.response.status,
    approval: result.response.approval,
    source: result.response.source,
    motionPlan: result.response.motionPlan,
    inspection: result.response.inspection,
    evidence: result.response.evidence,
    browserVerification: {
      verifiedAt: result.verifiedAt,
      sourceSha256: true,
      outputSha256: true,
      motionIdentity: true,
      styleIdentity: true,
      reducedMotionFallback: true,
      scriptFree: true,
    },
  }, null, 2);
}

export default function MotionWorkspace() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceInspection, setSourceInspection] = useState<ParsedMotionSource | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [name, setName] = useState("Directed motion");
  const [durationMs, setDurationMs] = useState(900);
  const [delayMs, setDelayMs] = useState(0);
  const [iterations, setIterations] = useState<number | "infinite">(1);
  const [direction, setDirection] = useState<MotionDirection>("normal");
  const [fillMode, setFillMode] = useState<MotionFillMode>("both");
  const [reducedMotion, setReducedMotion] = useState<ReducedMotionStrategy>("last-frame");
  const [tracks, setTracks] = useState<readonly TrackDraft[]>([]);
  const [token, setToken] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifiedMotionResult | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [replayRevision, setReplayRevision] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const sourceUrl = useObjectUrl(sourceFile);
  const animatedBlob = useMemo(
    () => result ? new Blob([result.response.svg], { type: "image/svg+xml" }) : null,
    [result, replayRevision],
  );
  const animatedUrl = useObjectUrl(animatedBlob);

  const planState = useMemo(() => {
    if (!sourceInspection || tracks.length === 0) return { plan: null, error: null } as const;
    try {
      return {
        plan: buildMotionPlan({
          name,
          durationMs,
          delayMs,
          iterations,
          direction,
          fillMode,
          reducedMotion,
          tracks,
          targets: sourceInspection.targets,
        }),
        error: null,
      } as const;
    } catch (caught) {
      return { plan: null, error: caught instanceof Error ? caught.message : String(caught) } as const;
    }
  }, [delayMs, direction, durationMs, fillMode, iterations, name, reducedMotion, sourceInspection, tracks]);

  const planJson = planState.plan ? `${JSON.stringify(planState.plan, null, 2)}\n` : null;
  const planBlob = useMemo(
    () => planJson ? new Blob([planJson], { type: "application/json" }) : null,
    [planJson],
  );
  const planUrl = useObjectUrl(planBlob);
  const resultEvidence = result ? `${evidenceDocument(result)}\n` : null;
  const evidenceBlob = useMemo(
    () => resultEvidence ? new Blob([resultEvidence], { type: "application/json" }) : null,
    [resultEvidence],
  );
  const evidenceUrl = useObjectUrl(evidenceBlob);

  function markChanged(): void {
    setError(null);
    if (result) setResultStale(true);
  }

  async function selectSource(candidate: File | undefined): Promise<void> {
    if (!candidate) return;
    setError(null);
    setResult(null);
    setResultStale(false);
    if (!/\.svg$/i.test(candidate.name) && candidate.type !== "image/svg+xml") {
      setSourceFile(null);
      setSourceText("");
      setSourceInspection(null);
      setTracks([]);
      setError("Choose a static SVG file.");
      return;
    }
    if (candidate.size === 0 || candidate.size > MOTION_SOURCE_MAX_BYTES) {
      setError(`The SVG must be between 1 byte and ${readableBytes(MOTION_SOURCE_MAX_BYTES)}.`);
      return;
    }
    try {
      const text = await candidate.text();
      const inspection = inspectSvgForMotion(text);
      const base = candidate.name.replace(/\.svg$/i, "");
      setSourceFile(candidate);
      setSourceText(text);
      setSourceInspection(inspection);
      setName(`${base} motion`.slice(0, 120));
      setTracks([createTrack(inspection.targets[0]!.id)]);
    } catch (caught) {
      setSourceFile(null);
      setSourceText("");
      setSourceInspection(null);
      setTracks([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragActive(false);
    void selectSource(event.dataTransfer.files[0]);
  }

  function updateTrack(trackId: string, updater: (track: TrackDraft) => TrackDraft): void {
    markChanged();
    setTracks((current) => current.map((track) => track.id === trackId ? updater(track) : track));
  }

  function updateFrame(trackId: string, frameId: string, patch: Partial<KeyframeDraft>): void {
    updateTrack(trackId, (track) => Object.freeze({
      ...track,
      preset: "custom",
      keyframes: Object.freeze(track.keyframes.map((item) =>
        item.id === frameId ? Object.freeze({ ...item, ...patch, id: item.id }) : item,
      )),
    }));
  }

  function addTrack(): void {
    if (!sourceInspection) return;
    const used = new Set(tracks.map((track) => track.targetId));
    const available = sourceInspection.targets.find((target) => !used.has(target.id));
    if (!available) {
      setError("Every available SVG target is already assigned to a track.");
      return;
    }
    markChanged();
    setTracks((current) => [...current, createTrack(available.id)]);
  }

  function removeTrack(trackId: string): void {
    markChanged();
    setTracks((current) => current.filter((track) => track.id !== trackId));
  }

  function addKeyframe(trackId: string): void {
    try {
      updateTrack(trackId, addInterpolatedKeyframe);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function removeKeyframe(trackId: string, frameId: string): void {
    updateTrack(trackId, (track) => {
      if (track.keyframes.length <= 2) return track;
      const index = track.keyframes.findIndex((item) => item.id === frameId);
      if (index <= 0 || index >= track.keyframes.length - 1) return track;
      return Object.freeze({
        ...track,
        preset: "custom",
        keyframes: Object.freeze(track.keyframes.filter((item) => item.id !== frameId)),
      });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!sourceFile || !sourceText || !planState.plan || running) {
      setError(planState.error ?? "Select a valid SVG and complete the motion plan.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", sourceFile);
      form.set("motion", JSON.stringify(planState.plan));
      form.set("format", "json");
      const response = await fetch("/api/v1/motion/svg", {
        method: "POST",
        headers: token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined,
        body: form,
      });
      const payload = (await response.json()) as MotionApiResponse & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.message || payload.error || `Motion generation failed with HTTP ${response.status}.`);
      }
      await verifyMotionResponse(payload, sourceText, planState.plan);
      setResult(Object.freeze({
        response: payload,
        submittedPlan: planState.plan,
        verifiedAt: new Date().toISOString(),
      }));
      setResultStale(false);
      setReplayRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  const usedTargets = new Set(tracks.map((track) => track.targetId));
  const baseName = sourceFile?.name.replace(/\.svg$/i, "") || "vector";

  return (
    <section className={styles.workspace} aria-label="Animated SVG motion director" aria-busy={running}>
      <form className={styles.editor} onSubmit={submit}>
        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div><small>01 · Source</small><h2>Choose a governed SVG</h2></div>
            {sourceInspection ? <span className={styles.ready}>source ready</span> : null}
          </div>
          <label
            className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <input type="file" accept="image/svg+xml,.svg" onChange={(event) => void selectSource(event.target.files?.[0])} />
            <strong>{sourceFile ? "Replace SVG source" : "Drop SVG or browse"}</strong>
            <span>{sourceFile ? `${sourceFile.name} · ${readableBytes(sourceFile.size)}` : "Static, ID-structured SVG · maximum 5 MiB"}</span>
            <small>Scripts, external references, duplicate IDs and existing animation are rejected before preview.</small>
          </label>
          {sourceInspection ? (
            <div className={styles.sourceFacts}>
              <span><b>{sourceInspection.targets.length}</b> targetable IDs</span>
              <span><b>{sourceInspection.viewBox ?? "not set"}</b> viewBox</span>
              <span><b>{sourceInspection.ignoredIdCount}</b> non-graphic IDs ignored</span>
            </div>
          ) : null}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div><small>02 · Direction</small><h2>Set playback behaviour</h2></div>
            <span className={styles.contract}>motion v1</span>
          </div>
          <div className={styles.globalGrid}>
            <label className={styles.fieldWide}>Motion name
              <input value={name} maxLength={120} onChange={(event) => { markChanged(); setName(event.target.value); }} />
            </label>
            <label>Duration, ms
              <input type="number" min="16" max="3600000" value={durationMs} onChange={(event) => { markChanged(); setDurationMs(Number(event.target.value)); }} />
            </label>
            <label>Delay, ms
              <input type="number" min="0" max="600000" value={delayMs} onChange={(event) => { markChanged(); setDelayMs(Number(event.target.value)); }} />
            </label>
            <label>Iterations
              <select value={String(iterations)} onChange={(event) => { markChanged(); setIterations(event.target.value === "infinite" ? "infinite" : Number(event.target.value)); }}>
                <option value="1">Once</option>
                <option value="2">Twice</option>
                <option value="3">Three times</option>
                <option value="infinite">Infinite loop</option>
              </select>
            </label>
            <label>Direction
              <select value={direction} onChange={(event) => { markChanged(); setDirection(event.target.value as MotionDirection); }}>
                {DIRECTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Fill mode
              <select value={fillMode} onChange={(event) => { markChanged(); setFillMode(event.target.value as MotionFillMode); }}>
                {FILL_MODES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Reduced motion
              <select value={reducedMotion} onChange={(event) => { markChanged(); setReducedMotion(event.target.value as ReducedMotionStrategy); }}>
                {REDUCED_MOTION.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div><small>03 · Tracks</small><h2>Direct targets and keyframes</h2></div>
            <button type="button" className={styles.secondaryButton} disabled={!sourceInspection || usedTargets.size >= sourceInspection.targets.length} onClick={addTrack}>Add track</button>
          </div>
          <div className={styles.trackStack}>
            {tracks.length === 0 ? <p className={styles.empty}>A validated SVG will expose target IDs here.</p> : null}
            {tracks.map((track, trackIndex) => {
              const target = sourceInspection?.targets.find((item) => item.id === track.targetId);
              return (
                <article className={styles.track} key={track.id}>
                  <div className={styles.trackHeader}>
                    <div><small>TRACK {String(trackIndex + 1).padStart(2, "0")}</small><strong>#{track.targetId || "unassigned"}</strong></div>
                    <button type="button" onClick={() => removeTrack(track.id)} aria-label={`Remove track ${trackIndex + 1}`}>Remove</button>
                  </div>
                  <div className={styles.trackControls}>
                    <label>SVG target
                      <select value={track.targetId} onChange={(event) => updateTrack(track.id, (current) => Object.freeze({ ...current, targetId: event.target.value }))}>
                        {(sourceInspection?.targets ?? []).map((item) => (
                          <option key={item.id} value={item.id} disabled={item.id !== track.targetId && usedTargets.has(item.id)}>
                            #{item.id} · &lt;{item.tag}&gt;{item.hasBaseTransform ? " · base transform" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>Preset
                      <select value={track.preset} onChange={(event) => updateTrack(track.id, (current) => applyPreset(current, event.target.value as MotionPreset))}>
                        {MOTION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                      </select>
                    </label>
                    <label>Easing
                      <select value={track.easing} onChange={(event) => updateTrack(track.id, (current) => Object.freeze({ ...current, easing: event.target.value as TrackDraft["easing"] }))}>
                        {EASINGS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label>Transform box
                      <select value={track.transformBox} onChange={(event) => updateTrack(track.id, (current) => Object.freeze({ ...current, transformBox: event.target.value as TrackDraft["transformBox"] }))}>
                        <option value="fill-box">fill-box</option>
                        <option value="view-box">view-box</option>
                      </select>
                    </label>
                    <label>Origin X, %
                      <input type="number" min="-1000" max="1000" value={track.originXPercent} onChange={(event) => updateTrack(track.id, (current) => Object.freeze({ ...current, originXPercent: Number(event.target.value) }))} />
                    </label>
                    <label>Origin Y, %
                      <input type="number" min="-1000" max="1000" value={track.originYPercent} onChange={(event) => updateTrack(track.id, (current) => Object.freeze({ ...current, originYPercent: Number(event.target.value) }))} />
                    </label>
                  </div>
                  {target?.hasBaseTransform ? <p className={styles.trackNotice}>This target has a base transform. Keep transform values unchanged and animate opacity only, or wrap it in a new group.</p> : null}
                  <div className={styles.frames}>
                    <div className={styles.frameHead}>
                      <span>Offset</span><span>Opacity</span><span>X</span><span>Y</span><span>Scale</span><span>Rotate</span><span />
                    </div>
                    {track.keyframes.map((item, frameIndex) => (
                      <div className={styles.frameRow} key={item.id}>
                        <input aria-label={`Track ${trackIndex + 1} frame ${frameIndex + 1} offset`} type="number" min="0" max="1" step="0.01" value={item.offset} disabled={frameIndex === 0 || frameIndex === track.keyframes.length - 1} onChange={(event) => updateFrame(track.id, item.id, { offset: Number(event.target.value) })} />
                        <input aria-label="Opacity" type="number" min="0" max="1" step="0.01" value={item.opacity} onChange={(event) => updateFrame(track.id, item.id, { opacity: Number(event.target.value) })} />
                        <input aria-label="Translate X" type="number" step="0.5" value={item.translateX} onChange={(event) => updateFrame(track.id, item.id, { translateX: Number(event.target.value) })} />
                        <input aria-label="Translate Y" type="number" step="0.5" value={item.translateY} onChange={(event) => updateFrame(track.id, item.id, { translateY: Number(event.target.value) })} />
                        <input aria-label="Scale" type="number" min="0.001" step="0.01" value={item.scale} onChange={(event) => updateFrame(track.id, item.id, { scale: Number(event.target.value) })} />
                        <input aria-label="Rotation degrees" type="number" step="0.5" value={item.rotateDeg} onChange={(event) => updateFrame(track.id, item.id, { rotateDeg: Number(event.target.value) })} />
                        <button type="button" disabled={frameIndex === 0 || frameIndex === track.keyframes.length - 1} onClick={() => removeKeyframe(track.id, item.id)}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className={styles.trackFooter}>
                    <button type="button" className={styles.ghostButton} onClick={() => addKeyframe(track.id)}>Add midpoint</button>
                    <span>{track.keyframes.length} keyframes · {MOTION_PRESETS.find((preset) => preset.id === track.preset)?.description}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div><small>04 · Generate</small><h2>Create and verify output</h2></div>
            <span className={planState.plan ? styles.ready : styles.review}>{planState.plan ? "plan valid" : "review plan"}</span>
          </div>
          <label className={styles.tokenField}>API token <span>only required when the deployed API is protected</span>
            <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Kept in this browser tab only" />
          </label>
          <div className={styles.generateRow}>
            <button className={styles.primaryButton} type="submit" disabled={!sourceFile || !planState.plan || running}>{running ? "Generating and verifying…" : "Create animated SVG"}</button>
            {planUrl ? <a className={styles.downloadButton} href={planUrl} download={`${baseName}.motion.json`}>Download plan</a> : null}
          </div>
          {planState.error ? <p className={styles.inlineError}>{planState.error}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      </form>

      <aside className={styles.review}>
        <div className={styles.reviewHeader}>
          <div><small>LIVE REVIEW</small><h2>Source against directed motion</h2></div>
          {result ? <button type="button" onClick={() => setReplayRevision((value) => value + 1)}>Replay</button> : null}
        </div>
        <div className={styles.previewGrid}>
          <figure>
            <figcaption><span>Static source</span>{sourceFile ? readableBytes(sourceFile.size) : "waiting"}</figcaption>
            <div className={styles.canvas}>{sourceUrl ? <img src={sourceUrl} alt="Static SVG source preview" /> : <p>Select an ID-structured SVG.</p>}</div>
          </figure>
          <figure>
            <figcaption><span>Animated output</span>{result ? readableBytes(result.response.evidence.output.bytes) : "not generated"}</figcaption>
            <div className={styles.canvas}>{animatedUrl ? <img src={animatedUrl} alt="Generated animated SVG preview" /> : <p>The verified animated SVG will appear here.</p>}</div>
          </figure>
        </div>
        {prefersReducedMotion ? <p className={styles.reducedNotice}>This browser currently prefers reduced motion, so the output preview displays the selected fallback state.</p> : null}
        {result ? (
          <section className={styles.evidence}>
            <div className={styles.evidenceHeading}>
              <div>
                <small>JOB {result.response.id}</small>
                <strong>{resultStale ? "Plan changed after this build" : "Browser verification passed"}</strong>
                <span>{result.response.evidence.motion.trackCount} tracks · {result.response.evidence.motion.keyframeCount} keyframes · human review required</span>
              </div>
              <span className={resultStale ? styles.staleBadge : styles.verifiedBadge}>{resultStale ? "stale" : "verified"}</span>
            </div>
            <dl className={styles.metrics}>
              <div><dt>Motion ID</dt><dd title={result.response.evidence.motion.id}>{shortHash(result.response.evidence.motion.id)}</dd></div>
              <div><dt>Duration</dt><dd>{result.response.evidence.motion.durationMs} ms</dd></div>
              <div><dt>Targets</dt><dd>{result.response.evidence.motion.targets.length}</dd></div>
              <div><dt>Reduced motion</dt><dd>{result.response.evidence.motion.reducedMotion}</dd></div>
              <div><dt>Output SHA-256</dt><dd title={result.response.evidence.output.sha256}>{shortHash(result.response.evidence.output.sha256)}</dd></div>
              <div><dt>Verified</dt><dd>{new Date(result.verifiedAt).toLocaleTimeString()}</dd></div>
            </dl>
            <div className={styles.downloads}>
              {animatedUrl ? <a href={animatedUrl} download={`${baseName}.animated.svg`}>Download animated SVG</a> : null}
              {planUrl ? <a href={planUrl} download={`${baseName}.motion.json`}>Download motion plan</a> : null}
              {evidenceUrl ? <a href={evidenceUrl} download={`${baseName}.motion.evidence.json`}>Download evidence</a> : null}
            </div>
            {result.response.evidence.warnings.length > 0 ? (
              <ul className={styles.warnings}>
                {result.response.evidence.warnings.map((warning) => <li key={`${warning.code}-${warning.message}`}><b>{warning.code}</b><span>{warning.message}</span></li>)}
              </ul>
            ) : null}
          </section>
        ) : (
          <section className={styles.evidenceEmpty}>
            <strong>No generated revision yet</strong>
            <p>Builds are verified against source and output SHA-256, motion identity, style identity, target order, reduced-motion fallback and script-free evidence before display.</p>
          </section>
        )}
        <LottieReview
          sourceFile={sourceFile}
          sourceText={sourceText}
          plan={planState.plan}
          planJson={planJson}
          token={token}
          baseName={baseName}
          prefersReducedMotion={prefersReducedMotion}
        />
        <details className={styles.planPreview}>
          <summary>Inspect current motion JSON</summary>
          <pre>{planJson ?? "Complete a valid motion plan to inspect its normalized JSON."}</pre>
        </details>
      </aside>
    </section>
  );
}
