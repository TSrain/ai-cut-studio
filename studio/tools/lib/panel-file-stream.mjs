import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream';

/** Stream a response body without leaving file descriptors behind on video seeks. */
export function pipePanelFile(req, res, file, options) {
  // Headers (including Content-Length/Range) are owned by the route. HEAD must
  // not open a source stream just to discard its body in ServerResponse.
  if (req.method === 'HEAD') {
    res.end();
    return null;
  }
  if (req.aborted || res.destroyed) return null;
  const source = createReadStream(file, options);
  // pipe() alone leaves a paused source open when the browser cancels a range.
  // pipeline destroys both ends on disconnect/read failure and handles errors
  // even when headers have already been sent, so no second response is written.
  pipeline(source, res, () => {});
  return source;
}
