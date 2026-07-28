"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MotionPlan } from "./motion-model";
import LottiePreview from "./LottiePreview";
import styles from "./LottieReview.module.css";

const DEFAULT_FRAME_RATE = 60;
const DEFAULT_PRECISION = 4;
const MAX_LOTTIE_OUTPUT_BYTES = 20 * 1024 * 1024;

export type LottieReviewProps = Readonly<{
  sourceFile: File | null;
  sourceText: string;
  plan: MotionPlan | null;
  planJson: string | null;
  token: string;
  baseName: string;
  prefersReducedMotion: boolean;
}>;

type LottieFinding = Readonly<{
  code: string;
  severity: string;
  message: string;
  layerName?: string;
}>;

type LottieInspection = Readonly<{
  valid: boolean;
  contractVersion: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  inPoint: number | null;
  outPoint: number | null;
  layerCount: number;
  shapeLayerCount: number;
  pathShapeCount: number;
  fillShapeCount: number;
  strokeShapeCount: number;
  animatedPropertyCount: number;
  expressionCount: number;
  assetCount: number;
  imageLayerCount: number;
  textLayerCount: number;
  precompositionLayerCount: number;
  findings: readonly LottieFinding[];
}>;

type LottieApiResponse = Readonly<{
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
  lottie: Readonly<{
    mimeType: "video/lottie+json";
    encoding: "utf8-json";
    data: string;
  }>;
  inspection: LottieInspection;
  evidence: Readonly<{
    contractVersion: "1.0";
    source: Readonly<{
      bytes: number;
      sha256: string;
      viewBox: readonly [number, number, number, number];
      renderUnitCount: number;
      pathElementCount: number;
    }>;
    motion: Readonly<{
      normalized: MotionPlan;
      animatedTargetCount: number;
      staticLayerCount: number;
    }>;
    output: Readonly<{
      mimeType: "video/lottie+json";
      extension: ".json";
      bytes: number;
      sha256: string;
      width: number;
      height: number;
      frameRate: number;
      durationFrames: number;
      layerCount: number;
      pathShapeCount: number;
    }>;
    compatibility: Readonly<{
      structuralInspection: "passed";
      playerRenderValidation: "not-yet-performed";
      dotLottiePackaging: "not-yet-available";
    }>;
    approval: "review-required";
    warnings: readonly LottieFinding[];
  }>;
}>;

type VerifiedLottieResult = Readonly<{
  response: LottieApiResponse;
  submittedSource: File;
  submittedPlanJson: string;
  frameRate: number;
  precision: number;
  verifiedAt: string;
}>;

type LottieDocument = Readonly<{
  fr?: number;
  ip?: number;
  op?: number;
  w?: number;
  h?: number;
  assets?: readonly unknown[];
  layers?: readonly unknown[];
  meta?: Readonly<{
    contractVersion?: string;
    reviewRequired?: boolean;
  }>;
}>;

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
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify Lottie SHA-256 evidence.");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function targetIds(plan: MotionPlan): readonly string[] {
  return plan.tracks.map((track) => track.targetId);
}

function planCompatibility(plan: MotionPlan | null): readonly string[] {
  if (!plan) return [];
  const issues: string[] = [];
  if (plan.iterations !== 1) {
    issues.push("Lottie v1 exports exactly one playback cycle. Set iterations to once.");
  }
  if (plan.direction !== "normal") {
    issues.push("Lottie v1 requires normal playback direction.");
  }
  if (plan.fillMode !== "forwards" && plan.fillMode !== "both") {
    issues.push("Lottie v1 requires forwards or both fill mode.");
  }
  return Object.freeze(issues);
}

