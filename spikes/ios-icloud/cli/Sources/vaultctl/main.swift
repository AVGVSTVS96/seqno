import Foundation

let stdoutLock = NSLock()

func printJSON(_ value: Any, pretty: Bool = false) {
  var options: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]
  if pretty { options.insert(.prettyPrinted) }
  let data = try! JSONSerialization.data(withJSONObject: value, options: options)
  stdoutLock.lock()
  FileHandle.standardOutput.write(data + [0x0A])
  stdoutLock.unlock()
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("vaultctl: \(message)\n".utf8))
  exit(1)
}

struct SplitMix64 {
  var state: UInt64
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}

func randomData(_ count: Int, seed: UInt64) -> Data {
  var rng = SplitMix64(state: seed)
  var data = Data(count: count)
  data.withUnsafeMutableBytes { raw in
    for i in 0 ..< count { raw[i] = UInt8(truncatingIfNeeded: rng.next()) }
  }
  return data
}

func shell(_ path: String, _ args: [String]) -> JSONObject {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: path)
  p.arguments = args
  let out = Pipe()
  p.standardOutput = out
  p.standardError = out
  do { try p.run() } catch { return ["error": "\(error)"] }
  let data = out.fileHandleForReading.readDataToEndOfFile()
  p.waitUntilExit()
  return ["exit": Int(p.terminationStatus), "output": String(decoding: data, as: UTF8.self)]
}

func xattrNames(_ path: String) -> [String] {
  let size = listxattr(path, nil, 0, XATTR_NOFOLLOW)
  guard size > 0 else { return [] }
  var buffer = [CChar](repeating: 0, count: size)
  listxattr(path, &buffer, size, XATTR_NOFOLLOW)
  return buffer.split(separator: 0).map { String(decoding: $0.map { UInt8(bitPattern: $0) }, as: UTF8.self) }
}

func stats(_ xs: [Double]) -> JSONObject {
  guard !xs.isEmpty else { return ["n": 0] }
  let s = xs.sorted()
  let pick = { (p: Double) in (s[min(s.count - 1, Int(p * Double(s.count)))] * 10).rounded() / 10 }
  return ["n": s.count, "p50": pick(0.5), "p95": pick(0.95), "max": pick(1), "min": pick(0)]
}

func runWatcher(dir: URL, scope: String) -> Never {
  let watcher = VaultWatcher(dir: dir) { event in
    printJSON(event.merging(["at": Vault.now()]) { a, _ in a })
  }
  watcher.startPresenter()
  switch scope {
  case "none": break
  case "ubiquitous-docs": watcher.startQuery(scope: NSMetadataQueryUbiquitousDocumentsScope)
  case "ubiquitous-external": watcher.startQuery(scope: NSMetadataQueryAccessibleUbiquitousExternalDocumentsScope)
  default: watcher.startQuery(scope: dir)
  }
  printJSON(["source": "watcher", "kind": "ready", "at": Vault.now(), "scope": scope])
  RunLoop.main.run()
  exit(0)
}

final class WatcherProcess {
  private let process = Process()
  private let lock = NSLock()
  private var buffer = Data()
  private var received: [JSONObject] = []

  init(dir: URL, scope: String) throws {
    process.executableURL = Bundle.main.executableURL
    process.arguments = ["watch", dir.path, "--scope", scope]
    let pipe = Pipe()
    process.standardOutput = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in self?.ingest(handle.availableData) }
    try process.run()
  }

  private func ingest(_ chunk: Data) {
    lock.lock()
    defer { lock.unlock() }
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 0x0A) {
      let line = buffer[buffer.startIndex ..< newline]
      buffer.removeSubrange(buffer.startIndex ... newline)
      if let event = try? JSONSerialization.jsonObject(with: line) as? JSONObject { received.append(event) }
    }
  }

  var events: [JSONObject] {
    lock.lock()
    defer { lock.unlock() }
    return received
  }

  func waitFor(_ timeout: Double, _ match: (JSONObject) -> Bool) -> JSONObject? {
    let deadline = Vault.now() + timeout
    while Vault.now() < deadline {
      if let hit = events.first(where: match) { return hit }
      usleep(5000)
    }
    return nil
  }

  func stop() { process.terminate() }
}

