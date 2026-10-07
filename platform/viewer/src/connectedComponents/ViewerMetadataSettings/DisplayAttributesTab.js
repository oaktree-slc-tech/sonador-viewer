import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { uiNotificationService } from '@ohif/core';
import { normalizeTagCode, standardFieldCodes } from '@ohif/core/src/utils/overlayFields';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as CancelIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as EditIcon } from '@ohif/ui/src/elements/Svg/svgs/edit.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { createDisplayAttribute, removeDisplayAttribute, updateDisplayAttribute } from '../../api/displayAttributes';
import GroupSearch from '../../components/GroupSearch/GroupSearch';
import useClickOutside from '../../hooks/useClickOutside';
import { displayAttributesQueryKey, ENABLED_GROUPS_FILTER, useDisplayAttributeCollection } from '../../hooks/useDisplayAttributes';
import useTags from '../../hooks/useTags';
import { catalogueRows, searchCatalogue } from '../../lib/utils/displayAttributeCatalogue';

import globalTableStyles from '../../styles/globalTableStyles.module.scss';
import groupSearchStyles from '../../styles/groupSearch.module.scss';
import settingsPanelTableStyles from '../../styles/settingsPanelTableStyles.module.scss';
import styles from './DisplayAttributesTab.module.scss';

/**
 * Add, rename and remove the display attributes of a group. The group comes from the shared
 * group search, limited to groups whose policy enables display attributes; whether the user may
 * change the collection comes from the permission header on the collection itself.
 */
