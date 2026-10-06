export type DownloadingStatus = 'current' | 'downloaded' | 'notDownloaded';

export type VaultEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isUbiquitous: boolean;
  nameIsNFC: boolean;
  size?: number;
  allocatedSize?: number;
  modified?: number;
  downloadingStatus?: DownloadingStatus;
  isDownloading?: boolean;
  downloadRequested?: boolean;
  isUploaded?: boolean;
  isUploading?: boolean;
  hasUnresolvedConflicts?: boolean;
  downloadingError?: string;
  uploadingError?: string;
  isDataless?: boolean;
  blocks?: number;
};

export type RawName = { name: string; hex: string; nfc: boolean };

export type FileVersionInfo = {
  url: string;
  isConflict: boolean;
  isResolved: boolean;
  modified?: number;
  savingComputer?: string;
};

export type UbiquityInfo = { identityToken: boolean; containerURL?: string };

export type VaultEvent = {
  watchId: number;
  at: number;
  source: 'presenter' | 'query';
  kind: string;
  path?: string;
  [key: string]: unknown;
};

export type SeqnoVaultModuleEvents = {
  onVaultEvent: (event: VaultEvent) => void;
};
