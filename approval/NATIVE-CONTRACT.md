# Native bridge contract — FINAL flat revision 2

This file is authoritative for the GitHub consumer. Do not revise it based on older crossed task messages.

Request: `{version:1,origin,requestID,nonce,expiresAt,message,callback}`.
Origin is exactly `http://localhost:8787`; callback is exactly `http://localhost:8787/native/complete`.
RequestID and nonce each decode from canonical unpadded base64url to exactly 32 bytes.
ExpiresAt is a canonical ISO UTC timestamp with milliseconds (`Date.toISOString()`).

Proof is FLAT: `{version:"plain-text-native/v1",origin,requestID,nonce,expiresAt,message,publicKeySpki,signature}`.
PublicKeySpki is canonical unpadded base64url DER SPKI. Signature is canonical unpadded base64url ASN.1 DER ES256.

Signed bytes: UTF8 `plain-text-native/v1` followed by one NUL byte; then FIVE fields in order: origin, requestID, nonce, expiresAt, message. Each field is encoded as UTF8 without normalization and prefixed by its 4-byte unsigned big-endian byte length.

Signature algorithm: ECDSA P-256 with SHA-256 over those bytes. The nonce STRING is framed; do not frame decoded nonce bytes.
The verifier pins the public key separately and never enrolls from proof input.
