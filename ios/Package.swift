// swift-tools-version: 5.9
import PackageDescription
let package = Package(name:"ApprovalCore", platforms:[.macOS(.v13)], products:[.library(name:"ApprovalCore",targets:["ApprovalCore"])], targets:[
    .target(name:"ApprovalCore",path:"TempoApproval",exclude:["SigningKey.swift","TempoApprovalApp.swift","Info.plist","TempoApproval.entitlements"],sources:["Approval.swift","Delivery.swift"]),
    .testTarget(name:"ApprovalCoreTests",dependencies:["ApprovalCore"],path:"Tests")
])
