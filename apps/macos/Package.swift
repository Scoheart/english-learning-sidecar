// swift-tools-version: 5.9
import PackageDescription
var products: [Product] = [.library(name: "SidecarCore", targets: ["SidecarCore"]), .executable(name: "SidecarHook", targets: ["SidecarHook"])]
var targets: [Target] = [
    .target(name: "SidecarCore"),
    .executableTarget(name: "SidecarHook", dependencies: ["SidecarCore"]),
    .testTarget(name: "SidecarCoreTests", dependencies: ["SidecarCore"])
]
#if os(macOS)
products.append(.executable(name: "EnglishSidecar", targets: ["SidecarDesktop"]))
targets.append(.executableTarget(name: "SidecarDesktop", dependencies: ["SidecarCore"]))
#endif
let package = Package(name: "EnglishSidecarNative", platforms: [.macOS(.v14)], products: products, targets: targets)
