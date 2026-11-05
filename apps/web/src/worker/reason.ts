export const hasReason = (cause: unknown): cause is { readonly reason: unknown } =>
  typeof cause === "object" && cause !== null && "reason" in cause
