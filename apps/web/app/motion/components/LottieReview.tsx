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
const MAX_DOTLOTTIE_ARCHIVE_BYTES = 25 * 1024 * 1024;
const PORTABLE_ANIMATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

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

type LottieEvidence = Readonly<{
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

type SourceDescriptor = Readonly<{
  name: string;
  declaredType: string | null;
  bytes: number;
  sha256: string;
}>;

type MotionPlanDescriptor = Readonly<{
  mode: "inline" | "file";
  name: string | null;
  declaredType: string | null;
  bytes: number;
  normalized: MotionPlan;
}>;

type LottieApiResponse = Readonly<{
  id: string;
  status: "complete";
  approval: "review-required";
  source: SourceDescriptor;
  motionPlan: MotionPlanDescriptor;
  lottie: Readonly<{
    mimeType: "video/lottie+json";
    encoding: "utf8-json";
    data: string;
  }>;
  inspection: LottieInspection;
  evidence: LottieEvidence;
}>;

type DotLottieFinding = Readonly<{
  code: string;
  severity: string;
  message: string;
  entryName?: string;
}>;

type DotLottieManifest = Readonly<{
  version: "2";
  generator: string;
  initial: Readonly<{ animation: string }>;
  animations: readonly Readonly<{ id: string }>[];
}>;

type DotLottieEntryInspection = Readonly<{
  name: string;
  compression: "deflate" | "store";
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: number;
  deterministicTimestamp: boolean;
}>;

type DotLottieInspection = Readonly<{
  valid: boolean;
  contractVersion: "1.0";
  manifestVersion: string | null;
  generator: string | null;
  initialAnimationId: string | null;
  animationIds: readonly string[];
  archiveBytes: number;
  archiveSha256: string;
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  entries: readonly DotLottieEntryInspection[];
  embeddedLottie: LottieInspection | null;
  findings: readonly DotLottieFinding[];
}>;

type DotLottieEvidence = Readonly<{
  contractVersion: "1.0";
  source: Readonly<{
    mimeType: "video/lottie+json";
    bytes: number;
    sha256: string;
    embeddedBytes: number;
    embeddedSha256: string;
    inspection: LottieInspection;
  }>;
  manifest: DotLottieManifest;
  output: Readonly<{
    mimeType: "application/zip+dotlottie";
    extension: ".lottie";
    bytes: number;
    sha256: string;
    entryCount: number;
    totalCompressedBytes: number;
    totalUncompressedBytes: number;
    entryOrder: readonly ["manifest.json", string];
  }>;
  archive: Readonly<{
    format: "zip";
    compression: "deflate";
    manifestVersion: "2";
    deterministic: true;
    fixedTimestamp: "1980-01-01 00:00:00";
    themes: false;
    stateMachines: false;
    images: false;
    fonts: false;
    audio: false;
  }>;
  compatibility: Readonly<{
    archiveInspection: "passed";
    embeddedLottieInspection: "passed";
    playerRenderValidation: "not-yet-performed";
    browserArchiveLoadValidation: "not-yet-performed";
  }>;
  approval: "review-required";
  warnings: readonly DotLottieFinding[];
}>;

type DotLottieApiResponse = Readonly<{
  id: string;
  status: "complete";
  approval: "review-required";
  source: SourceDescriptor;
  motionPlan: MotionPlanDescriptor;
  lottie: Readonly<{
    inspection: LottieInspection;
    evidence: LottieEvidence;
  }>;
  dotLottie: Readonly<{
    mimeType: "application/zip+dotlottie";
    encoding: "base64";
    data: string;
    manifest: DotLottieManifest;
    inspection: DotLottieInspection;
    evidence: DotLottieEvidence;
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

type VerifiedDotLottieResult = Readonly<{
  response: DotLottieApiResponse;
  archiveBytes: Uint8Array;
  submittedSource: File;
  submittedPlanJson: string;
  frameRate: number;
  precision: number;
  animationId: string;
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

type PreviewMode = "json" | "archive";
type ArchiveLoadState = "not-requested" | "loading" | "passed" | "failed";

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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify SHA-256 evidence.");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64Archive(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  if (
    compact.length === 0 ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new Error("The dotLottie response is not valid base64 transport.");
  }
  let binary: string;
  try {
    binary = globalThis.atob(compact);
  } catch {
    throw new Error("The dotLottie response could not be decoded from base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function portableAnimationId(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return PORTABLE_ANIMATION_ID.test(normalized)
    ? normalized
    : "main-animation";
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

function assertMatchingPlans(
  submittedPlan: MotionPlan,
  responsePlan: MotionPlan,
  evidencePlan: MotionPlan,
): void {
  const submittedTargets = targetIds(submittedPlan);
  const responseTargets = targetIds(responsePlan);
  const evidenceTargets = targetIds(evidencePlan);
  if (
    JSON.stringify(submittedTargets) !== JSON.stringify(responseTargets) ||
    JSON.stringify(responseTargets) !== JSON.stringify(evidenceTargets)
  ) {
    throw new Error("The Lottie targets do not match the submitted motion plan.");
  }
  if (JSON.stringify(responsePlan) !== JSON.stringify(evidencePlan)) {
    throw new Error("The normalized motion plan differs across evidence fields.");
  }
}

function assertGovernedLottieInspection(inspection: LottieInspection): void {
  if (!inspection.valid || inspection.contractVersion !== "1.0") {
    throw new Error("The generated Lottie JSON failed its governed structural inspection.");
  }
  if (
    inspection.expressionCount !== 0 ||
    inspection.assetCount !== 0 ||
    inspection.imageLayerCount !== 0 ||
    inspection.textLayerCount !== 0 ||
    inspection.precompositionLayerCount !== 0
  ) {
    throw new Error("The Lottie response escaped the governed shape-layer subset.");
  }
}

function parseAndVerifyLottieDocument(
  source: string,
  inspection: LottieInspection,
  evidence: LottieEvidence,
): void {
  let document: LottieDocument;
  try {
    document = JSON.parse(source) as LottieDocument;
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
    document.w !== evidence.output.width ||
    document.h !== evidence.output.height ||
    document.fr !== evidence.output.frameRate ||
    document.op !== evidence.output.durationFrames ||
    document.layers.length !== evidence.output.layerCount ||
    inspection.layerCount !== evidence.output.layerCount ||
    inspection.pathShapeCount !== evidence.output.pathShapeCount
  ) {
    throw new Error("The parsed Lottie document does not match its retained evidence.");
  }
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
  assertGovernedLottieInspection(response.inspection);
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
    sha256Text(sourceText),
    sha256Text(response.lottie.data),
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

  parseAndVerifyLottieDocument(
    response.lottie.data,
    response.inspection,
    response.evidence,
  );
  assertMatchingPlans(
    submittedPlan,
    response.motionPlan.normalized,
    response.evidence.motion.normalized,
  );
}

async function verifyDotLottieResponse(
  response: DotLottieApiResponse,
  sourceText: string,
  submittedPlan: MotionPlan,
  requestedAnimationId: string,
): Promise<Uint8Array> {
  if (response.status !== "complete") {
    throw new Error("The dotLottie API did not report a complete synchronous result.");
  }
  if (
    response.approval !== "review-required" ||
    response.dotLottie.evidence.approval !== "review-required"
  ) {
    throw new Error("The dotLottie API returned an unsupported production approval state.");
  }
  if (
    response.dotLottie.mimeType !== "application/zip+dotlottie" ||
    response.dotLottie.encoding !== "base64"
  ) {
    throw new Error("The dotLottie response uses an unsupported transport contract.");
  }

  assertGovernedLottieInspection(response.lottie.inspection);
  if (
    response.lottie.evidence.compatibility.structuralInspection !== "passed" ||
    response.lottie.evidence.compatibility.playerRenderValidation !== "not-yet-performed"
  ) {
    throw new Error("The intermediate Lottie evidence is inconsistent.");
  }

  const archive = response.dotLottie;
  const { inspection, evidence, manifest } = archive;
  if (
    manifest.version !== "2" ||
    manifest.initial.animation !== requestedAnimationId ||
    manifest.animations.length !== 1 ||
    manifest.animations[0]?.id !== requestedAnimationId
  ) {
    throw new Error("The dotLottie manifest does not match the requested animation ID.");
  }
  if (
    !inspection.valid ||
    inspection.contractVersion !== "1.0" ||
    inspection.manifestVersion !== "2" ||
    inspection.initialAnimationId !== requestedAnimationId ||
    inspection.animationIds.length !== 1 ||
    inspection.animationIds[0] !== requestedAnimationId ||
    inspection.entryCount !== 2 ||
    !inspection.embeddedLottie?.valid
  ) {
    throw new Error("The dotLottie archive failed its returned structural inspection.");
  }
  if (
    evidence.contractVersion !== "1.0" ||
    evidence.manifest.version !== "2" ||
    evidence.manifest.initial.animation !== requestedAnimationId ||
    evidence.output.mimeType !== "application/zip+dotlottie" ||
    evidence.output.extension !== ".lottie" ||
    evidence.output.entryCount !== 2 ||
    evidence.output.entryOrder[0] !== "manifest.json" ||
    evidence.output.entryOrder[1] !== `a/${requestedAnimationId}.json` ||
    evidence.archive.format !== "zip" ||
    evidence.archive.compression !== "deflate" ||
    evidence.archive.manifestVersion !== "2" ||
    evidence.archive.deterministic !== true ||
    evidence.archive.fixedTimestamp !== "1980-01-01 00:00:00"
  ) {
    throw new Error("The dotLottie archive evidence is inconsistent.");
  }
  if (
    evidence.compatibility.archiveInspection !== "passed" ||
    evidence.compatibility.embeddedLottieInspection !== "passed" ||
    evidence.compatibility.playerRenderValidation !== "not-yet-performed" ||
    evidence.compatibility.browserArchiveLoadValidation !== "not-yet-performed"
  ) {
    throw new Error("The dotLottie compatibility evidence is inconsistent.");
  }

  const bytes = decodeBase64Archive(archive.data);
  if (
    bytes.byteLength !== evidence.output.bytes ||
    bytes.byteLength !== inspection.archiveBytes ||
    bytes.byteLength > MAX_DOTLOTTIE_ARCHIVE_BYTES
  ) {
    throw new Error("The dotLottie archive byte evidence is invalid.");
  }
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error("The dotLottie response is missing the ZIP local-file signature.");
  }

  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(sourceText).byteLength;
  const [sourceHash, archiveHash] = await Promise.all([
    sha256Text(sourceText),
    sha256Bytes(bytes),
  ]);
  if (
    sourceBytes !== response.source.bytes ||
    sourceBytes !== response.lottie.evidence.source.bytes ||
    sourceHash !== response.source.sha256 ||
    sourceHash !== response.lottie.evidence.source.sha256
  ) {
    throw new Error("The source SVG failed dotLottie browser verification.");
  }
  if (
    archiveHash !== evidence.output.sha256 ||
    archiveHash !== inspection.archiveSha256
  ) {
    throw new Error("The dotLottie archive failed browser SHA-256 verification.");
  }
  if (
    evidence.source.bytes !== response.lottie.evidence.output.bytes ||
    evidence.source.sha256 !== response.lottie.evidence.output.sha256
  ) {
    throw new Error("The packaged Lottie JSON does not match the intermediate output evidence.");
  }

  assertMatchingPlans(
    submittedPlan,
    response.motionPlan.normalized,
    response.lottie.evidence.motion.normalized,
  );
  return bytes;
}

function lottieEvidenceDocument(result: VerifiedLottieResult): string {
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

function dotLottieEvidenceDocument(
  result: VerifiedDotLottieResult,
  loadState: ArchiveLoadState,
  loadError: string | null,
): string {
  return JSON.stringify({
    id: result.response.id,
    status: result.response.status,
    approval: result.response.approval,
    source: result.response.source,
    motionPlan: result.response.motionPlan,
    lottie: result.response.lottie,
    dotLottie: {
      mimeType: result.response.dotLottie.mimeType,
      manifest: result.response.dotLottie.manifest,
      inspection: result.response.dotLottie.inspection,
      evidence: result.response.dotLottie.evidence,
    },
    browserVerification: {
      verifiedAt: result.verifiedAt,
      base64Decoded: true,
      zipSignature: true,
      archiveByteCount: true,
      archiveSha256: true,
      manifestIdentity: true,
      structuralInspection: true,
      previewSurface: "@lottiefiles/dotlottie-react",
      browserArchiveLoadValidation:
        loadState === "passed"
          ? "passed"
          : loadState === "failed"
            ? "failed"
            : "not-yet-performed",
      browserArchiveLoadError: loadError,
      playerRenderValidation: false,
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
  const [animationId, setAnimationId] = useState("main-animation");
  const [loopPreview, setLoopPreview] = useState(false);
  const [lottieRunning, setLottieRunning] = useState(false);
  const [archiveRunning, setArchiveRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lottieResult, setLottieResult] = useState<VerifiedLottieResult | null>(null);
  const [archiveResult, setArchiveResult] = useState<VerifiedDotLottieResult | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("json");
  const [replayRevision, setReplayRevision] = useState(0);
  const [archiveLoadState, setArchiveLoadState] = useState<ArchiveLoadState>("not-requested");
  const [archiveLoadError, setArchiveLoadError] = useState<string | null>(null);

  const running = lottieRunning || archiveRunning;

  useEffect(() => {
    setLottieResult(null);
    setArchiveResult(null);
    setArchiveLoadState("not-requested");
    setArchiveLoadError(null);
    setAnimationId(portableAnimationId(baseName));
    setError(null);
  }, [baseName, sourceFile]);

  const compatibilityIssues = useMemo(
    () => planCompatibility(plan),
    [plan],
  );
  const lottieStale = Boolean(
    lottieResult &&
    (
      lottieResult.submittedSource !== sourceFile ||
      lottieResult.submittedPlanJson !== planJson ||
      lottieResult.frameRate !== frameRate ||
      lottieResult.precision !== precision
    ),
  );
  const archiveStale = Boolean(
    archiveResult &&
    (
      archiveResult.submittedSource !== sourceFile ||
      archiveResult.submittedPlanJson !== planJson ||
      archiveResult.frameRate !== frameRate ||
      archiveResult.precision !== precision ||
      archiveResult.animationId !== animationId
    ),
  );

  const lottieBlob = useMemo(
    () => lottieResult
      ? new Blob([lottieResult.response.lottie.data], { type: "video/lottie+json" })
      : null,
    [lottieResult],
  );
  const lottieUrl = useObjectUrl(lottieBlob);
  const lottieEvidenceSource = lottieResult
    ? `${lottieEvidenceDocument(lottieResult)}\n`
    : null;
  const lottieEvidenceBlob = useMemo(
    () => lottieEvidenceSource
      ? new Blob([lottieEvidenceSource], { type: "application/json" })
      : null,
    [lottieEvidenceSource],
  );
  const lottieEvidenceUrl = useObjectUrl(lottieEvidenceBlob);

  const archiveBuffer = useMemo(
    () => archiveResult ? toArrayBuffer(archiveResult.archiveBytes) : null,
    [archiveResult],
  );
  const archiveBlob = useMemo(
    () => archiveBuffer
      ? new Blob([archiveBuffer], { type: "application/zip+dotlottie" })
      : null,
    [archiveBuffer],
  );
  const archiveUrl = useObjectUrl(archiveBlob);
  const archiveEvidenceSource = archiveResult
    ? `${dotLottieEvidenceDocument(
        archiveResult,
        archiveLoadState,
        archiveLoadError,
      )}\n`
    : null;
  const archiveEvidenceBlob = useMemo(
    () => archiveEvidenceSource
      ? new Blob([archiveEvidenceSource], { type: "application/json" })
      : null,
    [archiveEvidenceSource],
  );
  const archiveEvidenceUrl = useObjectUrl(archiveEvidenceBlob);

  function validateGenerationInputs(): void {
    if (!sourceFile || !sourceText || !plan || !planJson || running) {
      throw new Error("Select a governed SVG and complete a valid motion plan first.");
    }
    if (compatibilityIssues.length > 0) {
      throw new Error(compatibilityIssues.join(" "));
    }
    if (
      !Number.isSafeInteger(frameRate) ||
      frameRate < 1 ||
      frameRate > 120 ||
      !Number.isSafeInteger(precision) ||
      precision < 0 ||
      precision > 6
    ) {
      throw new Error("Frame rate must be 1 to 120 and precision must be 0 to 6.");
    }
  }

  function requestForm(includeAnimationId: boolean): FormData {
    if (!sourceFile || !plan || !planJson) {
      throw new Error("The source and normalized motion plan are required.");
    }
    const form = new FormData();
    form.set("file", sourceFile);
    form.set("motion", planJson);
    form.set("format", "json");
    form.set("frameRate", String(frameRate));
    form.set("precision", String(precision));
    form.set("name", plan.name);
    if (includeAnimationId) form.set("animationId", animationId);
    return form;
  }

  async function generateLottie(): Promise<void> {
    try {
      validateGenerationInputs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }

    setLottieRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/motion/lottie", {
        method: "POST",
        headers: token.trim()
          ? { authorization: `Bearer ${token.trim()}` }
          : undefined,
        body: requestForm(false),
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
      if (!plan || !planJson || !sourceFile) {
        throw new Error("The source or motion plan changed during Lottie generation.");
      }
      await verifyLottieResponse(payload, sourceText, plan);
      setLottieResult(Object.freeze({
        response: payload,
        submittedSource: sourceFile,
        submittedPlanJson: planJson,
        frameRate,
        precision,
        verifiedAt: new Date().toISOString(),
      }));
      setPreviewMode("json");
      setReplayRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLottieRunning(false);
    }
  }

  async function generateDotLottie(): Promise<void> {
    try {
      validateGenerationInputs();
      if (!PORTABLE_ANIMATION_ID.test(animationId)) {
        throw new Error("Animation ID must use 1 to 64 letters, numbers, underscores or hyphens, and must start with a letter or number.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }

    setArchiveRunning(true);
    setArchiveLoadState("not-requested");
    setArchiveLoadError(null);
    setError(null);
    try {
      const response = await fetch("/api/v1/motion/dotlottie", {
        method: "POST",
        headers: token.trim()
          ? { authorization: `Bearer ${token.trim()}` }
          : undefined,
        body: requestForm(true),
      });
      const payload = await response.json() as DotLottieApiResponse & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ||
          payload.error ||
          `dotLottie generation failed with HTTP ${response.status}.`,
        );
      }
      if (!plan || !planJson || !sourceFile) {
        throw new Error("The source or motion plan changed during dotLottie generation.");
      }
      const bytes = await verifyDotLottieResponse(
        payload,
        sourceText,
        plan,
        animationId,
      );
      setArchiveResult(Object.freeze({
        response: payload,
        archiveBytes: bytes,
        submittedSource: sourceFile,
        submittedPlanJson: planJson,
        frameRate,
        precision,
        animationId,
        verifiedAt: new Date().toISOString(),
      }));
      setArchiveLoadState("loading");
      setPreviewMode("archive");
      setReplayRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveRunning(false);
    }
  }

  function replay(): void {
    if (previewMode === "archive" && archiveResult) {
      setArchiveLoadState("loading");
      setArchiveLoadError(null);
    }
    setReplayRevision((value) => value + 1);
  }

  const activeStale = previewMode === "archive" ? archiveStale : lottieStale;
  const hasActiveResult = previewMode === "archive"
    ? Boolean(archiveResult)
    : Boolean(lottieResult);
  const statusLabel = activeStale
    ? "stale"
    : previewMode === "archive" && archiveResult
      ? archiveLoadState === "passed"
        ? "archive loaded"
        : archiveLoadState === "failed"
          ? "load failed"
          : "archive verified"
      : lottieResult
        ? "verified JSON"
        : "contract 1.0";

  return (
    <section className={styles.lottiePanel} aria-label="Governed Lottie and dotLottie review" aria-busy={running}>
      <div className={styles.lottieHeader}>
        <div>
          <small>LOTTIE DELIVERY</small>
          <strong>Translate the same plan for player and archive delivery</strong>
          <span>Path-based shape layers · deterministic manifest-v2 packaging · evidence retained</span>
        </div>
        <span className={activeStale ? styles.staleBadge : hasActiveResult ? styles.verifiedBadge : styles.contract}>
          {statusLabel}
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
        <label>Archive animation ID
          <input
            type="text"
            maxLength={64}
            value={animationId}
            onChange={(event) => {
              setError(null);
              setAnimationId(event.target.value);
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
        <p className={styles.lottieSubset}>Playback is compatible. The APIs will still verify path-only SVG geometry, paint, transforms, target structure, archive layout and hashes.</p>
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
          onClick={() => void generateLottie()}
        >
          {lottieRunning ? "Generating and verifying Lottie…" : "Create Lottie JSON"}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={
            !sourceFile ||
            !plan ||
            !planJson ||
            running ||
            compatibilityIssues.length > 0 ||
            !PORTABLE_ANIMATION_ID.test(animationId)
          }
          onClick={() => void generateDotLottie()}
        >
          {archiveRunning ? "Packaging and verifying archive…" : "Create dotLottie archive"}
        </button>
        {hasActiveResult && !prefersReducedMotion ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={replay}
          >
            Replay player preview
          </button>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {(lottieResult || archiveResult) ? (
        <div className={styles.previewSwitch} aria-label="Lottie preview source">
          <button
            type="button"
            className={previewMode === "json" ? styles.previewSwitchActive : ""}
            disabled={!lottieResult}
            onClick={() => setPreviewMode("json")}
          >
            Verified JSON
          </button>
          <button
            type="button"
            className={previewMode === "archive" ? styles.previewSwitchActive : ""}
            disabled={!archiveResult}
            onClick={() => setPreviewMode("archive")}
          >
            Verified .lottie archive
          </button>
        </div>
      ) : null}

      <figure className={styles.lottiePreview}>
        <figcaption>
          <span>Official player preview · {previewMode === "archive" ? "archive bytes" : "JSON"}</span>
          {previewMode === "archive" && archiveResult
            ? `${readableBytes(archiveResult.archiveBytes.byteLength)} · ${archiveLoadState}`
            : lottieResult
              ? `${lottieResult.response.evidence.output.width} × ${lottieResult.response.evidence.output.height}`
              : "not generated"}
        </figcaption>
        <div className={styles.lottieCanvas}>
          {previewMode === "archive" && archiveResult && archiveBuffer ? (
            <LottiePreview
              data={archiveBuffer}
              autoplay={!prefersReducedMotion}
              loop={!prefersReducedMotion && loopPreview}
              revision={replayRevision}
              ariaLabel="Generated dotLottie archive preview"
              onLoad={() => {
                setArchiveLoadState("passed");
                setArchiveLoadError(null);
              }}
              onLoadError={(message) => {
                setArchiveLoadState("failed");
                setArchiveLoadError(message);
              }}
            />
          ) : previewMode === "json" && lottieResult ? (
            <LottiePreview
              data={lottieResult.response.lottie.data}
              autoplay={!prefersReducedMotion}
              loop={!prefersReducedMotion && loopPreview}
              revision={replayRevision}
              ariaLabel="Generated Lottie JSON preview"
            />
          ) : (
            <p>Verified Lottie JSON or dotLottie bytes will be passed to the isolated browser player here.</p>
          )}
        </div>
      </figure>

      {previewMode === "archive" && archiveResult ? (
        <p className={
          archiveLoadState === "passed"
            ? styles.archivePassed
            : archiveLoadState === "failed"
              ? styles.archiveFailed
              : styles.archivePending
        }>
          {archiveLoadState === "passed"
            ? "Browser archive-load validation passed: the official player accepted the verified .lottie bytes. This does not establish source-to-player render equivalence."
            : archiveLoadState === "failed"
              ? `Browser archive-load validation failed: ${archiveLoadError ?? "the official player rejected the archive."}`
              : "The archive is byte-verified and structurally valid. Browser archive-load validation is waiting for the official player load event."}
        </p>
      ) : (
        <p className={styles.lottieNotice}>
          This is a delivery-context preview, not approval. The JSON hash and structure are verified, but independent source-to-player render validation has not been performed.
        </p>
      )}

      {prefersReducedMotion ? (
        <p className={styles.reducedNotice}>This browser prefers reduced motion. The player is loaded without autoplay or looping.</p>
      ) : null}

      {lottieResult ? (
        <div className={styles.lottieEvidence}>
          <div className={styles.evidenceLabel}>Lottie JSON evidence</div>
          <dl className={styles.metrics}>
            <div><dt>Layers</dt><dd>{lottieResult.response.evidence.output.layerCount}</dd></div>
            <div><dt>Paths</dt><dd>{lottieResult.response.evidence.output.pathShapeCount}</dd></div>
            <div><dt>Duration</dt><dd>{lottieResult.response.evidence.output.durationFrames} frames</dd></div>
            <div><dt>Output</dt><dd>{readableBytes(lottieResult.response.evidence.output.bytes)}</dd></div>
            <div><dt>SHA-256</dt><dd title={lottieResult.response.evidence.output.sha256}>{shortHash(lottieResult.response.evidence.output.sha256)}</dd></div>
            <div><dt>Player validation</dt><dd>not performed</dd></div>
          </dl>
          <div className={styles.downloads}>
            {lottieUrl ? <a href={lottieUrl} download={`${baseName}.lottie.json`}>Download Lottie JSON</a> : null}
            {lottieEvidenceUrl ? <a href={lottieEvidenceUrl} download={`${baseName}.lottie.evidence.json`}>Download Lottie evidence</a> : null}
          </div>
          {lottieResult.response.evidence.warnings.length > 0 ? (
            <ul className={styles.warnings}>
              {lottieResult.response.evidence.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>
                  <b>{warning.code}</b>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {archiveResult ? (
        <div className={styles.lottieEvidence}>
          <div className={styles.evidenceLabel}>dotLottie archive evidence</div>
          <dl className={styles.metrics}>
            <div><dt>Entries</dt><dd>{archiveResult.response.dotLottie.evidence.output.entryCount}</dd></div>
            <div><dt>Manifest</dt><dd>v{archiveResult.response.dotLottie.manifest.version}</dd></div>
            <div><dt>Animation ID</dt><dd title={archiveResult.animationId}>{archiveResult.animationId}</dd></div>
            <div><dt>Archive</dt><dd>{readableBytes(archiveResult.archiveBytes.byteLength)}</dd></div>
            <div><dt>SHA-256</dt><dd title={archiveResult.response.dotLottie.evidence.output.sha256}>{shortHash(archiveResult.response.dotLottie.evidence.output.sha256)}</dd></div>
            <div><dt>Browser archive load</dt><dd>{archiveLoadState}</dd></div>
          </dl>
          <div className={styles.downloads}>
            {archiveUrl ? <a href={archiveUrl} download={`${baseName}.lottie`}>Download dotLottie archive</a> : null}
            {archiveEvidenceUrl ? <a href={archiveEvidenceUrl} download={`${baseName}.dotlottie.evidence.json`}>Download dotLottie evidence</a> : null}
          </div>
          {archiveResult.response.dotLottie.evidence.warnings.length > 0 ? (
            <ul className={styles.warnings}>
              {archiveResult.response.dotLottie.evidence.warnings.map((warning) => (
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
