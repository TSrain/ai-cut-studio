export function artifactRootDefault(): string;
export function safeProjectId(id: string): string;
export function atomicJson(path: string, value: unknown): void;
export function atomicText(path: string, value: string): void;
export function withProjectLock<T>(root: string, id: string, fn: () => T): T;
export function validateProjectRoot(
  path: string,
  options?: { artifactRoot?: string },
): string;
export function canonicalPath(binding: {
  projectId: string;
  projectRoot: string;
}): string;
export function indexedPath(
  rootDir: string,
  id: string,
  options?: { artifactRoot?: string },
): string;
export function referencedPaths(document: unknown): string[];
export function snapshotReferences(
  document: unknown,
  dir: string,
  options?: { assetSourceRoot?: string; rootDir?: string; verify?: boolean },
): Array<{
  reference: string;
  hash: string;
  path: string;
  mirror: string;
  bytes: number;
  mtimeMs: number;
  ctimeMs: number;
}>;
export function restoreReferences(
  dir: string,
  options?: { assetSourceRoot?: string; rootDir?: string; verify?: boolean },
): void;
export function migrateDirectory(from: string, to: string): void;

export type InputArchive = {
  reference: string;
  hash: string;
  path: string;
  mirror: string;
  mirrorRelative: string | null;
  origin: string;
  bytes: number;
  mtimeMs: number;
  ctimeMs: number;
};
export function archivedReference(
  reference: string,
  dir: string,
  options?: { expectedHash?: string },
): InputArchive | undefined;
export function archiveInput(
  reference: string,
  source: string,
  dir: string,
  options?: { assetSourceRoot?: string; expectedHash?: string },
): Promise<InputArchive>;
export function registerInputArchives(
  records: InputArchive[],
  dir: string,
): void;
