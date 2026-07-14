import React, { useCallback, useContext } from 'react';
import { MenuContext, MenuProps } from './Menu';
import { Icons } from '../Icons';

export interface SubMenuProps extends MenuProps {
  itemLabel: string;
  onClick?: () => void;
  itemIcon?: string;
}

const SubMenu = (props: SubMenuProps) => {
  const { showSubMenu } = useContext(MenuContext);

  const onClickHandler = useCallback(() => {
    showSubMenu(props);
    props.onClick?.();
  }, [showSubMenu, props]);

  return (
    <div
      className="hover:bg-accent flex h-8 w-full cursor-pointer items-center px-2 text-base hover:rounded"
      onClick={onClickHandler}
    >
      {props.itemIcon && (
        <div className="flex w-7 flex-shrink-0 items-center justify-center">
          <Icons.ByName name={props.itemIcon} />
        </div>
      )}
      <span className="flex-grow">{props.itemLabel}</span>
      <div className="ml-2 flex-shrink-0">
        <Icons.ByName name="content-next" />
      </div>
    </div>
  );
};

export default SubMenu;
