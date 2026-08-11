// Sidebar flyout surface (ohif-viewers#128).
//
// Composes the @ohif/ui-next Popover wrapper into the sidebar's own skin, the same way
// StudyListNG/components/StudyOfflineDetailsCard composes HoverCardContent: the primitive comes
// from ui-next (which sits inside the Tailwind @source list), the appearance comes entirely from a
// local CSS module, because Tailwind utilities authored under platform/viewer/src emit nothing.
//
// Both the navigation flyouts and the narrow-mode server picker render through this. Open/close is
// not owned here — the caller drives it with useFlyoutTrigger and passes `open`, `onOpenChange` and
// `contentProps` straight through, so there is one set of trigger semantics for every flyout.
//
// The anchor is a PopoverAnchor rather than a PopoverTrigger; see useFlyoutTrigger for why, and for
// where the focus restoration Radix would otherwise have provided now lives.

import React from 'react';
import { NavLink } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Popover, PopoverAnchor, PopoverContent, PopoverPortal } from '@ohif/ui-next';

import styles from './NavFlyout.module.scss';

export default function NavFlyout({
  open,
  onOpenChange,
  contentProps = {},
  anchor,
  header,
  items = [],
  onNavigate,
  children,
}) {
  const hasRows = children != null || items.length > 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverPortal>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className={styles.flyout}
          {...contentProps}
        >
          {header && (
            <div className={classNames(styles.header, { [styles.headerDivided]: hasRows })}>
              {header}
            </div>
          )}

          {/* The group rule is drawn on this wrapper so it runs continuously through the gaps
              between rows. Omitted entirely when there are none, per FR-18. */}
          {hasRows && (
            <div className={styles.group}>
              {children ||
                items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      classNames(styles.item, { [styles.active]: isActive })
                    }
                    onClick={onNavigate}
                  >
                    <span>{item.label}</span>
                  </NavLink>
                ))}
            </div>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

NavFlyout.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,

  /** Radix PopoverContent handlers supplied by useFlyoutTrigger (hover bridge, Escape, dismissal). */
  contentProps: PropTypes.object,

  /** The element the flyout is anchored to. Must accept a ref; carries the trigger props. */
  anchor: PropTypes.node.isRequired,

  /** Non-interactive first row. The section label in narrow mode; omitted in full mode. */
  header: PropTypes.node,

  /** Navigation rows, already filtered by permission. Ignored when `children` is supplied. */
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      to: PropTypes.string.isRequired,
      end: PropTypes.bool,
    })
  ),

  /** Called when a row is activated, so the caller can close the flyout (FR-13). */
  onNavigate: PropTypes.func,

  /** Arbitrary rows in place of `items` — the server picker supplies buttons rather than links. */
  children: PropTypes.node,
};