async function verifyLottieResponse(
  response: LottieApiResponse,
  sourceText: string,
  submittedPlan: MotionPlan,
): Promise<void> {
  if (response.status !== "complete") {
    throw new Error("The Lottie API did not report a complete synchronous result.");
  }
  if (
    response.approval !== "review-required" ||
    response.evidence.approval !== "review-required"
  ) {
    throw new Error("The Lottie API returned an unsupported production approval state.");
  }
  if (
    response.evidence.contractVersion !== "1.0" ||
    response.inspection.contractVersion !== "1.0"
  ) {
    throw new Error("The Lottie response uses an unsupported contract version.");
  }
  if (!response.inspection.valid) {
    throw new Error("The generated Lottie JSON failed structural inspection.");
  }
  if (
    response.inspection.expressionCount !== 0 ||
    response.inspection.assetCount !== 0 ||
    response.inspection.imageLayerCount !== 0 ||
    response.inspection.textLayerCount !== 0 ||
    response.inspection.precompositionLayerCount !== 0
  ) {
    throw new Error("The Lottie response escaped the governed shape-layer subset.");
  }
  if (
    response.evidence.compatibility.structuralInspection !== "passed" ||
    response.evidence.compatibility.playerRenderValidation !== "not-yet-performed" ||
    response.evidence.compatibility.dotLottiePackaging !== "not-yet-available"
  ) {
    throw new Error("The Lottie compatibility evidence is inconsistent.");
  }
  if (
    response.lottie.mimeType !== "video/lottie+json" ||
    response.lottie.encoding !== "utf8-json" ||
    response.evidence.output.mimeType !== "video/lottie+json"
  ) {
    throw new Error("The Lottie response uses an unsupported transport contract.");
  }

  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(sourceText).byteLength;
  const outputBytes = encoder.encode(response.lottie.data).byteLength;
  if (
    sourceBytes !== response.source.bytes ||
    sourceBytes !== response.evidence.source.bytes
  ) {
    throw new Error("The source byte evidence does not match the selected SVG.");
  }
  if (
    outputBytes !== response.evidence.output.bytes ||
    outputBytes > MAX_LOTTIE_OUTPUT_BYTES
  ) {
    throw new Error("The Lottie output byte evidence is invalid.");
  }

  const [sourceHash, outputHash] = await Promise.all([
    sha256(sourceText),
    sha256(response.lottie.data),
  ]);
  if (
    sourceHash !== response.source.sha256 ||
    sourceHash !== response.evidence.source.sha256
  ) {
    throw new Error("The source SVG failed browser SHA-256 verification.");
  }
  if (outputHash !== response.evidence.output.sha256) {
    throw new Error("The Lottie JSON failed browser SHA-256 verification.");
  }

  let document: LottieDocument;
  try {
    document = JSON.parse(response.lottie.data) as LottieDocument;
  } catch {
    throw new Error("The returned Lottie body is not valid JSON.");
  }
  if (
    document.meta?.contractVersion !== "1.0" ||
    document.meta.reviewRequired !== true ||
    !Array.isArray(document.layers) ||
    document.layers.length < 1 ||
    !Array.isArray(document.assets) ||
    document.assets.length !== 0
  ) {
    throw new Error("The parsed Lottie document is missing governed metadata or layers.");
  }
  if (
    document.w !== response.evidence.output.width ||
    document.h !== response.evidence.output.height ||
    document.fr !== response.evidence.output.frameRate ||
    document.op !== response.evidence.output.durationFrames ||
    document.layers.length !== response.evidence.output.layerCount ||
    response.inspection.layerCount !== response.evidence.output.layerCount ||
    response.inspection.pathShapeCount !== response.evidence.output.pathShapeCount
  ) {
    throw new Error("The parsed Lottie document does not match its retained evidence.");
  }

  const submittedTargets = targetIds(submittedPlan);
  const responseTargets = targetIds(response.motionPlan.normalized);
  const evidenceTargets = targetIds(response.evidence.motion.normalized);
  if (
    JSON.stringify(submittedTargets) !== JSON.stringify(responseTargets) ||
    JSON.stringify(responseTargets) !== JSON.stringify(evidenceTargets)
  ) {
    throw new Error("The Lottie targets do not match the submitted motion plan.");
  }
  if (
    JSON.stringify(response.motionPlan.normalized) !==
    JSON.stringify(response.evidence.motion.normalized)
  ) {
    throw new Error("The normalized motion plan differs across Lottie evidence fields.");
  }
}

function evidenceDocument(result: VerifiedLottieResult): string {
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
      parsedJson: true,
      structuralInspection: true,
      previewSurface: "@lottiefiles/dotlottie-react",
      playerRenderValidation: false,
      dotLottiePackaging: false,
    },
  }, null, 2);
}

