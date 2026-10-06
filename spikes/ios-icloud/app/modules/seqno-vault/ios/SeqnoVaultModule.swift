import ExpoModulesCore

public class SeqnoVaultModule: Module {
  private var watchers: [Int: VaultWatcher] = [:]
  private var nextWatchId = 1

  public func definition() -> ModuleDefinition {
    Name("SeqnoVault")

    Events("onVaultEvent")

    AsyncFunction("documentsDir") { () -> String in
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].path
    }

    AsyncFunction("ubiquityInfo") { Vault.ubiquityInfo() }

    AsyncFunction("writeAtomic") { (path: String, data: Data) in
      try Vault.writeAtomic(data, to: URL(fileURLWithPath: path))
    }

    AsyncFunction("read") { (path: String) -> Data in
      try Vault.read(URL(fileURLWithPath: path))
    }

    AsyncFunction("remove") { (path: String) in
      try Vault.remove(URL(fileURLWithPath: path))
    }

    AsyncFunction("list") { (dir: String) in
      try Vault.list(URL(fileURLWithPath: dir, isDirectory: true))
    }

    AsyncFunction("status") { (path: String) in
      try Vault.status(URL(fileURLWithPath: path))
    }

    AsyncFunction("rawNames") { (dir: String) in
      try Vault.rawNames(URL(fileURLWithPath: dir, isDirectory: true))
    }

    AsyncFunction("startDownloading") { (path: String) in
      try Vault.startDownloading(URL(fileURLWithPath: path))
    }

    AsyncFunction("evict") { (path: String) in
      try Vault.evict(URL(fileURLWithPath: path))
    }

    AsyncFunction("conflicts") { (path: String) in
      Vault.conflicts(URL(fileURLWithPath: path))
    }

    AsyncFunction("resolveConflicts") { (path: String) in
      try Vault.resolveConflictsKeepingCurrent(URL(fileURLWithPath: path))
    }

    AsyncFunction("watch") { (dir: String, presenter: Bool, query: Bool) -> Int in
      let id = self.nextWatchId
      self.nextWatchId += 1
      let watcher = VaultWatcher(dir: URL(fileURLWithPath: dir, isDirectory: true)) { [weak self] event in
        self?.sendEvent("onVaultEvent", event.merging(["watchId": id, "at": Vault.now()]) { a, _ in a })
      }
      self.watchers[id] = watcher
      if presenter { watcher.startPresenter() }
      if query { watcher.startQuery(scope: NSMetadataQueryUbiquitousDocumentsScope) }
      return id
    }.runOnQueue(.main)

    AsyncFunction("unwatch") { (id: Int) in
      self.watchers.removeValue(forKey: id)?.stop()
    }.runOnQueue(.main)
  }
}
