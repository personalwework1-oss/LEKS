import ExpoModulesCore
import Foundation

public class LeksCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LeksCrypto")

    /// Application Support/leks: private to the app and excluded from iCloud and computer backups.
    Function("stateDirectory") { () -> String in
      let base = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      var dir = base.appendingPathComponent("leks", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try dir.setResourceValues(values)
      return dir.path
    }

    /// Runs off the main thread; encryption never blocks the interface.
    AsyncFunction("call") { (request: String) -> String in
      let input = Array(request.utf8)
      var outLen: Int = 0
      let output = input.withUnsafeBufferPointer { buffer in
        leks_call(buffer.baseAddress, buffer.count, &outLen)
      }
      guard let output else {
        throw Exception(name: "LeksCryptoError", description: "the encryption core returned nothing")
      }
      defer { leks_free(output, outLen) }
      return String(decoding: UnsafeBufferPointer(start: output, count: outLen), as: UTF8.self)
    }
  }
}
