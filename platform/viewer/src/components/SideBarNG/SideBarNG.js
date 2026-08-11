// Sonador Viewer sidebar (ohif-viewers#128).
//
// Two desktop modes, `full` (315px, unchanged from before this issue) and `narrow` (a 40px icon
// rail). Both are rendered from one NAV_ITEMS config rather than from hand-written per-item JSX,
// because the same navigation now has three renderings — the full rail, the narrow rail, and the
// flyouts — and keeping three copies of it in sync by hand is how the previous version drifted.
//
// Active state has a single source: react-router's own matchPath, run over the item and its
// children. It replaces the pair of disagreeing mechanisms that used to be here — NavLink's
// `isActive` for the label and a set of `location.pathname.endsWith(...)` booleans passed as an
// icon `fill` prop — which is why /worklist rendered a white Studies icon beside a grey Studies
// label. Icons now take their colour from the row through CSS `currentColor`, not from a prop.
//
// A section counts as active when it, or any of its permitted children, matches the location. The
// active section shows its sub-navigation inline (full mode) and never opens a flyout.

import React from 'react';
import { useSelector } from 'react-redux';
import { matchPath, NavLink, useLocation, useParams } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as ChevronIcon } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CollapseIcon } from '@ohif/ui/src/elements/Svg/svgs/sidebar-collapse.svg';
import { ReactComponent as ExpandIcon } from '@ohif/ui/src/elements/Svg/svgs/sidebar-expand.svg';
import { ReactComponent as GroupIcon } from '@ohif/ui/src/elements/Svg/svgs/group.svg';
import { ReactComponent as SettingsIcon } from '@ohif/ui/src/elements/Svg/svgs/settings.svg';
import { ReactComponent as StudiesIcon } from '@ohif/ui/src/elements/Svg/svgs/studies.svg';
import { ReactComponent as UploadIcon } from '@ohif/ui/src/elements/Svg/svgs/upload-cloud.svg';

import ImageServerPickerNG from '../../components/ImageServerPickerNG/ImageServerPickerNG';
import useFlyoutTrigger from '../../hooks/useFlyoutTrigger';
import { useDeviceStore } from '../../store/useDeviceStore';
import { SIDEBAR_MODE_FULL, SIDEBAR_MODE_NARROW, useSidebarStore } from '../../store/useSidebarStore';
import toggleScrolling from '../../utils/toggleScrolling';

import NavFlyout from './NavFlyout';
import OHIFLogo from '../OHIFLogo/OHIFLogo.js';
import SonadorMark from '../OHIFLogo/SonadorMark.js';
import styles from './SideBarNG.module.scss';


// Navigation of record. New destinations are added here, not as JSX. Shaped after the TOP_TABS /
// BOTTOM_TABS precedent in SettingsPageNG, except that `perm` is a predicate rather than a string
// key: the Studies section needs `query || worklist`, which a single key cannot express.
//
// `perm: null` means "no server-level permission gates this". Shared-with-me is a per-user resource
// and is not scoped by the active server's permissions.
//
// Settings and the collapse control live in the bottom group and are deliberately not part of this
// array — neither has sub-navigation and neither is filtered by server permissions.
const NAV_ITEMS = [
  {
    id: 'studies',
    label: 'Studies',
    icon: StudiesIcon,
    to: '/',
    end: true,
    perm: (p) => p?.query || p?.worklist,
    children: [
      { id: 'all', label: 'All', to: '/', end: true, perm: (p) => p?.query, usesStudyListPathname: true },
      { id: 'worklist', label: 'Worklist', to: '/worklist', end: false, perm: (p) => p?.worklist },
    ],
  },
  { id: 'shared', label: 'Shared', icon: GroupIcon, to: '/shared', perm: null, children: [] },
  { id: 'upload', label: 'Upload', icon: UploadIcon, to: '/upload', perm: (p) => p?.upload, children: [] },
];


/**
 * True when `pathname` matches this destination, using react-router's own matcher so a row's
 * computed state and the NavLink inside it can never disagree.
 */
const matchesItem = (item, pathname) =>
  Boolean(matchPath({ path: item.to, end: Boolean(item.end) }, pathname));


