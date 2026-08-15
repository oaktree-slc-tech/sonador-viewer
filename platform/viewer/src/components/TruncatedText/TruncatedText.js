// A CSS-clipped value that reveals itself in full on hover.
//
// Built on ui-next's HoverCard, the same primitive the offline-cache indicator and the Download
// Manager rows use, so every "hover to see the rest" surface in the viewer is the same component
// with the same delay, the same charcoal panel and the same --overlay-line border. The alternative
// on offer was the browser's own `title` tooltip, which is what these values used before: it is
// unstyled, appears after a fixed second-long delay nothing can tune, and renders in the OS's system
// colours rather than the viewer's.
//
// The CLIPPING itself is still the caller's, passed in through `className`. Different surfaces clip
// differently -- a header value against a max-width with `text-overflow: ellipsis`, a table cell with
// `-webkit-line-clamp` -- and this component deliberately does not have an opinion about which, only
// that it is done in CSS against the full text rather than by shortening the string beforehand.

import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from '@ohif/ui-next';

import useIsTruncated from '../../hooks/useIsTruncated';

import styles from './TruncatedText.module.scss';


export default function TruncatedText({
  value,
  className,
  cardClassName,
  side = 'bottom',
  align = 'start',
  openDelay = 300,
}) {
  // The full value is always what is rendered; the caller's CSS decides how much of it is visible,
  // and the measurement decides whether there is anything left to reveal.
  //
  // An earlier version let a caller hand over a pre-shortened string. That was a mistake twice over:
  // it put the browser's native tooltip back on the element to carry the missing text -- the exact
  // affordance this component replaced, so both would fire -- and it left the remainder out of the
  // DOM entirely, where `title` is the only thing exposing it and nothing else can reach it.
  const [ref, isTruncated] = useIsTruncated(value);

  if (value === undefined || value === null || value === '') {
    return null;
  }

  return (
    <HoverCard openDelay={openDelay}>
      <HoverCardTrigger asChild>
        {/* Left non-focusable, matching every other HoverCard trigger in the viewer (and Radix's own
            default trigger, an href-less <a>, which is not tabbable either). Nothing is lost to
            assistive technology by that: the shortening is done entirely in CSS, so the full value is
            in the DOM and is the element's accessible name whatever is painted. The card is a
            sighted-user affordance, and deliberately the only one -- no `title` here. */}
        <span ref={ref} className={className}>
          {value}
        </span>
      </HoverCardTrigger>
      {/* Rendered only when the text is actually clipped. The TRIGGER is always mounted, so this
          appearing and disappearing never remounts the value itself or interrupts a hover in
          progress. */}
      {isTruncated && (
        <HoverCardPortal>
          <HoverCardContent
            side={side}
            align={align}
            className={classNames(styles.card, cardClassName)}
          >
            {value}
          </HoverCardContent>
        </HoverCardPortal>
      )}
    </HoverCard>
  );
}


TruncatedText.propTypes = {
  /** The full value. Rendered in full and shortened by CSS; also what the card shows. */
  value: PropTypes.string,
  /** The caller's clipping style -- max-width + overflow + text-overflow, or line-clamp. */
  className: PropTypes.string,
  /** Extra styling for the card, for a caller that needs it wider or narrower than the default. */
  cardClassName: PropTypes.string,
  side: PropTypes.string,
  align: PropTypes.string,
  openDelay: PropTypes.number,
};
