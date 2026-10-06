import Foundation

typealias JSONObject = [String: Any]

enum VaultError: Error, CustomStringConvertible {
  case posix(String, Int32)

  var description: String {
    switch self {
    case let .posix(call, code): return "\(call) failed: \(String(cString: strerror(code)))"
    }
  }
}

enum Vault {
  static let resourceKeys: [URLResourceKey] = [
    .isDirectoryKey,
    .fileSizeKey,
    .totalFileAllocatedSizeKey,
    .contentModificationDateKey,
    .isUbiquitousItemKey,
    .ubiquitousItemDownloadingStatusKey,
    .ubiquitousItemIsDownloadingKey,
    .ubiquitousItemDownloadRequestedKey,
    .ubiquitousItemIsUploadedKey,
    .ubiquitousItemIsUploadingKey,
    .ubiquitousItemHasUnresolvedConflictsKey,
    .ubiquitousItemDownloadingErrorKey,
    .ubiquitousItemUploadingErrorKey,
  ]

  static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  static func coordinatedWrite<T>(_ url: URL, _ options: NSFileCoordinator.WritingOptions, _ work: (URL) throws -> T) throws -> T {
    var coordinationError: NSError?
    var result: Result<T, Error>?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordinationError) { target in result = Result { try work(target) } }
    if let coordinationError { throw coordinationError }
    return try result!.get()
  }

  static func coordinatedRead<T>(_ url: URL, _ work: (URL) throws -> T) throws -> T {
    var coordinationError: NSError?
    var result: Result<T, Error>?
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { target in result = Result { try work(target) } }
    if let coordinationError { throw coordinationError }
    return try result!.get()
  }

  static func writeAtomic(_ data: Data, to url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try coordinatedWrite(url, .forReplacing) { target in
      let fm = FileManager.default
      let scratch = try fm.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: target, create: true)
      defer { try? fm.removeItem(at: scratch) }
      let staged = scratch.appendingPathComponent(target.lastPathComponent)
      try data.write(to: staged)
      if fm.fileExists(atPath: target.path) {
        _ = try fm.replaceItemAt(target, withItemAt: staged)
      } else {
        try fm.moveItem(at: staged, to: target)
      }
    }
  }

  static func read(_ url: URL) throws -> Data {
    try coordinatedRead(url) { try Data(contentsOf: $0) }
  }

  static func remove(_ url: URL) throws {
    try coordinatedWrite(url, .forDeleting) { try FileManager.default.removeItem(at: $0) }
  }

  static func list(_ dir: URL) throws -> [JSONObject] {
    try FileManager.default
      .contentsOfDirectory(at: dir, includingPropertiesForKeys: resourceKeys, options: [])
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .map(entry)
  }

  static func status(_ url: URL) throws -> JSONObject {
    var fresh = url
    fresh.removeAllCachedResourceValues()
    return try entry(fresh)
  }

  static func entry(_ url: URL) throws -> JSONObject {
    let v = try url.resourceValues(forKeys: Set(resourceKeys))
    let name = url.lastPathComponent
    var e: JSONObject = [
      "name": name,
      "path": url.path,
      "isDirectory": v.isDirectory ?? false,
      "isUbiquitous": v.isUbiquitousItem ?? false,
      "nameIsNFC": isNFC(name),
    ]
    e["size"] = v.fileSize
    e["allocatedSize"] = v.totalFileAllocatedSize
    e["modified"] = v.contentModificationDate.map { $0.timeIntervalSince1970 * 1000 }
    e["downloadingStatus"] = v.ubiquitousItemDownloadingStatus.map(statusName)
    e["isDownloading"] = v.ubiquitousItemIsDownloading
    e["downloadRequested"] = v.ubiquitousItemDownloadRequested
    e["isUploaded"] = v.ubiquitousItemIsUploaded
    e["isUploading"] = v.ubiquitousItemIsUploading
    e["hasUnresolvedConflicts"] = v.ubiquitousItemHasUnresolvedConflicts
    e["downloadingError"] = v.ubiquitousItemDownloadingError?.localizedDescription
    e["uploadingError"] = v.ubiquitousItemUploadingError?.localizedDescription
    var st = stat()
    if lstat(url.path, &st) == 0 {
      e["isDataless"] = st.st_flags & UInt32(SF_DATALESS) != 0
      e["blocks"] = Int(st.st_blocks)
    }
    return e
  }

  static func statusName(_ s: URLUbiquitousItemDownloadingStatus) -> String {
    switch s {
    case .current: return "current"
    case .downloaded: return "downloaded"
    case .notDownloaded: return "notDownloaded"
    default: return s.rawValue
    }
  }

  static func isNFC(_ s: String) -> Bool {
    Array(s.unicodeScalars) == Array(s.precomposedStringWithCanonicalMapping.unicodeScalars)
  }

  static func hex(_ s: String) -> String {
    s.utf8.map { String(format: "%02x", $0) }.joined()
  }

  static func rawNames(_ dir: URL) throws -> [JSONObject] {
    guard let d = opendir(dir.path) else { throw VaultError.posix("opendir", errno) }
    defer { closedir(d) }
    var names: [JSONObject] = []
    while let ent = readdir(d) {
      let name = withUnsafeBytes(of: ent.pointee.d_name) { raw in
        String(decoding: raw.prefix(Int(ent.pointee.d_namlen)), as: UTF8.self)
      }
      guard name != ".", name != ".." else { continue }
      names.append(["name": name, "hex": hex(name), "nfc": isNFC(name)])
    }
    return names.sorted { ($0["hex"] as! String) < ($1["hex"] as! String) }
  }

  static func startDownloading(_ url: URL) throws {
    try FileManager.default.startDownloadingUbiquitousItem(at: url)
  }

  static func evict(_ url: URL) throws {
    try FileManager.default.evictUbiquitousItem(at: url)
  }

  static func conflicts(_ url: URL) -> [JSONObject] {
    (NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).map(version)
  }

  static func otherVersions(_ url: URL) -> [JSONObject] {
    (NSFileVersion.otherVersionsOfItem(at: url) ?? []).map(version)
  }

  static func resolveConflictsKeepingCurrent(_ url: URL) throws {
    try coordinatedWrite(url, []) { target in
      for v in NSFileVersion.unresolvedConflictVersionsOfItem(at: target) ?? [] { v.isResolved = true }
      try NSFileVersion.removeOtherVersionsOfItem(at: target)
    }
  }

  static func version(_ v: NSFileVersion) -> JSONObject {
    var o: JSONObject = ["url": v.url.path, "isConflict": v.isConflict, "isResolved": v.isResolved]
    o["modified"] = v.modificationDate.map { $0.timeIntervalSince1970 * 1000 }
    o["savingComputer"] = v.localizedNameOfSavingComputer
    return o
  }

  static func ubiquityInfo() -> JSONObject {
    var o: JSONObject = ["identityToken": FileManager.default.ubiquityIdentityToken != nil]
    o["containerURL"] = FileManager.default.url(forUbiquityContainerIdentifier: nil)?.path
    return o
  }
}

