import { Platform } from 'react-native';

import Vault, { type VaultEvent } from '../modules/seqno-vault';

type Check = { name: string; ok: boolean; detail?: unknown };

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomBytes = (length: number, seed: number) => {
  const next = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (next() * 256) | 0;
  return out;
};

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const unascii = (b: Uint8Array) => String.fromCharCode(...b);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 100) / 100;

const percentile = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

const timed = async <T,>(f: () => Promise<T>): Promise<[T, number]> => {
  const start = performance.now();
  const value = await f();
  return [value, performance.now() - start];
};

const settle = async (f: () => Promise<unknown>) => {
  try {
    await f();
    return 'ok';
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
};

export async function runSuite() {
  const startedAt = Date.now();
  const checks: Check[] = [];
  const metrics: Record<string, unknown> = {};
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });

  const events: VaultEvent[] = [];
  const subscription = Vault.addListener('onVaultEvent', (e) => events.push(e));
  const waitForEvent = async (match: (e: VaultEvent) => boolean, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = events.find(match);
      if (hit) return hit;
      await sleep(5);
    }
    return undefined;
  };

  const docs = await Vault.documentsDir();
  const root = `${docs}/vault-e2e`;
  await Vault.remove(root).catch(() => {});

  metrics.ubiquity = await Vault.ubiquityInfo();

  const updates = `${root}/updates/sim-device`;
  const payloads = [1, 2, 3].map((n) => randomBytes(4096 * n, n));
  const writeMs: number[] = [];
  for (const [i, p] of payloads.entries()) {
    const [, ms] = await timed(() => Vault.writeAtomic(`${updates}/${i + 1}.loro`, p));
    writeMs.push(round(ms));
  }
  const readBack = await Promise.all(payloads.map((_, i) => Vault.read(`${updates}/${i + 1}.loro`)));
  check('coordinated atomic write -> coordinated read returns identical bytes', readBack.every((b, i) => sameBytes(b, payloads[i])), {
    returnedType: Object.prototype.toString.call(readBack[0]),
    sizes: readBack.map((b) => b.length),
    writeMs,
  });

  const big = randomBytes(64 * 1024, 99);
  await Vault.writeAtomic(`${updates}/1.loro`, big);
  check('atomic overwrite replaces content', sameBytes(await Vault.read(`${updates}/1.loro`), big));

  const listing = await Vault.list(updates);
  check(
    'list returns exactly the written files (no temp files left behind) with resource-key status',
    listing.map((e) => e.name).join(',') === '1.loro,2.loro,3.loro' && listing.every((e) => e.isUbiquitous === false),
    listing.map(({ name, size, isUbiquitous, downloadingStatus, isDataless }) => ({ name, size, isUbiquitous, downloadingStatus, isDataless })),
  );

  const presenterId = await Vault.watch(updates, true, false);
  const forFile = (name: string, kinds: string[]) => (e: VaultEvent) =>
    e.watchId === presenterId && !!e.path?.endsWith(`/${name}`) && kinds.includes(e.kind);
  const tNew = Date.now();
  await Vault.writeAtomic(`${updates}/4.loro`, randomBytes(4096, 4));
  const appeared = await waitForEvent(forFile('4.loro', ['appeared', 'changed']), 3000);
  const tChange = Date.now();
  await Vault.writeAtomic(`${updates}/4.loro`, randomBytes(8192, 5));
  const changed = await waitForEvent((e) => e !== appeared && forFile('4.loro', ['changed'])(e) && e.at >= tChange, 3000);
  const tDelete = Date.now();
  await Vault.remove(`${updates}/4.loro`);
  const deleted = await waitForEvent((e) => e !== appeared && e !== changed && forFile('4.loro', ['changed', 'deleting'])(e) && e.at >= tDelete, 3000);
  check('NSFilePresenter reports new / overwritten / deleted files from coordinated writes', !!appeared && !!changed && !!deleted, {
    newFile: appeared && { kind: appeared.kind, latencyMs: appeared.at - tNew },
    overwrite: changed && { kind: changed.kind, latencyMs: changed.at - tChange },
    delete: deleted && { kind: deleted.kind, latencyMs: deleted.at - tDelete },
    allKinds: events.filter((e) => e.watchId === presenterId).map((e) => e.kind),
  });

  const queryId = await Vault.watch(updates, false, true);
  await Vault.writeAtomic(`${updates}/5.loro`, randomBytes(1024, 6));
  await sleep(2000);
  metrics.metadataQueryOnLocalFolder = events.filter((e) => e.watchId === queryId).map(({ kind, count }) => ({ kind, count }));
  await Vault.unwatch(queryId);

  metrics.startDownloadingOnLocalFile = await settle(() => Vault.startDownloading(`${updates}/2.loro`));
  metrics.evictOnLocalFile = await settle(() => Vault.evict(`${updates}/2.loro`));
  const conflicts = await Vault.conflicts(`${updates}/2.loro`);
  check('NSFileVersion conflict detection runs (none expected locally)', Array.isArray(conflicts) && conflicts.length === 0, conflicts);
  check('resolveConflicts is a no-op without conflicts', (await settle(() => Vault.resolveConflicts(`${updates}/2.loro`))) === 'ok');

  const names = `${root}/names`;
  const nfc = 'caf\u00e9-nfc.md';
  const nfd = 'cafe\u0301-nfd.md';
  await Vault.writeAtomic(`${names}/${nfc}`, ascii('nfc'));
  await Vault.writeAtomic(`${names}/${nfd}`, ascii('nfd'));
  await Vault.writeAtomic(`${names}/x-\u00e9.md`, ascii('A'));
  await Vault.writeAtomic(`${names}/x-e\u0301.md`, ascii('B'));
  const raw = await Vault.rawNames(names);
  const xEntries = raw.filter((r) => r.name.startsWith('x-'));
  metrics.unicode = {
    raw,
    nfcNamePreserved: raw.some((r) => r.name.startsWith('caf') && r.nfc && r.name.endsWith('-nfc.md')),
    nfdNamePreserved: raw.some((r) => r.name.endsWith('-nfd.md') && !r.nfc),
    nfcThenNfdSameName: { entries: xEntries.length, storedAs: xEntries.map((r) => (r.nfc ? 'NFC' : 'NFD')), contentViaNfcPath: unascii(await Vault.read(`${names}/x-\u00e9.md`)) },
  };

  const rapid = `${root}/rapid`;
  await Vault.writeAtomic(`${rapid}/head.md`, ascii('v-init'));
  const rapidWatch = await Vault.watch(rapid, true, false);
  const overwriteMs: number[] = [];
  for (let i = 0; i < 200; i++) {
    const [, ms] = await timed(() => Vault.writeAtomic(`${rapid}/head.md`, ascii(`v${i}`)));
    overwriteMs.push(ms);
  }
  await sleep(500);
  const finalHead = unascii(await Vault.read(`${rapid}/head.md`));
  const headEvents = events.filter((e) => e.watchId === rapidWatch && e.path?.endsWith('/head.md')).length;
  check('200 rapid sequential overwrites: last write wins', finalHead === 'v199', {
    p50Ms: percentile(overwriteMs, 50),
    p95Ms: percentile(overwriteMs, 95),
    maxMs: percentile(overwriteMs, 100),
    presenterEventsForHead: headEvents,
  });

  const [, burstMs] = await timed(() =>
    Promise.all(Array.from({ length: 200 }, (_, i) => Vault.writeAtomic(`${rapid}/burst/${i}.loro`, randomBytes(512, 1000 + i)))),
  );
  const burstList = await Vault.list(`${rapid}/burst`);
  check('200 concurrent new-file writes all land, no temp files', burstList.length === 200, { totalMs: round(burstMs), files: burstList.length });
  await Vault.unwatch(rapidWatch);

  const growing = `${root}/growing/big.loro`;
  const versions = [randomBytes(24 * 1024 * 1024, 7), randomBytes(32 * 1024 * 1024, 8)];
  await Vault.writeAtomic(growing, versions[0]);
  const fullSizes = new Set(versions.map((v) => v.length));
  const sizesSeen = new Set<number>();
  const readSizes = new Set<number>();
  let polls = 0;
  for (let round = 1; round <= 4; round++) {
    const next = versions[round % 2];
    let writing = true;
    const writer = Vault.writeAtomic(growing, next).finally(() => {
      writing = false;
    });
    while (writing) {
      polls++;
      const [entry, bytes] = await Promise.all([Vault.status(growing).catch(() => undefined), Vault.read(growing).catch(() => undefined)]);
      if (entry?.size !== undefined) sizesSeen.add(entry.size);
      if (bytes) readSizes.add(bytes.length);
    }
    await writer;
  }
  const final = await Vault.read(growing);
  check(
    '24/32 MB atomic overwrites never expose a partial file to stat or coordinated reads',
    [...sizesSeen, ...readSizes].every((s) => fullSizes.has(s)) && sameBytes(final, versions[0]),
    { polls, sizesSeenByStat: [...sizesSeen], sizesSeenByCoordinatedRead: [...readSizes] },
  );

  await Vault.unwatch(presenterId);
  subscription.remove();

  const passed = checks.filter((c) => c.ok).length;
  const report = {
    platform: { os: Platform.OS, version: Platform.Version },
    durationMs: Date.now() - startedAt,
    passed,
    total: checks.length,
    checks,
    metrics,
  };
  await Vault.writeAtomic(`${docs}/e2e-results.json`, ascii(JSON.stringify(report).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)));
  return report;
}
