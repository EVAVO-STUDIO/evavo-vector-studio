# EVAVO Vector Studio Worker Object Transfer

Worker object-transfer contract `1.0` moves immutable source and generated objects through separately authenticated binary routes without embedding file bodies in job records or JSON control responses.

The transfer surface is disabled by default. It becomes available only when the worker token and a deliberate object-store adapter are configured.

## Endpoints

```text
POST /api/v1/worker/objects
GET  /api/v1/worker/objects?key={objectKey}
```

Every request requires:

```http
Authorization: Bearer <VECTOR_WORKER_API_TOKEN>
```

The worker token is separate from `VECTOR_API_TOKEN` and must remain server-side.

## Fail-closed configuration

```text
VECTOR_OBJECT_STORE_MODE=disabled
VECTOR_OBJECT_STORE_PATH=/persistent/vector-objects
VECTOR_OBJECT_FILE_STORE_PERSISTENT=false
```

To enable the current file adapter in local or self-hosted development:

```text
VECTOR_OBJECT_STORE_MODE=file
```

Production file mode additionally requires:

```text
VECTOR_OBJECT_FILE_STORE_PERSISTENT=true
```

That flag is an operator acknowledgement. It does not prove that a filesystem is persistent. Do not enable it on an ephemeral serverless disk.

## Upload transaction

Uploads require:

```http
Content-Type: application/vnd.evavo.vector-object-transaction
```

The deterministic body format is:

```text
8-byte EVAVOOB1 signature
4-byte big-endian canonical-manifest length
canonical JSON manifest
ordered concatenated object bytes
```

Limits:

```text
Individual object          32 MiB
Encoded transaction        64 MiB
Objects per transaction    16
Manifest                   64 KiB
```

The canonical manifest retains:

```text
contractVersion
encoding
payloadBytes
objects[].objectKey
objects[].mimeType
objects[].bytes
objects[].sha256
```

The transaction ID is the SHA-256 of the complete encoded body.

### Upload response

A new atomic commit returns `201`. A complete retained content replay returns `200`.

```json
{
  "service": "evavo-vector-studio-worker-object-transfer",
  "contractVersion": "1.0",
  "transactionId": "64-lowercase-hex-characters",
  "bodySha256": "64-lowercase-hex-characters",
  "idempotentReplay": false,
  "mimeTypeVerification": "verified",
  "objects": [
    {
      "objectKey": "workspace/source/mark.png",
      "path": "object://workspace/source/mark.png",
      "mimeType": "image/png",
      "bytes": 12345,
      "sha256": "64-lowercase-hex-characters"
    }
  ],
  "existingObjectsOverwritten": false,
  "generatedBodiesInJson": false
}
```

The API never returns server filesystem paths.

## Replay and conflict policy

The coordinator checks retained immutable objects before writing:

- no retained keys: commit all objects atomically;
- all retained keys with the same byte count and SHA-256: return a replay;
- changed bytes under any key: reject the transaction;
- only some retained keys: reject the transaction;
- a concurrent exact commit race: re-inspect and return a replay;
- a concurrent different commit race: reject the transaction.

The current file object store does not persist original MIME metadata beside raw bytes. A replay from that adapter therefore reports:

```text
mimeTypeVerification: content-only
```

The object key, byte count and SHA-256 are still verified. A provider adapter with retained MIME metadata can report `verified`.

## Download

```http
GET /api/v1/worker/objects?key=workspace/source/mark.png
Authorization: Bearer <VECTOR_WORKER_API_TOKEN>
```

A successful response returns raw immutable bytes with:

```text
Content-Type: application/octet-stream
Content-Length
Content-Disposition
X-Vector-Worker-Protocol: 1.0
X-Vector-Object-Transfer-Contract: 1.0
X-Vector-Object-Key
X-Vector-Object-Bytes
X-Vector-Object-Sha256
X-Vector-Object-Stored-Mime
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

Clients must verify the returned key, byte count and SHA-256 before using the bytes. The download content type remains `application/octet-stream` because the current file adapter does not retain authoritative MIME metadata.

## Stable failures

```text
VECTOR_WORKER_API_NOT_CONFIGURED
VECTOR_WORKER_API_UNAUTHORISED
VECTOR_WORKER_OBJECT_STORE_NOT_CONFIGURED
VECTOR_WORKER_OBJECT_TRANSACTION_INVALID
VECTOR_WORKER_OBJECT_TRANSACTION_TOO_LARGE
VECTOR_WORKER_OBJECT_HASH_MISMATCH
VECTOR_WORKER_OBJECT_TRANSACTION_CONFLICT
VECTOR_WORKER_OBJECT_NOT_FOUND
VECTOR_WORKER_OBJECT_KEY_INVALID
VECTOR_WORKER_OBJECT_STORE_FAILED
```

Error details are filtered before leaving the server. Canonical filesystem roots, temporary paths and provider causes are not returned.

## Security and integrity boundary

The object-transfer API provides:

- worker-only bearer authentication;
- bounded binary bodies;
- canonical manifests;
- portable relative object keys;
- traversal and duplicate-key rejection;
- per-object and transaction SHA-256;
- atomic no-overwrite multi-object commits;
- exact-content replay;
- partial-revision rejection;
- raw binary download outside JSON;
- no-store and nosniff response headers.

It is an application boundary, not an operating-system sandbox. The file adapter assumes the operating-system account and mounted volume are trusted against continuous hostile replacement.

## Deployment boundary

This slice makes authenticated object upload and download available for a deliberately configured shared file store. It does not provide:

```text
provider-backed cloud object storage
presigned URLs
queue delivery
multi-region replication
managed worker autoscaling
workspace-scoped object authorization
malware scanning
lifecycle retention policies
remote execution approval
```

The HTTP-coordinated worker now supports `worker-api` object mode through the verified object client and replay-safe `HttpVectorObjectStore` adapter. Shared-volume `file` mode remains the default, while HTTP mode removes the shared-filesystem requirement when service discovery reports `objectTransferAvailable: true`.
