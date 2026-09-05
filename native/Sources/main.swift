import Foundation
import CryptoKit
import LocalAuthentication
import Security

struct Failure: Error, CustomStringConvertible { let description: String; init(_ s: String) { description = s } }
struct Config: Decodable { let repo: String; let token: String }
struct Pending: Decodable { let payload: String }
struct Approval: Decodable {
    let version: Int
    let id: String
    let decision: String
    let repo: String
    let pr: Int
    let head: String
    let base: String
    let key: String
    let issued: Int64
    let expires: Int64
}
func fingerprint(_ key: P256.Signing.PublicKey) -> String {
    SHA256.hash(data: key.derRepresentation).map { String(format: "%02x", $0) }.joined()
}
func context(_ reason: String) -> LAContext {
    let value = LAContext()
    value.localizedReason = reason
    value.localizedFallbackTitle = ""
    value.touchIDAuthenticationAllowableReuseDuration = 0
    return value
}
func save(_ data: Data, _ path: String) throws {
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
}
func post(_ path: String, _ body: [String: Any], token: String) async throws -> Data {
    var req = URLRequest(url: URL(string: "http://127.0.0.1:8789/\(path)")!)
    req.httpMethod = "POST"
    req.timeoutInterval = 30
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: req)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        throw Failure(error?["error"] as? String ?? "Verifier unavailable")
    }
    return data
}
func run() async throws {
    let args = CommandLine.arguments
    guard args.count >= 2 else { throw Failure("Use: human-approval enroll | approve <PR number>") }
    let file = ".state/enclave-key"
    if args[1] == "enroll" {
        guard SecureEnclave.isAvailable else { throw Failure("This Mac has no Secure Enclave") }
        if FileManager.default.fileExists(atPath: file) { throw Failure("This Mac is already enrolled. Existing key was kept.") }
        let auth = context("Set up Touch ID for the GitHub approval demo")
        var error: NSError?
        guard auth.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw Failure("Set up Touch ID in System Settings first")
        }
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet], &accessError) else { throw Failure("Could not create biometric access control") }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access, authenticationContext: auth)
        // Enrollment itself proves the new hardware key can sign with biometric presence.
        _ = try key.signature(for: Data("Enroll GitHub human approval \(UUID().uuidString)".utf8))
        try FileManager.default.createDirectory(atPath: ".state", withIntermediateDirectories: true,
                                              attributes: [.posixPermissions: 0o700])
        try save(key.dataRepresentation, file)
        try save(Data(key.publicKey.pemRepresentation.utf8), ".state/native-public.pem")
        print("Touch ID is ready. Your fingerprint: \(fingerprint(key.publicKey))")
        return
    }
    guard args[1] == "approve", args.count == 3, let number = Int(args[2]), number > 0 else {
        throw Failure("Use: human-approval approve <PR number>")
    }
    let config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: URL(fileURLWithPath: ".state/config.json")))
    let pending = try JSONDecoder().decode(Pending.self, from: await post("request", ["pr": number], token: config.token))
    let payload = Data(pending.payload.utf8)
    let approval = try JSONDecoder().decode(Approval.self, from: payload)
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard approval.version == 1, approval.decision == "approved", approval.repo == config.repo,
          approval.pr == number, UUID(uuidString: approval.id) != nil,
          approval.issued <= now, approval.expires > now, approval.expires - approval.issued == 120_000,
          approval.head.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
          approval.base.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else {
        throw Failure("Unexpected approval request; nothing was signed")
    }
    // No server-provided PR title or untrusted prose goes into the security prompt.
    let reason = "Approve \(config.repo) #\(number), commit \(approval.head.prefix(12))"
    let auth = context(reason)
    let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: Data(contentsOf: URL(fileURLWithPath: file)), authenticationContext: auth)
    guard approval.key == fingerprint(key.publicKey) else { throw Failure("Verifier enrolled a different key; nothing was signed") }
    print("\(reason)\nFull commit: \(approval.head)\nBase commit: \(approval.base)")
    print("Review: https://github.com/\(config.repo)/pull/\(number)/files/\(approval.head)")
    let signature = try key.signature(for: payload)
    _ = try await post("approve", ["id": approval.id, "signature": signature.derRepresentation.base64EncodedString()], token: config.token)
    print("Approved. The GitHub check is green. You can now merge the PR in GitHub.")
}
do { try await run() } catch {
    print("No approval completed: \(error)")
    exit(1)
}
