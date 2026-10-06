import { Result, Schema } from "effect"

export class QueryError extends Schema.TaggedError<QueryError>()("QueryError", {
  message: Schema.String,
}) {}

export const fail = (message: string): never => {
  throw new QueryError({ message })
}

export const attempt = <A>(run: () => A): Result.Result<A, QueryError> =>
  Result.try({
    try: run,
    catch: (e) =>
      e instanceof QueryError
        ? e
        : new QueryError({ message: e instanceof Error ? e.message : String(e) }),
  })
