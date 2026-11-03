import { Effect, Option, SubscriptionRef } from "effect"
import type { DeviceId } from "@seqno/domain"
import type { MirrorWriter } from "@seqno/rpc"
import {
  covers,
  type MirrorClaim,
  type SeenDevice,
  type SyncReport,
  type Version,
} from "@seqno/vault"

export interface WriterState {
  readonly mayWrite: boolean
  readonly writer: MirrorWriter | null
  readonly previous: Option.Option<Version>
}

export interface Pick {
  readonly writer: DeviceId | null
  readonly highest: number
  readonly others: ReadonlyArray<SeenDevice>
}

const ahead = (a: SeenDevice, b: SeenDevice) =>
  (a.mirror?.claim ?? 0) - (b.mirror?.claim ?? 0) || (a.device < b.device ? 1 : -1)

export const pickWriter = (
  me: DeviceId,
  devices: ReadonlyArray<SeenDevice>,
  lineage: string | null,
): Pick => {
  const others = devices.filter(
    (one) => one.device !== me && (lineage === null || (one.vv[lineage] ?? 0) > 0),
  )
  const claimed = [...devices.filter((one) => one.device === me), ...others].filter(
    (one) => one.mirror !== null && one.mirror.claim > 0,
  )
  const [top] = claimed.toSorted((a, b) => ahead(b, a))
  return {
    writer: top?.device ?? null,
    highest: top?.mirror?.claim ?? 0,
    others,
  }
}

export interface Writers {
  readonly state: SubscriptionRef.SubscriptionRef<WriterState>
  readonly heard: (report: SyncReport, lineage: string | null) => Effect.Effect<boolean>
  readonly takeOver: Effect.Effect<void>
  readonly mirrorVersion: (version: Option.Option<Version>) => Effect.Effect<void>
}

export const makeWriters = (options: {
  readonly me: DeviceId
  readonly synced: boolean
  readonly setMirror: (claim: MirrorClaim) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const { me } = options
    const state = yield* SubscriptionRef.make<WriterState>({
      mayWrite: !options.synced,
      writer: null,
      previous: Option.none(),
    })
    const none: Version = {}
    const mine = { claim: 0, version: none, highest: 0 }

    const publish = (claim: number) =>
      Effect.andThen(
        Effect.sync(() => {
          mine.claim = claim
        }),
        options.setMirror({ claim, version: mine.version }),
      )

    const heard = (report: SyncReport, lineage: string | null) =>
      Effect.gen(function* () {
        if (!options.synced) return false
        const own = report.devices.find((one) => one.device === me)
        if (own?.mirror !== undefined && own.mirror !== null && mine.claim === 0) {
          mine.claim = own.mirror.claim
          mine.version = own.mirror.version
        }
        const settled = report.unread === 0 && report.waiting.length === 0
        const picked = pickWriter(me, report.devices, lineage)
        mine.highest = picked.highest
        if (picked.writer === null && settled) yield* publish(1)
        const writer = picked.writer ?? (mine.claim > 0 ? me : null)
        const before = yield* SubscriptionRef.get(state)
        const previous = Option.fromUndefinedOr(
          picked.others
            .filter((one) => one.mirror !== null)
            .toSorted(ahead)
            .at(-1)?.mirror?.version,
        )
        const next: WriterState = {
          mayWrite: writer === me && settled,
          writer:
            picked.others.length === 0 || writer === null
              ? null
              : { device: writer, here: writer === me },
          previous,
        }
        yield* SubscriptionRef.set(state, next)
        return next.mayWrite && !before.mayWrite
      })

    const takeOver = Effect.suspend(() => publish(Math.max(mine.claim, mine.highest) + 1))

    const mirrorVersion = (version: Option.Option<Version>) =>
      Effect.gen(function* () {
        const { mayWrite } = yield* SubscriptionRef.get(state)
        if (!mayWrite || Option.isNone(version) || mine.claim === 0) return
        mine.version = version.value
        yield* options.setMirror({ claim: mine.claim, version: version.value })
      })

    return { state, heard, takeOver, mirrorVersion } satisfies Writers
  })

export const staleSince = (own: Option.Option<Version>, previous: Option.Option<Version>) =>
  Option.isSome(previous) && (Option.isNone(own) || !covers(own.value, previous.value))

const opsOf = (vv: Readonly<Record<string, number>>) =>
  Object.values(vv).reduce((sum, ops) => sum + ops, 0)

export const outweighed = (
  me: DeviceId,
  root: string,
  report: SyncReport,
  own: ReadonlyMap<string, number>,
) => {
  const others = report.devices.filter((one) => one.device !== me)
  const weight = (lineage: string) => {
    const members = others.filter((one) => (one.vv[lineage] ?? 0) > 0)
    return [members.length, Math.max(0, ...members.map((one) => opsOf(one.vv)))] as const
  }
  const [alongside] = weight(root)
  const mine = [1, opsOf(Object.fromEntries(own))] as const
  return (
    alongside === 0 &&
    report.foreignRoots.some((other) => {
      const [count, ops] = weight(other)
      return (
        count > mine[0] ||
        (count === mine[0] && (ops > mine[1] || (ops === mine[1] && other < root)))
      )
    })
  )
}
