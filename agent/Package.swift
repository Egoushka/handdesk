// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "handdesk",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "handdesk", targets: ["handdesk"])],
    targets: [
        .target(name: "HandDeskCore"),
        .executableTarget(name: "handdesk", dependencies: ["HandDeskCore"]),
        .executableTarget(name: "core-tests", dependencies: ["HandDeskCore"], path: "Tests/CoreTests"),
    ]
)
