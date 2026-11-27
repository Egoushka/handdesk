// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "handdesk",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "handdesk", targets: ["handdesk"])],
    targets: [
        .target(name: "HandDeskCore"),
        .target(name: "CVD"),
        .executableTarget(name: "handdesk", dependencies: ["HandDeskCore", "CVD"]),
        .executableTarget(name: "core-tests", dependencies: ["HandDeskCore"], path: "Tests/CoreTests"),
    ]
)