func waitUntil(_ timeoutMs: Double, every intervalMs: Double = 25, _ done: () -> Bool) -> Double? {
  let start = Vault.now()
  while Vault.now() - start < timeoutMs {
    if done() { return Vault.now() - start }
    usleep(useconds_t(intervalMs * 1000))
  }
  return nil
}

func entry(_ url: URL) -> JSONObject { (try? Vault.status(url)) ?? ["missing": true] }

func isUploaded(_ url: URL) -> Bool { entry(url)["isUploaded"] as? Bool == true }

func firstEvent(_ events: [JSONObject], source: String, suffix: String, after: Double, kinds: Set<String>? = nil) -> JSONObject? {
  events.first {
    $0["source"] as? String == source && ($0["path"] as? String)?.hasSuffix(suffix) == true
      && ($0["at"] as? Double ?? 0) >= after && (kinds?.contains($0["kind"] as? String ?? "") ?? true)
  }
}

func eventKinds(_ events: [JSONObject], suffix: String, from: Double, to: Double) -> [String] {
  events.filter {
    ($0["path"] as? String)?.hasSuffix(suffix) == true && ($0["at"] as? Double ?? 0) >= from && ($0["at"] as? Double ?? 0) <= to
  }.map { "\($0["source"]!):\($0["kind"]!)" + (($0["downloadingStatus"] as? String).map { "(\($0))" } ?? "") }
}

