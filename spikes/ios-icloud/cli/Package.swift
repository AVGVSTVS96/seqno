// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "vaultctl",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(name: "vaultctl", swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
