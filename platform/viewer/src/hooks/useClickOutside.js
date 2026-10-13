import { useEffect } from 'react';

/**
 * Whether a pointer event's target lies outside every node in `nodes`.
 *
 * Pure, so the rule is testable without a renderer.
 */
export function isOutside(target, nodes) {
  if (!target) {
    return false;
  }

  return !nodes.some(node => node && node.contains(target));
}

/**
 * The DOM nodes behind `ref`, which is a single ref or an array of refs.
 */
export function refNodes(ref) {
  return (Array.isArray(ref) ? ref : [ref]).map(r => r?.current);
}

/**
 * Call `onOutside` when the user presses the pointer outside the referenced element(s), or presses
 * Escape, while `active` is true. Listeners are attached only while active so an idle control
 * costs nothing.
 *
 * Pass an array of refs when the control renders part of itself elsewhere in the DOM (a menu
 * portalled to the body, for example): a press inside any of them counts as "inside".
 *
 * @param {React.RefObject|React.RefObject[]} ref element(s) that count as "inside"
 * @param {function} onOutside called with the triggering event
 * @param {boolean} active whether to listen
 */
export default function useClickOutside(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const onPointerDown = event => {
      if (isOutside(event.target, refNodes(ref))) {
        onOutside(event);
      }
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onOutside(event);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, onOutside, active]);
}