func probe(root: URL, scope: String, keep: Bool) {
  let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
  let run = root.appendingPathComponent("run-\(stamp)", isDirectory: true)
  try! FileManager.default.createDirectory(at: run, withIntermediateDirectories: true)
  var report: JSONObject = [
    "runDir": run.path,
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "ubiquity": Vault.ubiquityInfo(),
  ]
  let log = { (s: String) in FileHandle.standardError.write(Data("[probe] \(s)\n".utf8)) }

  let watcher = try! WatcherProcess(dir: run, scope: scope)
  let ready = watcher.waitFor(30000) { $0["kind"] as? String == "ready" }
  let gathered = watcher.waitFor(30000) { $0["kind"] as? String == "gathered" || $0["kind"] as? String == "startFailed" }
  report["watcher"] = ["scope": scope, "ready": ready != nil, "queryGathered": gathered?["kind"] ?? "timeout"]

  // A: write -> visible latency
  log("A write latency")
  let updates = run.appendingPathComponent("updates/mac-cli", isDirectory: true)
  let count = 20
  var originals: [Data] = []
  var startedAt: [Double] = []
  var writeMs: [Double] = []
  var uploadedAt = [Double?](repeating: nil, count: count)
  var uploadingSeenAt = [Double?](repeating: nil, count: count)
  let pollLock = NSLock()
  var writing = true
  let poller = Thread {
    while true {
      pollLock.lock()
      let n = startedAt.count
      let stillWriting = writing
      pollLock.unlock()
      var pending = false
      for i in 0 ..< n where uploadedAt[i] == nil {
        let e = entry(updates.appendingPathComponent("\(i + 1).loro"))
        if e["isUploading"] as? Bool == true, uploadingSeenAt[i] == nil { uploadingSeenAt[i] = Vault.now() }
        if e["isUploaded"] as? Bool == true { uploadedAt[i] = Vault.now() } else { pending = true }
      }
      if !stillWriting && !pending { break }
      usleep(20000)
    }
  }
  poller.start()
  for i in 0 ..< count {
    let data = randomData(4096, seed: UInt64(i + 1))
    originals.append(data)
    let t0 = Vault.now()
    try! Vault.writeAtomic(data, to: updates.appendingPathComponent("\(i + 1).loro"))
    pollLock.lock()
    startedAt.append(t0)
    pollLock.unlock()
    writeMs.append(Vault.now() - t0)
    usleep(200_000)
  }
  pollLock.lock()
  writing = false
  pollLock.unlock()
  _ = waitUntil(180_000, every: 100) { poller.isFinished }
  let afterA = watcher.events
  var presenterMs: [Double] = []
  var queryMs: [Double] = []
  var presenterMissing = 0
  var queryMissing = 0
  for i in 0 ..< count {
    let suffix = "/updates/mac-cli/\(i + 1).loro"
    if let e = firstEvent(afterA, source: "presenter", suffix: suffix, after: startedAt[i]) { presenterMs.append(e["at"] as! Double - startedAt[i]) } else { presenterMissing += 1 }
    if let e = firstEvent(afterA, source: "query", suffix: suffix, after: startedAt[i]) { queryMs.append(e["at"] as! Double - startedAt[i]) } else { queryMissing += 1 }
  }
  report["A_writeLatency"] = [
    "files": count,
    "bytesEach": 4096,
    "coordinatedAtomicWriteMs": stats(writeMs),
    "writeToPresenterEventMs": stats(presenterMs),
    "presenterMissing": presenterMissing,
    "writeToQueryEventMs": stats(queryMs),
    "queryMissing": queryMissing,
    "writeToIsUploadingMs": stats(zip(uploadingSeenAt, startedAt).compactMap { u, s in u.map { $0 - s } }),
    "writeToIsUploadedMs": stats(zip(uploadedAt, startedAt).compactMap { u, s in u.map { $0 - s } }),
    "notUploadedWithin180s": uploadedAt.filter { $0 == nil }.count,
    "sampleEntry": entry(updates.appendingPathComponent("1.loro")),
  ]

  // B: eviction and what a placeholder looks like
  log("B evict")
  var evictResults: [JSONObject] = []
  let evictStart = Vault.now()
  for i in 1 ... 5 {
    let url = updates.appendingPathComponent("\(i).loro")
    let t0 = Vault.now()
    var r: JSONObject = ["file": "\(i).loro"]
    if i <= 3 {
      r["how"] = "brctl evict"
      r["brctl"] = shell("/usr/bin/brctl", ["evict", url.path])
    } else {
      r["how"] = "FileManager.evictUbiquitousItem"
      do { try Vault.evict(url) } catch { r["error"] = "\(error)" }
    }
    r["evictCallMs"] = Vault.now() - t0
    r["notDownloadedAfterMs"] = waitUntil(30000) { entry(url)["downloadingStatus"] as? String == "notDownloaded" } ?? "timeout"
    r["isDataless"] = entry(url)["isDataless"] ?? "?"
    evictResults.append(r)
  }
  let evicted = updates.appendingPathComponent("1.loro")
  report["B_evict"] = [
    "perFile": evictResults,
    "placeholder": [
      "entry": entry(evicted),
      "fileExists": FileManager.default.fileExists(atPath: evicted.path),
      "rawNamesInDir": (try? Vault.rawNames(updates).map { $0["name"]! }) ?? [],
      "dotIcloudStubPresent": FileManager.default.fileExists(atPath: updates.appendingPathComponent(".1.loro.icloud").path),
      "lsLO": shell("/bin/ls", ["-lO@", evicted.path])["output"]!,
      "statFlags": shell("/usr/bin/stat", ["-f", "size=%z blocks=%b flags=%Sf", evicted.path])["output"]!,
      "xattrs": xattrNames(evicted.path),
    ],
    "watcherEventsFile1": eventKinds(watcher.events, suffix: "/1.loro", from: evictStart, to: Vault.now()),
  ]

  // C: getting evicted files back
  log("C download")
  let downloadStart = Vault.now()
  var downloads: [JSONObject] = []
  for i in 1 ... 2 {
    let url = updates.appendingPathComponent("\(i).loro")
    let t0 = Vault.now()
    var r: JSONObject = ["file": "\(i).loro", "how": "startDownloadingUbiquitousItem"]
    do {
      try Vault.startDownloading(url)
      r["currentAfterMs"] = waitUntil(60000) { entry(url)["downloadingStatus"] as? String == "current" } ?? "timeout"
      r["bytesMatch"] = (try? Data(contentsOf: url)) == originals[i - 1]
    } catch { r["error"] = "\(error)" }
    r["watcherEvents"] = eventKinds(watcher.events, suffix: "/\(i).loro", from: t0, to: Vault.now())
    downloads.append(r)
  }
  do {
    let url = updates.appendingPathComponent("3.loro")
    let t0 = Vault.now()
    let data = try? Vault.read(url)
    downloads.append(["file": "3.loro", "how": "coordinated read of evicted file", "ms": Vault.now() - t0, "bytesMatch": data == originals[2], "statusAfter": entry(url)["downloadingStatus"] ?? "?"])
  }
  do {
    let url = updates.appendingPathComponent("4.loro")
    let t0 = Vault.now()
    let data = try? Data(contentsOf: url)
    downloads.append(["file": "4.loro", "how": "plain uncoordinated read of evicted file", "ms": Vault.now() - t0, "bytesMatch": data == originals[3], "statusAfter": entry(url)["downloadingStatus"] ?? "?"])
  }
  usleep(2_000_000)
  let untouched = entry(updates.appendingPathComponent("5.loro"))
  report["C_download"] = ["perFile": downloads, "untouchedEvictedFileAfter2s": ["downloadingStatus": untouched["downloadingStatus"] ?? "?", "isDataless": untouched["isDataless"] ?? "?"], "durationMs": Vault.now() - downloadStart]

  // D: conflict versions
  log("D conflicts")
  var conflictCounts = 0
  var otherVersionCounts = 0
  for i in 1 ... count {
    let url = updates.appendingPathComponent("\(i).loro")
    conflictCounts += Vault.conflicts(url).count
    otherVersionCounts += Vault.otherVersions(url).count
  }
  report["D_conflicts"] = ["unresolvedConflictVersions": conflictCounts, "otherVersions": otherVersionCounts, "note": "a real conflict needs a second device writing the same file"]

  // E: Unicode normalization
  log("E unicode")
  let names = run.appendingPathComponent("names", isDirectory: true)
  let unicodeStart = Vault.now()
  try! Vault.writeAtomic(Data("nfc".utf8), to: names.appendingPathComponent("caf\u{e9}-nfc.md"))
  try! Vault.writeAtomic(Data("nfd".utf8), to: names.appendingPathComponent("cafe\u{301}-nfd.md"))
  try! Vault.writeAtomic(Data("A".utf8), to: names.appendingPathComponent("x-\u{e9}.md"))
  try! Vault.writeAtomic(Data("B".utf8), to: names.appendingPathComponent("x-e\u{301}.md"))
  let nfdURL = names.appendingPathComponent("cafe\u{301}-nfd.md")
  let nfdUploaded = waitUntil(60000) { isUploaded(nfdURL) }
  let rawBefore = (try? Vault.rawNames(names)) ?? []
  try? Vault.evict(nfdURL)
  _ = waitUntil(30000) { entry(nfdURL)["downloadingStatus"] as? String == "notDownloaded" }
  try? Vault.startDownloading(nfdURL)
  _ = waitUntil(60000) { entry(nfdURL)["downloadingStatus"] as? String == "current" }
  let unicodeEvents = watcher.events.filter { ($0["path"] as? String)?.contains("/names/") == true && ($0["at"] as? Double ?? 0) >= unicodeStart }
  report["E_unicode"] = [
    "rawNamesAfterWrite": rawBefore,
    "rawNamesAfterEvictAndRedownload": (try? Vault.rawNames(names)) ?? [],
    "nfcThenNfdSameName_contentViaNFCPath": String(decoding: (try? Vault.read(names.appendingPathComponent("x-\u{e9}.md"))) ?? Data(), as: UTF8.self),
    "nfdFileUploadedMs": nfdUploaded ?? "timeout",
    "watcherReportedNames": Array(Set(unicodeEvents.compactMap { e in (e["path"] as? String).map { p in "\(e["source"]!):" + Vault.hex(URL(fileURLWithPath: p).lastPathComponent) } })).sorted(),
  ]

  // F: a file appearing while it is being written
  log("F partial writes")
  let growing = run.appendingPathComponent("growing", isDirectory: true)
  try! FileManager.default.createDirectory(at: growing, withIntermediateDirectories: true)
  let chunk = randomData(1 << 20, seed: 77)
  let chunks = 32
  for mode in ["nonAtomic", "atomic"] {
    let url = growing.appendingPathComponent("\(mode).bin")
    let t0 = Vault.now()
    var done = false
    let doneLock = NSLock()
    var observed: [JSONObject] = []
    let observer = Thread {
      var lastRead = 0.0
      while true {
        doneLock.lock()
        let finished = done
        doneLock.unlock()
        if finished { break }
        let e = entry(url)
        var o: JSONObject = ["t": Int(Vault.now() - t0)]
        o["size"] = e["size"]
        o["isUploading"] = e["isUploading"]
        o["isUploaded"] = e["isUploaded"]
        if Vault.now() - lastRead > 400 {
          lastRead = Vault.now()
          o["coordinatedReadBytes"] = (try? Vault.read(url))?.count ?? -1
        }
        observed.append(o)
        usleep(50000)
      }
    }
    observer.start()
    if mode == "nonAtomic" {
      FileManager.default.createFile(atPath: url.path, contents: nil)
      let handle = try! FileHandle(forWritingTo: url)
      for _ in 0 ..< chunks {
        handle.write(chunk)
        usleep(100_000)
      }
      try! handle.close()
    } else {
      var all = Data()
      for _ in 0 ..< chunks { all.append(chunk) }
      try! Vault.writeAtomic(all, to: url)
    }
    let writeDoneMs = Vault.now() - t0
    doneLock.lock()
    done = true
    doneLock.unlock()
    _ = waitUntil(5000) { observer.isFinished }
    let uploadedMs = waitUntil(120_000, every: 100) { isUploaded(url) }.map { $0 + writeDoneMs }
    let full = chunks << 20
    let readSizes = observed.compactMap { $0["coordinatedReadBytes"] as? Int }
    report["F_\(mode)"] = [
      "bytes": full,
      "writeDoneMs": writeDoneMs,
      "uploadedMs": uploadedMs ?? "timeout",
      "uploadingBeforeWriteDone": observed.contains { $0["isUploading"] as? Bool == true },
      "uploadedBeforeWriteDone": observed.contains { $0["isUploaded"] as? Bool == true },
      "partialSizesSeenByStat": Array(Set(observed.compactMap { $0["size"] as? Int }.filter { $0 != full })).sorted(),
      "coordinatedReadSizes": Array(Set(readSizes)).sorted(),
      "watcherEvents": eventKinds(watcher.events, suffix: "/\(mode).bin", from: t0, to: Vault.now()).count,
    ]
  }

  // G: rapid successive writes
  log("G rapid writes")
  let page = run.appendingPathComponent("mirror/page.md")
  let rapidStart = Vault.now()
  var overwriteMs: [Double] = []
  for i in 0 ..< 200 {
    let t0 = Vault.now()
    try! Vault.writeAtomic(Data("v\(i)".utf8), to: page)
    overwriteMs.append(Vault.now() - t0)
  }
  let lastWrite = Vault.now()
  let pageUploaded = waitUntil(120_000, every: 50) { isUploaded(page) }
  let pageEvents = watcher.events.filter { ($0["path"] as? String)?.hasSuffix("/mirror/page.md") == true && ($0["at"] as? Double ?? 0) >= rapidStart }
  let burst = run.appendingPathComponent("updates/mac-cli-burst", isDirectory: true)
  let burstStart = Vault.now()
  for i in 0 ..< 300 { try! Vault.writeAtomic(randomData(1024, seed: UInt64(1000 + i)), to: burst.appendingPathComponent("\(i).loro")) }
  let burstWriteMs = Vault.now() - burstStart
  let allUploaded = waitUntil(240_000, every: 250) { ((try? Vault.list(burst)) ?? []).filter { $0["isUploaded"] as? Bool == true }.count == 300 }
  let burstEvents = watcher.events.filter { ($0["path"] as? String)?.contains("/mac-cli-burst/") == true }
  let countFrom = { (events: [JSONObject], source: String) -> Int in events.filter { $0["source"] as? String == source }.count }
  let overwrite: JSONObject = [
    "perWriteMs": stats(overwriteMs),
    "finalContent": String(decoding: (try? Vault.read(page)) ?? Data(), as: UTF8.self),
    "lastWriteToIsUploadedMs": pageUploaded ?? "timeout",
    "presenterEvents": countFrom(pageEvents, "presenter"),
    "queryEvents": countFrom(pageEvents, "query"),
  ]
  let newFiles: JSONObject = [
    "writeAllMs": burstWriteMs,
    "allUploadedAfterLastWriteMs": allUploaded ?? "timeout",
    "presenterEvents": countFrom(burstEvents, "presenter"),
    "queryEvents": countFrom(burstEvents, "query"),
    "leftoverTempFiles": ((try? Vault.rawNames(burst)) ?? []).count - 300,
  ]
  report["G_rapid"] = ["overwriteSameFile200": overwrite, "newFiles300": newFiles]

  watcher.stop()
  report["eventTotals"] = Dictionary(grouping: watcher.events) { "\($0["source"]!):\($0["kind"]!)" }.mapValues { $0.count }
  if !keep { try? Vault.remove(run) }
  report["kept"] = keep
  printJSON(report, pretty: true)
}

