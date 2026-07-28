# Durable Batch Path Safety

The durable batch runner resolves every production path through one canonical execution root before an operation reads input bytes or declares output receipts.

This boundary prevents an apparently in-root path from escaping through `..`, an absolute path, an input symlink, an output-directory symlink or a case-insensitive path collision.

## Canonical root

`--root` must resolve through the operating system to an existing directory.

The runner retains the canonical real path in durable state. Reopening the same job through a different symlink alias resolves to the same canonical root. A missing root or non-directory root is rejected as `BATCH_ROOT_INVALID`.

## Inputs

Every input path:

1. resolves relative to the canonical root unless already absolute;
2. resolves through `realpath`;
3. must remain beneath the canonical root after symlink resolution;
4. must be a regular file.

Stable failures include:

```text
BATCH_PATH_INVALID
BATCH_PATH_OUTSIDE_ROOT
BATCH_INPUT_NOT_FOUND
BATCH_INPUT_NOT_FILE
```

An input symlink is accepted only when its final target remains inside the root. A symlink to any file outside the root is rejected before hashing or processing.

## Outputs

An output may be new or may already exist because a completed item is being checked for safe reuse.

For a new output path, the policy:

1. finds the nearest existing parent directory;
2. resolves that directory canonically;
3. reconstructs any missing child directories beneath the canonical ancestor;
4. confirms the final candidate remains beneath the root.

For an existing output path, the policy requires a regular file. The output itself may not be a symlink, including a symlink whose target is still inside the root.

A symlinked parent directory that resolves outside the root is rejected. A symlinked parent that resolves to a directory inside the root remains within the canonical boundary.

The path policy does not overwrite existing files. It permits an existing regular output to be resolved only so the durable runner can compare the retained byte count and SHA-256 receipt. A fresh execution still reaches the atomic new-file transaction, which rejects occupied destinations.

Stable output failures include:

```text
BATCH_PATH_OUTSIDE_ROOT
BATCH_OUTPUT_PARENT_INVALID
BATCH_PATH_COLLISION
```

## Collision policy

Canonical input and output paths are compared after path resolution. On Windows the comparison is case-insensitive.

A batch operation rejects:

- the same output declared twice;
- an output that resolves to an input;
- two different textual paths that resolve to the same canonical file;
- source replacement under another path spelling.

## Revision identity

The operation revision includes:

- operation name;
- canonical operation spec;
- input paths relative to the canonical root;
- exact input bytes.

This makes the same input file reached through a symlink alias resolve to one canonical file identity, while retaining the manifest spec as part of the revision.

Completed work is reused only when the current revision and every retained output receipt still verify.

## State paths

The default state directory is created beneath the canonical execution root:

```text
.evavo-vector-jobs/<job-id>/
```

A separately supplied `--state-root` is an operator-selected storage location. It is not interpreted as a production input or output root and should be placed on trusted local storage.

## Race boundary

The policy prevents ordinary symlink escapes at resolution time. It is not an operating-system sandbox against a hostile local account that can replace parent directories between resolution and atomic output commit.

Run Vector Studio under a trusted account and do not grant untrusted processes write access to the execution root while a batch is active.

A future hosted worker should isolate each job in its own container, VM or restricted filesystem namespace in addition to this application-level policy.
