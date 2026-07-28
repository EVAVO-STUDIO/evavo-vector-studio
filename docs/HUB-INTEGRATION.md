# EVAVO hub integration contract

Vector Studio is designed as a federated EVAVO application rather than a public link card.

## Proposed registry metadata

- key: `vector-studio`
- label: `EVAVO Vector Studio`
- short label: `VS`
- module id: `vector-production-workspace`
- repository: `EVAVO-STUDIO/evavo-vector-studio`
- recommended host: `vector.evavo.com.au`
- launch strategy: `federated-candidate`
- signed launch: required
- initial status: `preview`

## Release boundary

Do not add Vector Studio to the released application allowlist in `next-website` until all of the following exist:

1. A production deployment and custom domain.
2. Shared signed-launch verification between the hub and Vector Studio.
3. Workspace and actor scope checks on every job and asset request.
4. Live owner and client smoke evidence.
5. Explicit storage, retention and deletion policy for uploaded artwork.
6. API and CLI authentication with revocable scoped credentials.

The hub card may be introduced as unavailable preview metadata before release, but it must not claim that tracing or motion execution is operational until worker-backed execution is verified.