export default function LottieReview({
  sourceFile,
  sourceText,
  plan,
  planJson,
  token,
  baseName,
  prefersReducedMotion,
}: LottieReviewProps) {
  const [frameRate, setFrameRate] = useState(DEFAULT_FRAME_RATE);
  const [precision, setPrecision] = useState(DEFAULT_PRECISION);
  const [loopPreview, setLoopPreview] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifiedLottieResult | null>(null);
  const [replayRevision, setReplayRevision] = useState(0);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [sourceFile]);

  const compatibilityIssues = useMemo(
    () => planCompatibility(plan),
    [plan],
  );
  const stale = Boolean(
    result &&
    (
      result.submittedSource !== sourceFile ||
      result.submittedPlanJson !== planJson ||
      result.frameRate !== frameRate ||
      result.precision !== precision
    ),
  );

  const lottieBlob = useMemo(
    () => result
      ? new Blob([result.response.lottie.data], { type: "video/lottie+json" })
      : null,
    [result],
  );
  const lottieUrl = useObjectUrl(lottieBlob);
  const evidenceSource = result ? `${evidenceDocument(result)}\n` : null;
  const evidenceBlob = useMemo(
    () => evidenceSource
      ? new Blob([evidenceSource], { type: "application/json" })
      : null,
    [evidenceSource],
  );
  const evidenceUrl = useObjectUrl(evidenceBlob);

  async function generate(): Promise<void> {
    if (!sourceFile || !sourceText || !plan || !planJson || running) {
      setError("Select a governed SVG and complete a valid motion plan first.");
      return;
    }
    if (compatibilityIssues.length > 0) {
      setError(compatibilityIssues.join(" "));
      return;
    }
    if (
      !Number.isSafeInteger(frameRate) ||
      frameRate < 1 ||
      frameRate > 120 ||
      !Number.isSafeInteger(precision) ||
      precision < 0 ||
      precision > 6
    ) {
      setError("Frame rate must be 1 to 120 and precision must be 0 to 6.");
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", sourceFile);
      form.set("motion", planJson);
      form.set("format", "json");
      form.set("frameRate", String(frameRate));
      form.set("precision", String(precision));
      form.set("name", plan.name);
      const response = await fetch("/api/v1/motion/lottie", {
        method: "POST",
        headers: token.trim()
          ? { authorization: `Bearer ${token.trim()}` }
          : undefined,
        body: form,
      });
      const payload = await response.json() as LottieApiResponse & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ||
          payload.error ||
          `Lottie generation failed with HTTP ${response.status}.`,
        );
      }
      await verifyLottieResponse(payload, sourceText, plan);
      setResult(Object.freeze({
        response: payload,
        submittedSource: sourceFile,
        submittedPlanJson: planJson,
        frameRate,
        precision,
        verifiedAt: new Date().toISOString(),
      }));
      setReplayRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={styles.lottiePanel} aria-label="Governed Lottie JSON review" aria-busy={running}>
      <div className={styles.lottieHeader}>
        <div>
          <small>LOTTIE JSON</small>
          <strong>Translate the same plan for player delivery</strong>
          <span>Path-based shape layers only · structural evidence retained</span>
        </div>
        <span className={stale ? styles.staleBadge : result ? styles.verifiedBadge : styles.contract}>
          {stale ? "stale" : result ? "verified JSON" : "contract 1.0"}
        </span>
      </div>

      <div className={styles.lottieControls}>
        <label>Frame rate
          <input
            type="number"
            min="1"
            max="120"
            value={frameRate}
            onChange={(event) => {
              setError(null);
              setFrameRate(Number(event.target.value));
            }}
          />
        </label>
        <label>Precision
          <input
            type="number"
            min="0"
            max="6"
            value={precision}
            onChange={(event) => {
              setError(null);
              setPrecision(Number(event.target.value));
            }}
          />
        </label>
        <label className={styles.lottieToggle}>
          <input
            type="checkbox"
            checked={loopPreview}
            onChange={(event) => setLoopPreview(event.target.checked)}
          />
          <span>Loop local preview</span>
        </label>
      </div>

      {compatibilityIssues.length > 0 ? (
        <ul className={styles.lottieCompatibility}>
          {compatibilityIssues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : (
        <p className={styles.lottieSubset}>Playback is compatible. The API will still verify path-only SVG geometry, paint, transforms and target structure.</p>
      )}

      <div className={styles.lottieActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={
            !sourceFile ||
            !plan ||
            !planJson ||
            running ||
            compatibilityIssues.length > 0
          }
          onClick={() => void generate()}
        >
          {running ? "Generating and verifying Lottie…" : "Create Lottie JSON"}
        </button>
        {result && !prefersReducedMotion ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setReplayRevision((value) => value + 1)}
          >
            Replay player preview
          </button>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <figure className={styles.lottiePreview}>
        <figcaption>
          <span>Official player preview</span>
          {result ? `${result.response.evidence.output.width} × ${result.response.evidence.output.height}` : "not generated"}
        </figcaption>
        <div className={styles.lottieCanvas}>
          {result ? (
            <LottiePreview
              data={result.response.lottie.data}
              autoplay={!prefersReducedMotion}
              loop={!prefersReducedMotion && loopPreview}
              revision={replayRevision}
            />
          ) : (
            <p>Verified Lottie JSON will be passed to the isolated browser player here.</p>
          )}
        </div>
      </figure>

      <p className={styles.lottieNotice}>
        This is a delivery-context preview, not approval. The JSON hash and structure are verified, but independent source-to-player render validation has not been performed.
      </p>
      {prefersReducedMotion ? (
        <p className={styles.reducedNotice}>This browser prefers reduced motion. The Lottie player is loaded without autoplay or looping.</p>
      ) : null}

      {result ? (
        <div className={styles.lottieEvidence}>
          <dl className={styles.metrics}>
            <div><dt>Layers</dt><dd>{result.response.evidence.output.layerCount}</dd></div>
            <div><dt>Paths</dt><dd>{result.response.evidence.output.pathShapeCount}</dd></div>
            <div><dt>Duration</dt><dd>{result.response.evidence.output.durationFrames} frames</dd></div>
            <div><dt>Output</dt><dd>{readableBytes(result.response.evidence.output.bytes)}</dd></div>
            <div><dt>SHA-256</dt><dd title={result.response.evidence.output.sha256}>{shortHash(result.response.evidence.output.sha256)}</dd></div>
            <div><dt>Player validation</dt><dd>not performed</dd></div>
          </dl>
          <div className={styles.downloads}>
            {lottieUrl ? <a href={lottieUrl} download={`${baseName}.lottie.json`}>Download Lottie JSON</a> : null}
            {evidenceUrl ? <a href={evidenceUrl} download={`${baseName}.lottie.evidence.json`}>Download Lottie evidence</a> : null}
          </div>
          {result.response.evidence.warnings.length > 0 ? (
            <ul className={styles.warnings}>
              {result.response.evidence.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>
                  <b>{warning.code}</b>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
