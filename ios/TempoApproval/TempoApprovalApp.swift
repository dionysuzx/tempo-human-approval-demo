import SwiftUI
import UIKit

@main
struct TempoApprovalApp: App {
    var body: some Scene { WindowGroup { ApprovalView() } }
}

struct ApprovalView: View {
    @State private var approval: Approval?
    @State private var proof = ""
    @State private var enrollment = ""
    @State private var status = ""
    @State private var busy = false
    @State private var reviewed = false
    @State private var pastedLink = ""
    private var origin: String { Bundle.main.object(forInfoDictionaryKey: "ApprovalOrigin") as? String ?? "" }
    private var configured: Bool { origin.hasPrefix("https://") && !origin.contains(".invalid") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !configured { Text("This build needs its HTTPS approval domain configured before enrollment.").foregroundStyle(.red) }
                    if let request = approval {
                        Text("PR #\(request.number)").font(.largeTitle.bold())
                        Text(request.message).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        Link("Review changes on GitHub", destination: request.githubURL)
                        Toggle("I reviewed these exact commits", isOn: $reviewed).disabled(busy)
                        Button("Approve with Face ID") { sign(request) }
                            .buttonStyle(.borderedProminent).disabled(!reviewed || busy || !configured)
                        Button("Cancel request", role: .cancel) { approval = nil; proof = ""; reviewed = false }.disabled(busy)
                        if !proof.isEmpty {
                            Text("Signed, awaiting delivery. Copy this proof, open GitHub, and paste it as a new PR comment within four minutes. Approval completes only when the GitHub check turns green.")
                            Button("Copy signed proof") { UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic:proof]], options: [.localOnly:true, .expirationDate:Date().addingTimeInterval(240)]); status = "Copied. Paste as a new comment on the PR." }
                            Link("Open GitHub to post proof", destination: request.githubURL)
                            ShareLink("Share signed proof", item: proof)
                        }
                    } else {
                        Text("Open an approval link").font(.title.bold())
                        Text("Open the HTTPS link from your pull request. If it stays in Safari, paste it here.")
                        TextField("HTTPS approval link", text: $pastedLink).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                        Button("Review request") { if let url = URL(string:pastedLink) { receive(url) } else { status = "Invalid URL." } }.disabled(!configured)
                    }
                    Divider()
                    DisclosureGroup("Enroll this iPhone") {
                        VStack(alignment:.leading, spacing:12) {
                            Text("Create a device key, then have the repository owner compare its fingerprint directly on this screen and register the public record. Creating a key does not authorize it.")
                            Button("Show public enrollment record") {
                                do { enrollment = try SigningKey().enrollment(origin:origin); status = "Owner enrollment required." }
                                catch { status = error.localizedDescription }
                            }.disabled(busy || !configured)
                            if !enrollment.isEmpty { Text(enrollment).font(.system(.footnote,design:.monospaced)).textSelection(.enabled); ShareLink("Share public record", item:enrollment) }
                        }
                    }
                    Text(status).accessibilityLabel("Status: " + status)
                }.padding(24)
            }.navigationTitle("Human approval")
        }.onOpenURL { receive($0) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { if let url = $0.webpageURL { receive(url) } }
    }
    private func receive(_ url: URL) {
        guard !busy else { return }
        proof = ""; reviewed = false; approval = nil
        do { approval = try Approval.fromURL(url, origin:origin); status = "Review the full request before signing." }
        catch { status = error.localizedDescription }
    }
    private func sign(_ request: Approval) {
        busy = true; proof = ""; status = "Waiting for Face ID…"
        let trustedOrigin = origin
        // Keychain interaction is blocking. Keep it off the UI thread.
        DispatchQueue.global(qos:.userInitiated).async {
            let result = Result { try SigningKey().sign(request, origin:trustedOrigin) }
            DispatchQueue.main.async {
                busy = false
                switch result {
                case .success(let value):
                    proof = value; busy = true; status = "Sending signed proof…"
                    Task { @MainActor in
                        defer { busy = false }
                        do {
                            let destination = try await deliverProof(value,approval:request,origin:trustedOrigin)
                            status = "Proof delivered. Returning to GitHub; the approval check verifies it there."
                            _ = await UIApplication.shared.open(destination)
                        } catch { status = error.localizedDescription }
                    }
                case .failure(let error): status = error.localizedDescription
                }
            }
        }
    }
}
