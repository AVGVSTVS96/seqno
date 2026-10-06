import { Crypto, Effect, Schema } from "effect"

export const BlockId = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("BlockId"))
export type BlockId = typeof BlockId.Type

export const PageId = Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand("PageId"))
export type PageId = typeof PageId.Type

export const DeviceId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)).pipe(
  Schema.brand("DeviceId"),
)
export type DeviceId = typeof DeviceId.Type

const uuidV7 = Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv7)

export const newBlockId = Effect.map(uuidV7, BlockId.make)

export const newPageId = Effect.map(uuidV7, PageId.make)
