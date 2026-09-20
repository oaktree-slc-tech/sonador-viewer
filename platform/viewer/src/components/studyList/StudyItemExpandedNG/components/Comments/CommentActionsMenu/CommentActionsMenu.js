import React from 'react';
import { useTranslation } from 'react-i18next';
import { DotsVerticalIcon } from '@radix-ui/react-icons';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import { DropdownMenu } from 'radix-ui';

import { ReactComponent as InlineEditIcon } from '@ohif/ui/src/elements/Icon/icons/inline-edit.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import radixStyles from '../../../../../../styles/radixUi.module.scss';
import styles from './CommentActionsMenu.module.scss';


export default function CommentActionsMenu({ canEdit = false, canRemove = false, onEdit, onRemove, onOpen }) {
  // Per-comment actions, in the same menu shape as the series Actions menu so the two read as one
  // control. Which items appear is decided by the caller (see commentPermissions.js); no permitted
  // action means no trigger at all.

  const { t } = useTranslation('StudyList');

  const actions = [];

  if (canEdit) {
    actions.push({ id: 'edit-comment', label: t('Edit Comment'), Icon: InlineEditIcon, onSelect: onEdit });
  }

  if (canRemove) {
    actions.push({
      id: 'remove-comment',
      label: t('Remove Comment'),
      Icon: TrashBinIcon,
      destructive: true,
      onSelect: onRemove,
    });
  }

  if (!actions.length) {
    return null;
  }

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open && onOpen) {
          onOpen();
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={classNames(radixStyles.IconButton, styles.trigger)}
          aria-label={t('Comment Actions')}
          title={t('Comment Actions')}
        >
          <DotsVerticalIcon height={16} width={16} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={classNames(radixStyles.Content, styles.content)}
          align="end"
          sideOffset={4}
        >
          {actions.map(({ id, label, Icon, destructive, onSelect }) => (
            <DropdownMenu.Item
              key={id}
              className={classNames(radixStyles.DropdownItem, styles.item, {
                [styles.itemDestructive]: destructive,
              })}
              onSelect={onSelect}
            >
              <Icon className={classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon)} />
              <span>{label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}


CommentActionsMenu.propTypes = {
  canEdit: PropTypes.bool,
  canRemove: PropTypes.bool,
  onEdit: PropTypes.func,
  onRemove: PropTypes.func,
  /** Called when the menu opens, so a caller can resolve lazily-fetched permissions. */
  onOpen: PropTypes.func,
};
