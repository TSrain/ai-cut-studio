/** Bind only OS file drags; leave existing in-app media drags untouched. */
export function bindProjectMediaDrop(target, {isDisabled, onActive, onFiles}) {
  let depth = 0, active = false;
  const setActive = value => {
    if (active !== value) { active = value; onActive(value); }
  };
  const isFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const capture = event => { event.preventDefault(); event.stopPropagation(); };
  const handlers = {
    dragenter(event) {
      if (!isFiles(event)) return;
      capture(event);
      depth++;
      setActive(!isDisabled());
    },
    dragover(event) {
      if (!isFiles(event)) return;
      capture(event);
      event.dataTransfer.dropEffect = isDisabled() ? 'none' : 'copy';
    },
    dragleave(event) {
      if (!isFiles(event)) return;
      capture(event);
      depth = Math.max(0, depth - 1);
      if (!depth) setActive(false);
    },
    drop(event) {
      if (!isFiles(event)) return;
      capture(event);
      depth = 0;
      setActive(false);
      if (isDisabled()) return;
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) onFiles(files);
    },
  };
  for (const [type, handler] of Object.entries(handlers)) target.addEventListener(type, handler);
  return () => {
    for (const [type, handler] of Object.entries(handlers)) target.removeEventListener(type, handler);
    setActive(false);
  };
}
