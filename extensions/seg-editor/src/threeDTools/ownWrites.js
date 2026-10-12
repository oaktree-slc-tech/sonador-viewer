// Marks the labelmap writes the 3D tools make for their own surface edits (a queued write, and a
// surface edit's undo and redo), so a listener can tell them from a foreign edit of the working
// labelmap (a slice edit, an import). Cornerstone3D raises its data-modified event synchronously
// inside the write, so the mark is in place while listeners run.

let depth = 0;

/** Run `fn` as one of the 3D tools' own labelmap writes. */
export function withOwnSurfaceWrite(fn) {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}

/** Whether a labelmap write being made now is one of the 3D tools' own. */
export function isOwnSurfaceWrite() {
  return depth > 0;
}
