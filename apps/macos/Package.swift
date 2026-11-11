// swift-tools-version: 5.9
import PackageDescription
var products: [Product] = [.library(name: "SidecarCore", targets: ["SidecarCore"]), .executable(name: "SidecarHook", targets: ["SidecarHook"])]
var targets: [Target] = [
    .target(name: "SidecarCore"),
    .executableTarget(name: "SidecarHook", dependencies: ["SidecarCore"]),
    .testTarget(name: "SidecarCoreTests", dependencies: ["SidecarCore"])
]
var dependencies: [Package.Dependency] = []
#if os(macOS)
// Pin reviewed upstream code; native builds require a Swift 6+ toolchain.
dependencies.append(.package(url: "https://github.com/MrKai77/DynamicNotchKit.git", revision: "cd0b3e52d537db115ad3a9d89601f20e0bee8d27"))
products.append(.executable(name: "EnglishSidecar", targets: ["SidecarDesktop"]))
targets.append(.executableTarget(name: "SidecarDesktop", dependencies: ["SidecarCore", .product(name: "DynamicNotchKit", package: "DynamicNotchKit")]))
targets.append(.testTarget(name: "SidecarDesktopTests", dependencies: ["SidecarDesktop", "SidecarCore", .product(name: "DynamicNotchKit", package: "DynamicNotchKit")]))
#endif
let package = Package(name: "EnglishSidecarNative", platforms: [.macOS(.v14)], products: products, dependencies: dependencies, targets: targets)