func scratchDir(_ root: URL, _ prefix: String) -> URL {
  let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
  let dir = root.appendingPathComponent("\(prefix)-\(stamp)", isDirectory: true)
  try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir
}

func latency(root: URL, count: Int, keep: Bool) {
  let dir = scratchDir(root, "latency")
  let watcher = try! WatcherProcess(dir: dir, scope: "none")
  guard watcher.waitFor(30000, { $0["kind"] as? String == "ready" }) != nil else { fail("watcher did not start") }

  func run(_ name: (Int) -> String) -> JSONObject {
    var writeMs: [Double] = []
    var eventMs: [Double] = []
    for i in 0 ..< count {
      let suffix = "/\(name(i))"
      let t0 = Vault.now()
      try! Vault.writeAtomic(randomData(4096, seed: UInt64(i + 1)), to: dir.appendingPathComponent(name(i)))
      writeMs.append(Vault.now() - t0)
      if let e = watcher.waitFor(2000, { ($0["path"] as? String)?.hasSuffix(suffix) == true && ($0["at"] as? Double ?? 0) >= t0 }) {
        eventMs.append(e["at"] as! Double - t0)
      }
      usleep(100_000)
    }
    return ["writeMs": stats(writeMs), "writeToPresenterEventMs": stats(eventMs), "missedEvents": count - eventMs.count]
  }

  let created = run { "new-\($0).loro" }
  let overwritten = run { _ in "same.md" }
  let file = dir.appendingPathComponent("same.md")
  var coordinated: [Double] = []
  var plain: [Double] = []
  for _ in 0 ..< count {
    var t0 = Vault.now()
    _ = try! Vault.read(file)
    coordinated.append(Vault.now() - t0)
    t0 = Vault.now()
    _ = try! Data(contentsOf: file)
    plain.append(Vault.now() - t0)
  }
  watcher.stop()
  if !keep { try? Vault.remove(dir) }
  printJSON([
    "dir": root.path,
    "isUbiquitous": entry(root)["isUbiquitous"] ?? false,
    "files": count,
    "newFile4KB": created,
    "overwrite4KB": overwritten,
    "coordinatedReadMs": stats(coordinated),
    "plainReadMs": stats(plain),
  ], pretty: true)
}

