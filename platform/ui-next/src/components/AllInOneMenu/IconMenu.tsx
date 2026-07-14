import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MenuProps, VerticalDirection, HorizontalDirection } from './Menu';
import { cn } from '../../lib/utils';
import Menu from './Menu';
import { Icons } from '../Icons';

export interface IconMenuProps extends MenuProps {
  icon: string;
  iconClassName?: string;
  horizontalDirection?: HorizontalDirection;
  verticalDirection?: VerticalDirection;
  menuKey?: number | string;
}

/**
 * Renders a clickable icon that toggles an AllInOneMenu. Menu is positioned
 * relative to the icon based on the provided direction props.
 */
export default function IconMenu({
  icon,
  iconClassName,
  horizontalDirection,
  verticalDirection,
  children,
  backLabel,
  menuClassName,
  menuStyle,
  onVisibilityChange,
  menuKey,
}: IconMenuProps) {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleMenuVisibility = useCallback(() => setIsMenuVisible(isVisible => !isVisible), []);

  // Close on outside click
  useEffect(() => {
    if (!isMenuVisible) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuVisible(false);
        onVisibilityChange?.(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isMenuVisible, onVisibilityChange]);

  return (
    <div
      className="relative"
      ref={containerRef}
    >
      <div
        className={iconClassName}
        onClick={toggleMenuVisibility}
      >
        <Icons.ByName name={icon} />
      </div>
      <Menu
        key={menuKey}
        isVisible={isMenuVisible}
        backLabel={backLabel}
        menuClassName={cn(
          menuClassName,
          'absolute',
          verticalDirection === VerticalDirection.TopToBottom ? 'top-[100%]' : 'bottom-[100%]',
          horizontalDirection === HorizontalDirection.LeftToRight ? 'left-0' : 'right-0'
        )}
        menuStyle={menuStyle}
        onVisibilityChange={isVis => {
          setIsMenuVisible(isVis);
          onVisibilityChange?.(isVis);
        }}
      >
        {children}
      </Menu>
    </div>
  );
}
