export type DifferenceArtifactVerificationCode =
  | "DIFFERENCE_TRANSPORT_UNSUPPORTED"
  | "DIFFERENCE_CANDIDATE_MISMATCH"
  | "DIFFERENCE_BASE64_INVALID"
  | "DIFFERENCE_BYTE_COUNT_MISMATCH"
  | "DIFFERENCE_PNG_INVALID"
  | "DIFFERENCE_DIMENSIONS_MISMATCH"
  | "DIFFERENCE_SHA256_INVALID"
  | "DIFFERENCE_CRYPTO_UNAVAILABLE";

export class DifferenceArtifactVerificationError extends Error {
  readonly code: DifferenceArtifactVerificationCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: DifferenceArtifactVerificationCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DifferenceArtifactVerificationError";
    this.code = code;
    this.details = details;
  }
}

export type DifferenceArtifactPayload = Readonly<{
  encoding: "base64";
  mimeType: "image/png";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  selectedCandidateId: string;
  data: string;
}>;

export type VerifiedDifferenceArtifact = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
  selectedCandidateId: string;
}>;

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10] as const);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function decodeBase64(value: string): Uint8Array {
  if (typeof globalThis.atob !== "function") {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_BASE64_INVALID",
      "This runtime cannot decode base64 difference artefacts.",
    );
  }
  let binary: string;
  try {
    binary = globalThis.atob(value.replace(/\s+/g, ""));
  } catch (error) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_BASE64_INVALID",
      "The difference artefact contains invalid base64 data.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function pngDimensions(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_PNG_INVALID",
      "The difference artefact is not a complete PNG stream.",
    );
  }
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_PNG_INVALID",
      "The difference PNG does not begin with an IHDR chunk.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Object.freeze({ width: view.getUint32(16, false), height: view.getUint32(20, false) });
}

export async function verifyDifferenceArtifactPayload(
  payload: DifferenceArtifactPayload,
  expectedCandidateId?: string,
  cryptoApi: Crypto | undefined = globalThis.crypto,
): Promise<VerifiedDifferenceArtifact> {
  if (payload.encoding !== "base64" || payload.mimeType !== "image/png") {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_TRANSPORT_UNSUPPORTED",
      "Only base64-encoded PNG difference artefacts are supported.",
      { encoding: payload.encoding, mimeType: payload.mimeType },
    );
  }
  if (expectedCandidateId && payload.selectedCandidateId !== expectedCandidateId) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_CANDIDATE_MISMATCH",
      "The difference artefact does not belong to the selected trace candidate.",
      { expectedCandidateId, selectedCandidateId: payload.selectedCandidateId },
    );
  }
  if (!Number.isSafeInteger(payload.bytes) || payload.bytes < 1) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_BYTE_COUNT_MISMATCH",
      "The declared difference artefact byte count is invalid.",
      { bytes: payload.bytes },
    );
  }
  if (!Number.isSafeInteger(payload.width) || payload.width < 1 || !Number.isSafeInteger(payload.height) || payload.height < 1) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_DIMENSIONS_MISMATCH",
      "The declared difference artefact dimensions are invalid.",
      { width: payload.width, height: payload.height },
    );
  }

  const bytes = decodeBase64(payload.data);
  if (bytes.byteLength !== payload.bytes) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_BYTE_COUNT_MISMATCH",
      "The decoded difference artefact byte count does not match its evidence.",
      { receivedBytes: bytes.byteLength, declaredBytes: payload.bytes },
    );
  }

  const dimensions = pngDimensions(bytes);
  if (dimensions.width !== payload.width || dimensions.height !== payload.height) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_DIMENSIONS_MISMATCH",
      "The PNG dimensions do not match the difference artefact evidence.",
      {
        receivedWidth: dimensions.width,
        receivedHeight: dimensions.height,
        declaredWidth: payload.width,
        declaredHeight: payload.height,
      },
    );
  }

  const expectedSha256 = payload.sha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(expectedSha256)) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_SHA256_INVALID",
      "The declared difference artefact SHA-256 is invalid.",
      { sha256: payload.sha256 },
    );
  }
  if (!cryptoApi?.subtle) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_CRYPTO_UNAVAILABLE",
      "This runtime cannot verify the difference artefact SHA-256.",
    );
  }
  const digestInput = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await cryptoApi.subtle.digest("SHA-256", digestInput.buffer),
  );
  const receivedSha256 = bytesToHex(digest);
  if (receivedSha256 !== expectedSha256) {
    throw new DifferenceArtifactVerificationError(
      "DIFFERENCE_SHA256_INVALID",
      "The difference artefact failed SHA-256 verification.",
      { receivedSha256, expectedSha256 },
    );
  }

  return Object.freeze({
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    sha256: receivedSha256,
    selectedCandidateId: payload.selectedCandidateId,
  });
}
