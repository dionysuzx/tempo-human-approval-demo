# Approve a PR with a signed message

Open [PR #1](https://github.com/dionysuzx/tempo-human-approval-demo/pull/1). Its automation posts an **Open the signing page** link. In Brave, review the prefilled message, sign with your passkey or Touch ID, copy the proof, and paste it as a new PR comment. A verified proof turns the required check green. You still choose when to merge.

The signing page currently runs on your Mac at **http://localhost:8787/**. Keep it running. This URL is not a public deployment. The page remains a generic text signer; this repository defines what a PR approval means.

## First time

Use **Set up signing** on that page. The repository owner must then pin the public signer fingerprint and origin in `approval/config.json` on trusted `main`. A key supplied by a PR comment is never automatically trusted. No GitHub App creation or native launcher is required for this flow.

Links expire after 15 minutes. Comment `/request-approval` for a fresh link. A changed head or base commit requires a new request. Paste the full copied JSON directly, or inside a fenced `json` block.

## Verification boundary

The workflow checks out only `main`, never the PR branch. It parses comment/event data without shell interpolation, requires a pre-enrolled public key and expected origin, verifies WebAuthn ES256 with user presence and verification, and compares the exact signed message with its stored repository ID, PR, head/base commits, action, random request ID, and expiry. Per-PR concurrency serializes changes. A successful check stores a consumed receipt; replay is rejected.

The required check is pinned to **GitHub Actions**. This blocks an ordinary token from satisfying it with a same-name status from another identity. **It does not distinguish this workflow from another workflow running as GitHub Actions.** Someone who can introduce a malicious workflow with check-writing permissions, modify trusted main, or change branch protection can bypass this demo. This assistant's administrator credentials are outside the protected agent boundary. For rigid enforcement, put the verifier in a separately administered service/App or require an independently controlled workflow policy.

Checks attach to commit SHAs, so reusing exactly the same SHA across multiple PRs is not a separate GitHub check boundary. Accepted approvals persist for that commit; the 15-minute expiry governs acceptance, not later merge time. Strict protection requires the PR branch to be current with main.

WebAuthn verifies user presence and verification, not that Touch ID specifically was used. Passkeys may sync; this flow has no hardware attestation and cannot promise a non-exportable Secure Enclave key. The site shows the actual authenticator choice.

## Implementation

- `.github/workflows/signed-approval.yml`: trusted workflow for PR events and proof comments.
- `approval/policy.mjs`: exact action, challenge, signer and freshness validation.
- `approval/run.mjs`: GitHub check/comment integration and durable receipt updates.
- `approval/webauthn.mjs`: vendored dependency-free verifier from the generic signer.
- `approval/config.json`: trusted owner-managed public signer configuration.

Run `npm test` using Node 24+. Tests use actual cryptographic signatures; network effects are faked at the GitHub boundary. The earlier native/App experiment remains in `native/`, `src/`, and `scripts/` as reference, but is not used by this workflow.

This is an independent [Tempo-inspired](https://tempo.xyz/developers/blog/human-authorization-in-agentic-workflows) experiment, owned by **dionysuzx**, not by an assistant. It is public because GitHub Free rejected protection on a private repo. No private credentials are committed.
