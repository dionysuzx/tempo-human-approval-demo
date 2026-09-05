// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "HumanApproval", platforms: [.macOS(.v13)], targets: [
    .executableTarget(name: "human-approval", path: "Sources")
])
