import { NativeModule, requireNativeModule } from 'expo';

import type { FileVersionInfo, RawName, SeqnoVaultModuleEvents, UbiquityInfo, VaultEntry } from './SeqnoVault.types';

declare class SeqnoVaultModule extends NativeModule<SeqnoVaultModuleEvents> {
  documentsDir(): Promise<string>;
  ubiquityInfo(): Promise<UbiquityInfo>;
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<VaultEntry[]>;
  status(path: string): Promise<VaultEntry>;
  rawNames(dir: string): Promise<RawName[]>;
  startDownloading(path: string): Promise<void>;
  evict(path: string): Promise<void>;
  conflicts(path: string): Promise<FileVersionInfo[]>;
  resolveConflicts(path: string): Promise<void>;
  watch(dir: string, presenter: boolean, query: boolean): Promise<number>;
  unwatch(id: number): Promise<void>;
}

export default requireNativeModule<SeqnoVaultModule>('SeqnoVault');
