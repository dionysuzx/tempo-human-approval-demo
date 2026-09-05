# Approve a GitHub PR with Touch ID

An independent experiment inspired by [Tempo's Voight-Kampff](https://tempo.xyz/developers/blog/human-authorization-in-agentic-workflows). It is not Tempo's code or service.

**Try it:** open PR #1, run `./approve.command`, touch the sensor, then see the required GitHub check turn green. A new commit needs a new approval. The demo never merges automatically.

The repository belongs to **dionysuzx**, the authenticated user's account. The in-app browser was signed into **abyssalwhip** during setup; use **dionysuzx** when creating the private App. Assistants have no separate GitHub account.

## First-time setup

Requires a Mac with Touch ID configured, Swift 6, Node 24+, and authenticated `gh`. Private repository branch protection requires a qualifying GitHub plan.

1. [Create the prefilled GitHub App](https://github.com/settings/apps/new?name=dionysuzx-touch-id-demo&url=https%3A%2F%2Fgithub.com%2Fdionysuzx%2Ftempo-human-approval-demo&description=Touch%20ID%20approval%20for%20one%20demo%20repository&public=false&webhook_active=false&checks=write&pull_requests=read). Keep it private and webhooks off. It only needs **Checks: read/write** and **Pull requests: read** (Metadata read is automatic). Click **Create GitHub App**.
2. On its settings page, note the **App ID** and click **Generate a private key**. Click **Install App**, choose your account, and select **only `tempo-human-approval-demo`**. The number at the end of the installation page URL is the installation ID.
3. In this repository folder, run `./setup.command`. Touch ID enrolls your Mac automatically; paste the two IDs and the path to the downloaded `.pem` file when asked.
4. Run `npm run protect`, then `npm start`. Leave this terminal open.
5. In another terminal in this folder, run `./approve.command`. Review the commit in GitHub before touching the sensor. Refresh PR #1 to see the result.

Future approvals only need steps 4 (`npm start`) and 5. Use `./approve.command 2` for another PR. Nothing starts automatically or installs a background service.

If GitHub rejects protection because of the account plan, setup stays blocked. Use a qualifying plan or explicitly choose to make this demo public; the setup script never changes visibility.

## What this demonstrates

- A real P-256 key in Apple's Secure Enclave, requiring `biometryCurrentSet` for private-key use. No software-key or password fallback. Changing enrolled fingerprints invalidates the key.
- A two-minute, single-use request tied to repository, PR number, exact head and base commits, decision, and the enrolled key's fingerprint.
- A verifier that fetches live PR state from GitHub, checks the signature, and durably consumes it before writing a successful check.
- A required check pinned to a dedicated GitHub App ID. A different app or ordinary personal token cannot satisfy that pinned requirement just by copying the check name.
- Durable SQLite receipts and rejection of concurrent replay. An uncertain GitHub write is recorded and not blindly retried.

GitHub does not let an author approve their own PR review. For this one-person experiment, the native command starts the request. Tempo instead starts it from a review webhook and pushes it to a background client. This demo uses an authenticated loopback request and a foreground native prompt; it does not implement webhooks, automatic review policy, or team identity management.

## Trust boundary: read before using beyond the demo

**The local mode is an experience demo, not isolation from an agent or malware with your Mac account.** The verifier, enrolled public key, database and GitHub App private key live in `.state/`. An agent that can edit those files or use your GitHub administrator account could bypass the gate. File mode 0600 protects other OS users, not software running as you. GitHub administrators can also change branch protection even when `enforce_admins` is on.

For a rigid agent boundary, operate the verifier and enrollment under a separately administered identity or host inaccessible to the agent; keep the App key and GitHub administration credentials there. Give the coding agent only a scoped repo writer credential. Run trusted verifier code from an operator-controlled checkout, never from a PR branch. The current client/server transport is loopback-only; a remote deployment additionally needs authenticated TLS and separate client configuration, which this experiment does not claim to provide.

Enrollment is a local operator action, not a public API. The server pins the exported public key and never accepts a replacement key in an approval request. There is no remote hardware attestation: the operator trusts that enrollment used the supplied native program. The SQLite triggers protect application invariants, not an administrator who can rewrite the database; this is not a WORM storage service.

Expiry governs when a signature can be accepted. An accepted GitHub check remains approval for that commit; it is not revoked two minutes later. Strict branch protection requires an up-to-date branch. The verifier also checks the base SHA at acceptance. GitHub's check model attaches checks to commits, not individual PR numbers; avoid reusing the same head commit across different PRs as a distinct approval boundary.

## Development and validation

```sh
npm test
swift build --package-path native -c release
```

The CI definition is provided as `ci/test-workflow.yml`; it is inactive because the publishing token lacks workflow scope. Local tests were run instead.

No npm dependencies. Tests use real P-256 signatures and SQLite, including a loopback HTTP round trip; GitHub is replaced at the network boundary. Swift builds the actual Secure Enclave signer. Hardware signing and a live App-authenticated check require the user's enrollment and installation; passing tests does not stand in for those steps.

Files: `src/approval.mjs` is the pure validation boundary; `src/gate.mjs` serializes transitions and external effects; `src/github.mjs` handles installation-token GitHub calls; `native/Sources/main.swift` handles the Touch ID prompt and signing. `.state/` is ignored and must never be committed.

## Remove the experiment

Stop `npm start` with Ctrl-C. Uninstall and delete the dedicated GitHub App in GitHub settings. Delete this demo repository if no longer wanted. Delete the local `.state/` folder to remove its wrapped key, receipts, and credentials. No LaunchAgent, login item, or browser extension was installed.