export default function DisplayAttributesTab({ server }) {
  const queryClient = useQueryClient();

  const [group, setGroup] = useState(null);
  const groupId = group ? group.id : null;

  const { data: collection, isLoading, error } = useDisplayAttributeCollection(server, groupId);
  const attributes = (collection && collection.tags) || [];
  const canModify = !!(collection && collection.permissions && collection.permissions.display_attr_modify);
  const inCollection = useMemo(() => new Set(attributes.map(attribute => normalizeTagCode(attribute.Code))), [attributes]);

  const { data: catalogue } = useTags({ server });
  // Attributes a Standard Field already renders are not offered; the picker has them for everyone.
  const rows = useMemo(() => catalogueRows(catalogue, standardFieldCodes()), [catalogue]);

  // Add control
  const [term, setTerm] = useState('');
  const [showMatches, setShowMatches] = useState(false);
  const searchBox = useRef(null);
  useClickOutside(searchBox, useCallback(() => setShowMatches(false), []), showMatches);
  const [picked, setPicked] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const matches = useMemo(() => searchCatalogue(rows, term), [rows, term]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: displayAttributesQueryKey(server) });

  const notifyFailure = (title, err) => uiNotificationService.show({ title, message: err && err.message, type: 'error' });

  // React Query 4: the in-flight flag is `isLoading` (`isPending` arrived in v5).
  const { mutate: create, isLoading: creating } = useMutation({
    mutationFn: payload => createDisplayAttribute(server, groupId, payload),
    onSuccess: () => {
      invalidate();
      setPicked(null);
      setTerm('');
      setDisplayName('');
      uiNotificationService.show({ title: 'Display attribute added', type: 'success' });
    },
    onError: err => notifyFailure('Failed to add display attribute', err),
  });

  const { mutate: rename } = useMutation({
    mutationFn: ({ id, Label }) => updateDisplayAttribute(server, groupId, id, { Label }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      uiNotificationService.show({ title: 'Display attribute updated', type: 'success' });
    },
    onError: err => notifyFailure('Failed to update display attribute', err),
  });

  const { mutate: remove } = useMutation({
    mutationFn: id => removeDisplayAttribute(server, groupId, id),
    onSuccess: () => {
      invalidate();
      uiNotificationService.show({ title: 'Display attribute removed', type: 'success' });
    },
    onError: err => notifyFailure('Failed to remove display attribute', err),
  });

  // Row edit and removal
  const [editing, setEditing] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const pick = row => {
    setPicked(row);
    setTerm(`${row.label} (${row.display})`);
    setShowMatches(false);
  };

  const submitAdd = () => {
    if (!picked || creating) {
      return;
    }

    create({ Code: picked.code, Label: displayName.trim() });
  };

  return (
    <div className={styles.tab}>
      <GroupSearch
        server={server}
        filter={ENABLED_GROUPS_FILTER}
        value={group}
        onChange={setGroup}
        id="display-attributes-group-search"
      />

      {group && canModify && (
        <div className={styles.addRow}>
          <div className={classNames(styles.field, styles.search)} ref={searchBox}>
            <label htmlFor="display-attribute-catalogue-search">
              <span>Add an attribute from the server catalogue</span>
            </label>
            <input
              id="display-attribute-catalogue-search"
              type="text"
              value={term}
              placeholder="Search by name, keyword or code"
              autoComplete="off"
              onChange={event => {
                setTerm(event.target.value);
                setPicked(null);
                setShowMatches(true);
              }}
              onFocus={() => setShowMatches(true)}
            />
            {showMatches && !picked && matches.length > 0 && (
              <ul className={classNames(groupSearchStyles.dropdown, styles.matches)}>
                {matches.map(row => {
                  const taken = inCollection.has(row.code);
                  return (
                    <li key={row.code} className={classNames(groupSearchStyles.dropdownItem, { [styles.taken]: taken })}>
                      <button type="button" className={styles.matchBtn} disabled={taken} onClick={() => pick(row)}>
                        <span>{row.label}</span>
                        <span className={styles.meta}>
                          {row.display}
                          {row.private ? ' · private' : ''}
                          {taken ? ' · added' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <label className={styles.field}>
            <span>Display name (optional)</span>
            <input type="text" value={displayName} placeholder="Shown in the viewport" onChange={event => setDisplayName(event.target.value)} />
          </label>
          <button className={styles.addBtn} onClick={submitAdd} disabled={!picked || creating}>
            <AddCircleIcon />
            <span>Add Attribute</span>
          </button>
        </div>
      )}

      {group && (
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th className={settingsPanelTableStyles.listHeaderFirstItem} />
                <th>Code</th>
                <th>Attribute</th>
                <th>Display name</th>
                <th>Private</th>
                {canModify && <th className={settingsPanelTableStyles.stickyActions} />}
              </tr>
            </thead>
            <tbody>
              {attributes.map((attribute, index) => (
                <DisplayAttributeRow
                  key={attribute.ID}
                  attribute={attribute}
                  index={index}
                  canModify={canModify}
                  editing={editing && editing.id === attribute.ID ? editing : null}
                  onEdit={() => setEditing({ id: attribute.ID, Label: attribute.Label || '' })}
                  onEditChange={value => setEditing({ id: attribute.ID, Label: value })}
                  onEditCancel={() => setEditing(null)}
                  onEditSave={() => rename({ id: attribute.ID, Label: editing.Label.trim() })}
                  onRemove={() => setPendingRemoval(attribute)}
                />
              ))}
              {!attributes.length && (
                <tr>
                  <td colSpan={canModify ? 6 : 5}>
                    <p className={globalTableStyles.noMatchingResults}>
                      {isLoading ? 'Loading…' : error ? 'The collection could not be loaded.' : `No display attributes defined for ${group.name}.`}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pendingRemoval && (
        <ModalNG isOpen onClose={() => setPendingRemoval(null)} title="Remove Display Attribute" size="small">
          <div className={styles.confirm}>
            <p>
              Remove <strong>{pendingRemoval.Label || pendingRemoval.Tag || pendingRemoval.Code}</strong> from {group ? group.name : 'the group'}?
              Members who show it in their viewport will see it disappear.
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setPendingRemoval(null)}>
                Cancel
              </button>
              <button
                className={styles.removeBtn}
                onClick={() => {
                  remove(pendingRemoval.ID);
                  setPendingRemoval(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </ModalNG>
      )}
    </div>
  );
}

DisplayAttributesTab.propTypes = {
  server: PropTypes.object.isRequired,
};

function DisplayAttributeRow({ attribute, index, canModify, editing, onEdit, onEditChange, onEditCancel, onEditSave, onRemove }) {
  return (
    <tr className={settingsPanelTableStyles.listItem}>
      <td className={settingsPanelTableStyles.listItemNumber}>{index + 1}</td>
      <td>
        <p>{attribute.Code}</p>
      </td>
      <td>
        <p>{attribute.Tag || ''}</p>
      </td>
      <td>
        {editing ? (
          <input
            type="text"
            value={editing.Label}
            onChange={event => onEditChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') onEditSave();
              if (event.key === 'Escape') onEditCancel();
            }}
          />
        ) : (
          <p>{attribute.Label || ''}</p>
        )}
      </td>
      <td>
        <p>{attribute.Private ? 'Yes' : ''}</p>
      </td>
      {canModify && (
        <td className={settingsPanelTableStyles.stickyActions}>
          <div className={settingsPanelTableStyles.rowActions}>
            {editing ? (
              <>
                <button onClick={onEditSave} title="Save display name">
                  <EditIcon />
                </button>
                <button onClick={onEditCancel} title="Cancel">
                  <CancelIcon />
                </button>
              </>
            ) : (
              <button onClick={onEdit} title="Edit display name">
                <EditIcon />
              </button>
            )}
            <button onClick={onRemove} title="Remove">
              <RemoveIcon />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

DisplayAttributeRow.propTypes = {
  attribute: PropTypes.shape({
    ID: PropTypes.string.isRequired,
    Code: PropTypes.string.isRequired,
    Tag: PropTypes.string,
    Label: PropTypes.string,
    Private: PropTypes.bool,
  }).isRequired,
  index: PropTypes.number.isRequired,
  canModify: PropTypes.bool.isRequired,
  editing: PropTypes.shape({ id: PropTypes.string, Label: PropTypes.string }),
  onEdit: PropTypes.func.isRequired,
  onEditChange: PropTypes.func.isRequired,
  onEditCancel: PropTypes.func.isRequired,
  onEditSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};
