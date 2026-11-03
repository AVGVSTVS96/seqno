import { describe, expect, it } from "vitest"
import { autoCheckDue, isNewer } from "../src/updates.ts"

describe("plugin updates", () => {
  it("compares marketplace versions the way semver.coerce does, with or without a v", () => {
    expect(
      [
        ["v2.4.3", "v2.4.2"],
        ["v2.4.2", "v2.4.3"],
        ["v2.4.3", "v2.4.3"],
        ["1.0.1", "v1.0"],
        ["v1.0", "1.0.0"],
        ["0.0.11", "0.0.5"],
        ["v1.10.0", "v1.9.9"],
        ["2.0.0", "v1.26.17"],
      ].map(([latest = "", current = ""]) => isNewer(latest, current)),
    ).toEqual([true, false, false, true, false, true, true, true])
  })

  it("checks automatically when it's on and twelve hours have passed since the last check", () => {
    const now = 1_800_000_000_000
    const hour = 60 * 60 * 1000
    expect([
      autoCheckDue(true, now),
      autoCheckDue(false, now),
      autoCheckDue(now - 11 * hour, now),
      autoCheckDue(now - 13 * hour, now),
    ]).toEqual([true, false, false, true])
  })
})
