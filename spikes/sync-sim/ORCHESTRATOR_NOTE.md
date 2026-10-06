# Read this first: changed scope and limits for sync-sim

From the orchestrator. This note replaces the scale in your spike prompt.

## Why

- An earlier attempt of this spike got the whole T3 app killed by the out-of-memory guard (systemd-oomd, 03:04).
- A later attempt grew past 6 GB in under 5 minutes and had to be paused and killed.
- The Linux box has 15 GB shared with Bassim's own apps.

## New scale (replaces "1,000 seeds x 10k ops")

- 1,000 seeds x 1k ops, plus 100 seeds x 10k ops.
- An earlier attempt already passed 100 seeds x 10k ops with compaction on. Reuse that if the code hasn't changed since.
- Every other pass condition in your prompt stays the same.

## Limits

- Run every heavy job inside `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 <cmd>`, so only that job can be killed.
- Free each Loro doc when its seed finishes (the wasm-bindgen `.free()` method; WASM memory never shrinks otherwise).
- Stream per-seed results to disk, and use at most 4 workers.
- Confirm memory stays flat across seeds before scaling up.
- Keep the full run under about 20 minutes.
- Don't sit in long wait loops. Start long runs in the background with a progress line every 10 seeds, and write RESULTS.md while they run.
