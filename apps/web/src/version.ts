import { Schema } from "effect"

export const revision = Schema.decodeUnknownSync(Schema.String)(
  import.meta.env["VITE_SEQNO_REVISION"] ?? "dev",
)

export const homepage = "https://seqno.vercel.app"
