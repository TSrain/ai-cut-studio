export function bindProjectMediaDrop(target: HTMLElement, options: {
  isDisabled: () => boolean;
  onActive: (active: boolean) => void;
  onFiles: (files: File[]) => void;
}): () => void;
