import React, { createContext, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import DividerItem from './DividerItem';
import PanelSelector from './PanelSelector';
import { cn } from '../../lib/utils';
import BackItem from './BackItem';

export enum VerticalDirection {
  TopToBottom,
  BottomToTop,
}

export enum HorizontalDirection {
  LeftToRight,
  RightToLeft,
}

export interface MenuProps {
  menuStyle?: unknown;
  menuClassName?: string;
  isVisible?: boolean;
  preventHideMenu?: boolean;
  backLabel?: string;
  headerComponent?: ReactNode;
  showHeaderDivider?: boolean;
  activePanelIndex?: number;
  onVisibilityChange?: (isVisible: boolean) => void;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

type MenuContextProps = {
  showSubMenu: (subMenuProps: MenuProps) => void;
  hideMenu: () => void;
  addItemPanel: (index: number, label: string) => void;
  horizontalDirection: HorizontalDirection;
  verticalDirection?: VerticalDirection;
  activePanelIndex: number;
};

type MenuPathState = {
  props: MenuProps;
  activePanelIndex: number;
};

export const MenuContext = createContext<MenuContextProps>(null);

const Menu = (props: MenuProps) => {
  const {
    isVisible,
    onVisibilityChange,
    activePanelIndex,
    preventHideMenu,
    menuClassName,
    menuStyle,
    align,
    side,
  } = props;

  let horizontalDirection = HorizontalDirection.LeftToRight;
  let verticalDirection = VerticalDirection.BottomToTop;

  if (align !== undefined) {
    horizontalDirection =
      align === 'start' ? HorizontalDirection.LeftToRight : HorizontalDirection.RightToLeft;
  }

  if (side !== undefined) {
    verticalDirection =
      side === 'bottom' ? VerticalDirection.TopToBottom : VerticalDirection.BottomToTop;
  }

  const [isMenuVisible, setIsMenuVisible] = useState(isVisible);

  const [menuPath, setMenuPath] = useState<Array<MenuPathState>>([
    { props, activePanelIndex: activePanelIndex || 0 },
  ]);
  const [itemPanelLabels, setItemPanelLabels] = useState<Array<string>>([]);

  const onVisibilityChangeRef = useRef(onVisibilityChange);
  const preventHideMenuRef = useRef(preventHideMenu);

  useEffect(() => {
    onVisibilityChangeRef.current = onVisibilityChange;
  }, [onVisibilityChange]);

  useEffect(() => {
    preventHideMenuRef.current = preventHideMenu;
  }, [preventHideMenu]);

  useEffect(() => {
    setMenuPath(menuPath => [
      { props, activePanelIndex: activePanelIndex || 0 },
      ...menuPath.slice(1),
    ]);
  }, [activePanelIndex, props]);

  const hideMenu = useCallback(() => {
    if (preventHideMenuRef.current) {
      return;
    }
    setMenuPath(path => [path[0]]);
    setItemPanelLabels([]);
    setIsMenuVisible(false);
    onVisibilityChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (isVisible) {
      setIsMenuVisible(isVisible);
      onVisibilityChangeRef.current?.(isVisible);
    } else {
      hideMenu();
    }
  }, [isVisible, hideMenu]);

  const showSubMenu = useCallback((subMenuProps: MenuProps) => {
    setMenuPath(path => {
      return [
        ...path,
        { props: subMenuProps, activePanelIndex: subMenuProps.activePanelIndex || 0 },
      ];
    });
    setItemPanelLabels([]);
  }, []);

  const addItemPanel = useCallback((index, label) => {
    setItemPanelLabels(labels => {
      return [...labels.slice(0, index), label, ...labels.slice(index + 1, labels.length)];
    });
  }, []);

  const onActivePanelIndexChange = useCallback(index => {
    setMenuPath(path => {
      return [
        ...path.slice(0, path.length - 1),
        { ...path[path.length - 1], activePanelIndex: index },
      ];
    });
  }, []);

  const onBackClick = useCallback(() => {
    setMenuPath(path => [...path.slice(0, path.length - 1)]);
    setItemPanelLabels([]);
  }, []);

  const { props: currentMenuProps, activePanelIndex: currentMenuActivePanelIndex } =
    menuPath[menuPath.length - 1];

  return (
    <>
      <MenuContext.Provider
        value={{
          showSubMenu,
          hideMenu,
          addItemPanel,
          activePanelIndex: currentMenuActivePanelIndex,
          horizontalDirection,
          verticalDirection,
        }}
      >
        {isMenuVisible && (
          <div
            className={cn(
              'bg-popover/90 text-foreground flex select-none flex-col rounded px-1 py-1.5',
              menuClassName
            )}
            style={menuStyle as React.CSSProperties}
          >
            {menuPath.length > 1 && (
              <BackItem
                backLabel={menuPath[menuPath.length - 2].props.backLabel}
                onBackClick={onBackClick}
              />
            )}
            {itemPanelLabels.length > 1 && (
              <PanelSelector
                panelLabels={itemPanelLabels}
                activeIndex={currentMenuActivePanelIndex}
                onActiveIndexChange={onActivePanelIndexChange}
              />
            )}
            {currentMenuProps.headerComponent}
            {currentMenuProps.showHeaderDivider && <DividerItem />}
            {currentMenuProps.children}
          </div>
        )}
      </MenuContext.Provider>
    </>
  );
};

export default Menu;