final class VaultWatcher: NSObject, NSFilePresenter, @unchecked Sendable {
  let presentedItemURL: URL?
  let presentedItemOperationQueue: OperationQueue = {
    let q = OperationQueue()
    q.maxConcurrentOperationCount = 1
    return q
  }()

  private let dir: URL
  private let emit: (JSONObject) -> Void
  private var query: NSMetadataQuery?
  private var observers: [NSObjectProtocol] = []

  init(dir: URL, emit: @escaping (JSONObject) -> Void) {
    self.dir = dir
    self.presentedItemURL = dir
    self.emit = emit
  }

  func startPresenter() {
    NSFileCoordinator.addFilePresenter(self)
  }

  /// Must be called on a thread with a running run loop (the main thread in an app).
  func startQuery(scope: Any) {
    let q = NSMetadataQuery()
    q.searchScopes = [scope]
    q.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
    q.notificationBatchingInterval = 0
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: q, queue: nil) { [weak self] _ in
        guard let self else { return }
        q.disableUpdates()
        let items = (0 ..< q.resultCount).compactMap { q.result(at: $0) as? NSMetadataItem }
        self.emit(["source": "query", "kind": "gathered", "count": items.count, "items": items.map(Self.describe)])
        q.enableUpdates()
      },
      center.addObserver(forName: .NSMetadataQueryDidUpdate, object: q, queue: nil) { [weak self] note in
        guard let self else { return }
        for (key, kind) in [(NSMetadataQueryUpdateAddedItemsKey, "added"), (NSMetadataQueryUpdateChangedItemsKey, "changed"), (NSMetadataQueryUpdateRemovedItemsKey, "removed")] {
          for item in note.userInfo?[key] as? [NSMetadataItem] ?? [] {
            self.emit(["source": "query", "kind": kind].merging(Self.describe(item)) { a, _ in a })
          }
        }
      },
    ]
    query = q
    if !q.start() { emit(["source": "query", "kind": "startFailed"]) }
  }

  func stop() {
    NSFileCoordinator.removeFilePresenter(self)
    query?.stop()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    query = nil
  }

  static func describe(_ item: NSMetadataItem) -> JSONObject {
    var o: JSONObject = [:]
    o["path"] = item.value(forAttribute: NSMetadataItemPathKey) as? String
    o["downloadingStatus"] = (item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String)
      .map { Vault.statusName(URLUbiquitousItemDownloadingStatus(rawValue: $0)) }
    o["isUploaded"] = item.value(forAttribute: NSMetadataUbiquitousItemIsUploadedKey) as? Bool
    o["isUploading"] = item.value(forAttribute: NSMetadataUbiquitousItemIsUploadingKey) as? Bool
    o["percentUploaded"] = item.value(forAttribute: NSMetadataUbiquitousItemPercentUploadedKey) as? Double
    o["isDownloading"] = item.value(forAttribute: NSMetadataUbiquitousItemIsDownloadingKey) as? Bool
    o["hasUnresolvedConflicts"] = item.value(forAttribute: NSMetadataUbiquitousItemHasUnresolvedConflictsKey) as? Bool
    o["size"] = item.value(forAttribute: NSMetadataItemFSSizeKey) as? Int
    return o
  }

  private func report(_ kind: String, _ url: URL, _ extra: JSONObject = [:]) {
    emit(["source": "presenter", "kind": kind, "path": url.path].merging(extra) { a, _ in a })
  }

  func presentedItemDidChange() { report("dirChanged", dir) }
  func presentedSubitemDidAppear(at url: URL) { report("appeared", url) }
  func presentedSubitemDidChange(at url: URL) { report("changed", url) }
  func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) { report("moved", newURL, ["from": oldURL.path]) }
  func presentedSubitem(at url: URL, didGain version: NSFileVersion) { report("gainedVersion", url, ["isConflict": version.isConflict]) }
  func presentedSubitem(at url: URL, didResolve version: NSFileVersion) { report("resolvedVersion", url) }
  func presentedSubitem(at url: URL, didLose version: NSFileVersion) { report("lostVersion", url) }

  func accommodatePresentedSubitemDeletion(at url: URL, completionHandler: @escaping (Error?) -> Void) {
    report("deleting", url)
    completionHandler(nil)
  }
}
