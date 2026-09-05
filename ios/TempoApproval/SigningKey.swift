import Foundation
import Security
import LocalAuthentication
import CryptoKit

struct SigningKey {
    private let tag = Data("org.tempoapproval.iphone.signing.v1".utf8)

    private func requireFaceID(_ context: LAContext) throws {
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error), context.biometryType == .faceID else {
            throw ApprovalError.invalid("Face ID must be available and enrolled. Unlock your iPhone if Face ID is locked out, then retry.")
        }
    }

    private func key(create: Bool, context: LAContext) throws -> SecKey {
        try requireFaceID(context)
        var item: CFTypeRef?
        let query: [CFString: Any] = [kSecClass:kSecClassKey, kSecAttrApplicationTag:tag,
            kSecAttrKeyType:kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef:true,
            kSecUseAuthenticationContext:context]
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess { return item as! SecKey }
        guard status == errSecItemNotFound, create else { throw ApprovalError.invalid("Signing key unavailable. Enroll this device first; after a Face ID change, revoke the old key before replacing it.") }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet], &error) else { throw error!.takeRetainedValue() }
        let attributes: [CFString: Any] = [kSecAttrKeyType:kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits:256, kSecAttrTokenID:kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs:[kSecAttrIsPermanent:true, kSecAttrApplicationTag:tag, kSecAttrAccessControl:access]]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else { throw error!.takeRetainedValue() }
        return key
    }
    private func spki(_ key: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let publicKey = SecKeyCopyPublicKey(key), let bytes = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else { throw ApprovalError.invalid("Cannot export public key.") }
        // ASN.1 SubjectPublicKeyInfo header for an uncompressed P-256 point.
        return Data([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00]) + bytes
    }
    func enrollment(origin: String) throws -> String {
        let publicKey = try spki(key(create: true, context: LAContext()))
        let record = ["fingerprint":"sha256:" + Data(SHA256.hash(data: publicKey)).base64url,
            "origin":origin, "publicKeySpki":publicKey.base64url]
        return String(data: try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted,.sortedKeys]), encoding: .utf8)!
    }
    func sign(_ approval: Approval, origin: String) throws -> String {
        _ = try Approval.parse(approval.message)
        let context = LAContext()
        context.localizedFallbackTitle = ""
        context.touchIDAuthenticationAllowableReuseDuration = 0
        context.localizedReason = "Approve PR #\(approval.number), commit \(approval.head.prefix(12))"
        defer { context.invalidate() }
        let key = try key(create: false, context: context)
        func random() throws -> String {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ApprovalError.invalid("Secure randomness unavailable.") }
            return Data(bytes).base64url
        }
        var proof = NativeProof(origin: origin, requestID: try random(), nonce: try random(),
            expiresAt: isoString(min(approval.expires, Date().addingTimeInterval(240))),
            message: approval.message, publicKeySpki: try spki(key).base64url, signature: "")
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, proof.signingBytes as CFData, &error) as Data? else {
            throw error?.takeRetainedValue() ?? ApprovalError.invalid("Face ID signing was cancelled.") as Error
        }
        proof.signature = signature.base64url
        _ = try Approval.parse(approval.message)
        guard isoDate(proof.expiresAt)! > Date() else { throw ApprovalError.invalid("Signing expired. Try again.") }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted,.sortedKeys,.withoutEscapingSlashes]
        return String(data: try encoder.encode(proof), encoding: .utf8)!
    }
}
