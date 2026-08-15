// Is this element's text actually being clipped by CSS right now?
//
// Exists so a reveal-on-hover affordance can be offered ONLY when there is something hidden to
// reveal. Without it, a hover card fires on every value in the toolbar, including the short ones,
// and pops up a card that repeats what is already fully on screen -- which reads as a bug rather
// than as help.
//
// Measured rather than guessed from a character count: the clip is done by `text-overflow: ellipsis`
// against a `max-width`, so whether it happens depends on the rendered width of the glyphs and on
// how much room the header has left, neither of which a length threshold can know.

import { useLayoutEffect, useRef, useState } from 'react';


/**
 * @param {string} text The rendered text. Re-measures when it changes -- a ResizeObserver alone
 *                      would not, because swapping a long value for a longer one inside a
 *                      max-width'd box changes no box the observer is watching.
 * @returns {[React.RefObject, boolean]} Ref for the clipping element, and whether it is clipping.
 */
export default function useIsTruncated(text) {
  const ref = useRef(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;

    if (!node) {
      return undefined;
    }

    // Both axes, because the viewer clips text two ways: a header value against a max-width with
    // `text-overflow: ellipsis` (overflows horizontally), and a table cell with
    // `-webkit-line-clamp` (overflows vertically, at its full width). Checking only the width missed
    // the second entirely.
    //
    // The 1px slack absorbs sub-pixel rounding: a fractional layout size leaves the scroll dimension
    // a hair above the client one on text that is not clipped at all, which would offer a card
    // revealing nothing.
    const measure = () =>
      setIsTruncated(node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);

    measure();

    // Re-measure as the header reflows -- the value is clipped against a max-width inside a flex
    // row, so a narrower window can start clipping text that fitted a moment ago.
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(measure);

    observer.observe(node);

    return () => observer.disconnect();
  }, [text]);

  return [ref, isTruncated];
}