/**
 * A top-level row plus its sub-navigation, in whichever of the three renderings applies.
 *
 * Split out as its own component so each row owns an independent flyout controller; a single hook
 * call in the parent would give every row one shared open state.
 */
function NavItem({ item, mode, children: visibleChildren, isSectionActive, onNavigate }) {
  const isNarrow = mode === SIDEBAR_MODE_NARROW;
  const hasChildren = visibleChildren.length > 0;

  // In narrow mode a section with sub-navigation is a menu button: the icon carries no label, so
  // the flyout is the only way to reach the children and a tap has to open it rather than navigate
  // away. Everywhere else the row is a link and a click navigates.
  const activation = isNarrow && hasChildren ? 'menu' : 'link';
  const { open, onOpenChange, close, triggerProps, contentProps } = useFlyoutTrigger({ activation });

  // The active section shows its sub-navigation inline, so it needs no flyout and shows no
  // chevron. In narrow mode there is nowhere to show it inline, so every section gets a flyout.
  const showFlyout = isNarrow || (!isSectionActive && hasChildren);

  const Icon = item.icon;

  const handleNavigate = () => {
    close();
    onNavigate();
  };

  const rowClassName = classNames(styles.menuItem, { [styles.active]: isSectionActive });

  // A row with no flyout is a plain link: no trigger handlers, and none of the popup ARIA that
  // would otherwise announce a menu that does not exist.
  const anchorProps = showFlyout ? triggerProps : {};

  // Narrow rows render the icon alone, so the label has to reach assistive technology some other
  // way; the flyout's header is not announced as the control's name.
  const ariaLabel = isNarrow ? item.label : undefined;

  const row =
    activation === 'menu' ? (
      <button type="button" className={rowClassName} aria-label={ariaLabel} {...anchorProps}>
        <Icon />
      </button>
    ) : (
      <NavLink
        to={item.to}
        end={item.end}
        className={rowClassName}
        aria-label={ariaLabel}
        {...anchorProps}
        onClick={(event) => {
          if (anchorProps.onClick) {
            anchorProps.onClick(event);
          }

          onNavigate();
        }}
      >
        <Icon />
        {!isNarrow && <span className={styles.name}>{item.label}</span>}
        {!isNarrow && showFlyout && <ChevronIcon className={styles.chevron} />}
      </NavLink>
    );

  return (
    <>
      {showFlyout ? (
        <NavFlyout
          open={open}
          onOpenChange={onOpenChange}
          contentProps={contentProps}
          anchor={row}
          header={isNarrow ? item.label : undefined}
          items={visibleChildren}
          onNavigate={handleNavigate}
        />
      ) : (
        row
      )}

      {/* Inline sub-navigation: full mode, active section only (FR-6). */}
      {!isNarrow && isSectionActive && hasChildren && (
        <div className={styles.subMenu}>
          {visibleChildren.map((child) => (
            <NavLink
              key={child.id}
              to={child.to}
              end={child.end}
              className={({ isActive }) =>
                classNames(styles.menuSubItem, { [styles.active]: isActive })
              }
              onClick={onNavigate}
            >
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}


/** A bottom-group row that is icon-only in narrow mode and shows its label in a flyout there. */
function BottomItem({ label, icon: Icon, mode, to, onClick, isActive }) {
  const isNarrow = mode === SIDEBAR_MODE_NARROW;
  const { open, onOpenChange, close, triggerProps, contentProps } = useFlyoutTrigger();

  const className = classNames(styles.menuItem, { [styles.active]: isActive });

  // Only the narrow rendering has a flyout — in full mode the label is already on the row.
  const anchorProps = isNarrow ? triggerProps : {};

  const handleClick = (event) => {
    if (anchorProps.onClick) {
      anchorProps.onClick(event);
    }

    if (onClick) {
      onClick(event);
    }
  };

  const ariaLabel = isNarrow ? label : undefined;

  const row = to ? (
    <NavLink
      to={to}
      className={className}
      aria-label={ariaLabel}
      {...anchorProps}
      onClick={handleClick}
    >
      <Icon />
      {!isNarrow && <span className={styles.name}>{label}</span>}
    </NavLink>
  ) : (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      {...anchorProps}
      onClick={handleClick}
    >
      <Icon />
      {!isNarrow && <span className={styles.name}>{label}</span>}
    </button>
  );

  if (!isNarrow) {
    return row;
  }

  return (
    <NavFlyout
      open={open}
      onOpenChange={onOpenChange}
      contentProps={contentProps}
      anchor={row}
      header={label}
      onNavigate={close}
    />
  );
}


export default function SideBarNG({
  children,
  showSettings = true,
  mode = SIDEBAR_MODE_FULL,
}) {
  const location = useLocation();
  const params = useParams();

  // Number of servers and active server instance
  const serverCount = useSelector((state) => state.servers?.servers?.length);
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const { isLarge, isDesktop, isTablet, isMobile } = useDeviceStore();
  const toggleMode = useSidebarStore((state) => state.toggleMode);

  const isNarrow = mode === SIDEBAR_MODE_NARROW;
  const perms = activeServer?.perms;

  // The default has to be mode-aware, not a single `children = OHIFLogo()` default parameter.
  // Layout resolves the branding through whiteLabeling, and a deployment that supplies its own
  // whiteLabeling block without createNarrowLogoComponentFn yields `undefined` here -- which a
  // default parameter would answer with the 155x35 wordmark, in a 40px rail. Falling back per mode
  // keeps the narrow default the square mark, whatever the server sends.
  const brand = children || (isNarrow ? SonadorMark() : OHIFLogo());

  // Token-scoped study list URLs have to survive: on /server/:token the "All" destination is the
  // current path rather than the root.
  const studyListPathname =
    location.pathname.includes('/server') && params.token ? location.pathname : '/';

  const enableScrolling = () => {
    if (isTablet || isMobile) {
      toggleScrolling(true);
    }
  };

  const resolveChild = (child) => ({
    ...child,
    to: child.usesStudyListPathname ? studyListPathname : child.to,
  });

  const sections = NAV_ITEMS.filter((item) => !item.perm || item.perm(perms)).map((item) => {
    const visibleChildren = item.children
      .filter((child) => !child.perm || child.perm(perms))
      .map(resolveChild);

    return {
      item,
      visibleChildren,
      isSectionActive:
        matchesItem(item, location.pathname) ||
        visibleChildren.some((child) => matchesItem(child, location.pathname)),
    };
  });

  return (
    <aside className={classNames(styles.ngSidebar, { [styles.narrow]: isNarrow })}>
      {!isLarge && (
        <div className={styles.logoWrapper}>{brand}</div>
      )}

      {isDesktop && serverCount > 0 && <ImageServerPickerNG variant={mode} />}

      <nav className={styles.navigation}>
        <div>
          {sections.map(({ item, visibleChildren, isSectionActive }) => (
            <NavItem
              key={item.id}
              item={item}
              mode={mode}
              isSectionActive={isSectionActive}
              onNavigate={enableScrolling}
            >
              {visibleChildren}
            </NavItem>
          ))}
        </div>

        <div className={styles.bottom}>
          {/* Suppressed on surfaces with no session behind them, such as the sign-out
              confirmation, where Settings is not somewhere the user can go. */}
          {showSettings && (
            <BottomItem
              label="Settings"
              icon={SettingsIcon}
              mode={mode}
              to="/settings"
              onClick={enableScrolling}
              isActive={Boolean(matchPath({ path: '/settings', end: false }, location.pathname))}
            />
          )}

          {/* Desktop only: the tablet/mobile drawer always renders the sidebar full width, so
              there is no mode there to toggle (FR-19). */}
          {isDesktop && (
            <BottomItem
              label={isNarrow ? 'Expand sidebar' : 'Collapse sidebar'}
              icon={isNarrow ? ExpandIcon : CollapseIcon}
              mode={mode}
              onClick={toggleMode}
            />
          )}
        </div>
      </nav>
    </aside>
  );
}


SideBarNG.propTypes = {
  /**
   * Branding block for the sidebar header. Omit it and the sidebar falls back per mode: the
   * wordmark in `full`, the square mark in `narrow`.
   */
  children: PropTypes.node,

  /** Set false on surfaces with no session behind them, such as the sign-out confirmation. */
  showSettings: PropTypes.bool,

  /** Desktop rail mode. The tablet/mobile drawer always passes 'full'. */
  mode: PropTypes.oneOf([SIDEBAR_MODE_FULL, SIDEBAR_MODE_NARROW]),
};
