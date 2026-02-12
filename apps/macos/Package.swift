// swift-tools-version: 6.2
// Package manifest for the Verso macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Verso",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "VersoIPC", targets: ["VersoIPC"]),
        .library(name: "VersoDiscovery", targets: ["VersoDiscovery"]),
        .executable(name: "Verso", targets: ["Verso"]),
        .executable(name: "openclaw-mac", targets: ["VersoMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/VersoKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "VersoIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "VersoDiscovery",
            dependencies: [
                .product(name: "VersoKit", package: "VersoKit"),
            ],
            path: "Sources/VersoDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Verso",
            dependencies: [
                "VersoIPC",
                "VersoDiscovery",
                .product(name: "VersoKit", package: "VersoKit"),
                .product(name: "VersoChatUI", package: "VersoKit"),
                .product(name: "VersoProtocol", package: "VersoKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Verso.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "VersoMacCLI",
            dependencies: [
                "VersoDiscovery",
                .product(name: "VersoKit", package: "VersoKit"),
                .product(name: "VersoProtocol", package: "VersoKit"),
            ],
            path: "Sources/VersoMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "VersoIPCTests",
            dependencies: [
                "VersoIPC",
                "Verso",
                "VersoDiscovery",
                .product(name: "VersoProtocol", package: "VersoKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
