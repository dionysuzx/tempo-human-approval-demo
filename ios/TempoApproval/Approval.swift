import Foundation

enum ApprovalError: Error, LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let reason) = self { return reason }; return nil }
}

struct Approval: Equatable {
    let message: String
    let repository: String
    let number: Int
    let expires: Date
    let head: String
    let base: String

    static func parse(_ message: String, now: Date = Date()) throws -> Approval {
        let lines = message.components(separatedBy: "\n")
        guard message.utf8.count < 4096, lines.count == 10,
              lines[0] == "Approve this GitHub pull request", lines[1] == "",
              lines[2] == "Repository: dionysuzx/tempo-human-approval-demo",
              lines[5] == "Action: allow this change to merge into main" else {
            throw ApprovalError.invalid("This is not a supported approval request.")
        }
        func field(_ index: Int, _ prefix: String, _ pattern: String) throws -> String {
            guard lines[index].hasPrefix(prefix) else { throw ApprovalError.invalid("Malformed request.") }
            let value = String(lines[index].dropFirst(prefix.count))
            guard value.range(of: pattern, options: .regularExpression) != nil else { throw ApprovalError.invalid("Malformed request.") }
            return value
        }
        _ = try field(3, "Repository ID: ", "^[1-9][0-9]{0,15}$")
        let number = try field(4, "Pull request: #", "^[1-9][0-9]{0,8}$")
        let head = try field(6, "Head commit: ", "^[a-f0-9]{40}$")
        let base = try field(7, "Base commit: ", "^[a-f0-9]{40}$")
        _ = try field(8, "Request: ", "^[a-f0-9-]{36}$")
        let timestamp = try field(9, "Expires: ", "^[0-9T:.Z-]+$")
        guard let expires = isoDate(timestamp), isoString(expires) == timestamp,
              expires > now, expires.timeIntervalSince(now) <= 900 else { throw ApprovalError.invalid("Request expired or has an invalid lifetime. Request a fresh link on GitHub.") }
        return Approval(message: message, repository: "dionysuzx/tempo-human-approval-demo", number: Int(number)!, expires: expires, head: head, base: base)
    }

    static func fromURL(_ url: URL, origin: String, now: Date = Date()) throws -> Approval {
        guard let expected = URLComponents(string: origin), expected.scheme == "https",
              let actual = URLComponents(url: url, resolvingAgainstBaseURL: false),
              actual.scheme == expected.scheme, actual.host == expected.host,
              actual.port == expected.port, actual.user == nil, actual.password == nil,
              actual.path == "/native", actual.query == nil else { throw ApprovalError.invalid("Untrusted approval link.") }
        var fragment = URLComponents()
        fragment.percentEncodedQuery = actual.percentEncodedFragment?.replacingOccurrences(of: "+", with: "%20")
        let values = fragment.queryItems?.filter { $0.name == "message" } ?? []
        guard values.count == 1, let message = values[0].value else { throw ApprovalError.invalid("Missing or duplicate approval message.") }
        return try parse(message, now: now)
    }
    var githubURL: URL { URL(string: "https://github.com/\(repository)/pull/\(number)#issuecomment-new")! }
}

func isoDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
}
func isoString(_ value: Date) -> String {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: value)
}
extension Data {
    var base64url: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
struct NativeProof: Encodable {
    let version = "plain-text-native/v1"
    let origin: String
    let requestID: String
    let nonce: String
    let expiresAt: String
    let message: String
    let publicKeySpki: String
    var signature: String

    var signingBytes: Data {
        var result = Data("plain-text-native/v1\0".utf8)
        for value in [origin, requestID, nonce, expiresAt, message] {
            let bytes = Data(value.utf8)
            var count = UInt32(bytes.count).bigEndian
            withUnsafeBytes(of: &count) { result.append(contentsOf: $0) }
            result.append(bytes)
        }
        return result
    }
}