func posixWrite(_ path: String, _ text: String) {
  let fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0o644)
  guard fd >= 0 else { fail("open \(path): \(String(cString: strerror(errno)))") }
  _ = text.withCString { write(fd, $0, strlen($0)) }
  close(fd)
}

func names(root: URL, keep: Bool) {
  let dir = scratchDir(root, "names")
  let forms = ["nfc": "caf\u{e9}", "nfd": "cafe\u{301}"]
  var written: [String] = []
  for (form, word) in forms.sorted(by: { $0.key < $1.key }) {
    let viaURL = "url-\(form)-\(word).md"
    let viaString = "posix-\(form)-\(word).md"
    try! Vault.writeAtomic(Data(form.utf8), to: dir.appendingPathComponent(viaURL))
    posixWrite(dir.path + "/" + viaString, form)
    written += [viaURL, viaString]
  }
  let onDisk = { () -> [String: String] in
    Dictionary(uniqueKeysWithValues: (try! Vault.rawNames(dir)).map { ($0["hex"] as! String, ($0["nfc"] as! Bool) ? "NFC" : "NFD") })
  }
  var report: JSONObject = [
    "dir": root.path,
    "writtenHex": written.map { "\($0.split(separator: "-").prefix(2).joined(separator: "-")) \(Vault.hex($0))" },
    "onDiskImmediately": onDisk(),
    "swiftStringNfcEqualsNfd": forms["nfc"]! == forms["nfd"]!,
    "posixNfcFileOpenedViaNfdPath": (try? String(contentsOfFile: dir.path + "/posix-nfc-" + forms["nfd"]! + ".md", encoding: .utf8)) ?? "missing",
  ]
  if entry(dir)["isUbiquitous"] as? Bool == true {
    let files = { (try? Vault.list(dir).map { URL(fileURLWithPath: $0["path"] as! String) }) ?? [] }
    report["uploadedAfterMs"] = waitUntil(120_000, every: 250) { files().allSatisfy(isUploaded) } ?? "timeout"
    report["onDiskAfterUpload"] = onDisk()
    files().forEach { try? Vault.evict($0) }
    _ = waitUntil(30000) { files().allSatisfy { entry($0)["downloadingStatus"] as? String == "notDownloaded" } }
    report["onDiskWhileEvicted"] = onDisk()
    files().forEach { try? Vault.startDownloading($0) }
    _ = waitUntil(60000) { files().allSatisfy { entry($0)["downloadingStatus"] as? String == "current" } }
    report["onDiskAfterRedownload"] = onDisk()
  }
  if !keep { try? Vault.remove(dir) }
  printJSON(report, pretty: true)
}

var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String, _ fallback: String) -> String {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return fallback }
  defer { args.removeSubrange(i ... i + 1) }
  return args[i + 1]
}
let scope = option("--scope", "path")
let count = Int(option("--count", "50"))!
let keep = args.contains("--keep")
args.removeAll { $0 == "--keep" }

guard args.count >= 2 else {
  fail("usage: vaultctl probe|latency|names|watch|ls|raw|status|read|write|evict|download|conflicts <path> [--scope path|ubiquitous-docs|ubiquitous-external|none] [--count n] [--keep]")
}
let url = URL(fileURLWithPath: (args[1] as NSString).expandingTildeInPath)

do {
  switch args[0] {
  case "probe": probe(root: url, scope: scope, keep: keep)
  case "latency": latency(root: url, count: count, keep: keep)
  case "names": names(root: url, keep: keep)
  case "watch": runWatcher(dir: url, scope: scope)
  case "ls": printJSON(try Vault.list(url), pretty: true)
  case "raw": printJSON(try Vault.rawNames(url), pretty: true)
  case "status": printJSON(try Vault.status(url), pretty: true)
  case "read": printJSON(["bytes": try Vault.read(url).count])
  case "write": try Vault.writeAtomic(Data((args.count > 2 ? args[2] : "").utf8), to: url)
  case "evict": try Vault.evict(url)
  case "download": try Vault.startDownloading(url)
  case "conflicts": printJSON(["unresolved": Vault.conflicts(url), "other": Vault.otherVersions(url)], pretty: true)
  default: fail("unknown command \(args[0])")
  }
} catch {
  fail("\(error)")
}
