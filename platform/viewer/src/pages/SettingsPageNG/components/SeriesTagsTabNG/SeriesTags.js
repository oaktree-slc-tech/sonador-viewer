import _ from 'lodash';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import OHIF, { displayAttributes, redux, sonador } from '@ohif/core';
import { uiNotificationService } from '@ohif/core';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';
import { ReactComponent as CancelIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as EditIcon } from '@ohif/ui/src/elements/Svg/svgs/edit.svg';
import { ReactComponent as GearIcon } from '@ohif/ui/src/elements/Svg/svgs/gear.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { createSeriesTag, getTagList, removeSeriesTag,updateSeriesTag } from '../../../../api/ext';
import GroupSearch from '../../../../components/GroupSearch/GroupSearch';
import DisplayAttributesDialog from '../../../../components/DisplayAttributes/DisplayAttributesDialog';

import globalTableStyles from '../../../../styles/globalTableStyles.module.scss';
import settingsPanelTableStyles from '../../../../styles/settingsPanelTableStyles.module.scss';
import styles from './SeriesTags.module.scss';


const headers = [
  { label: 'Value', id: 'value' },
  { label: 'Meaning', id: 'meaning' },
  { label: 'Scheme', id: 'scheme-designator' },
  { label: 'Version', id: 'scheme-version' },
  { label: 'Display', id: 'display' },
];

// Tag fields written to the API
const TAG_FIELDS = ['Value', 'Meaning', 'SchemeDesignator', 'SchemeVersion', 'Meta'];

const tagFields = tag => _.omitBy(_.pick(tag, TAG_FIELDS), _.isNil);

const tagColor = tag => displayAttributes.getDisplayColor(tag?.Meta);

const tagMeta = color => (_.isEmpty(color) ? null : { DisplayAttributes: { Color: color } });


export default function SeriesTagsTabNG() {
  // Management component for the Sonador / Orthanc Series Tag API

  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  // Group Search State
  const [selectedGroup, setSelectedGroup] = useState(null);

  // ACL for the tag list
  const [aclTag, setAclTag] = useState(false);
  const [aclTagModify, setAclTagModify] = useState(false);

  // Save / Cancel state
  const [changesPending, setChangesPending] = useState(false);

  const { data: tagResponse = [] } = useQuery({
    // Retrieve the tag list for the group

    queryKey: ['tags', selectedGroup],
    queryFn: () => getTagList(activeServer, selectedGroup, {
      success: (res) => {

        if (res.headers.get('sonador-permissions')) {
          const _perms = JSON.parse(res.headers.get('sonador-permissions'));

          setAclTag(_perms.tag || false);
          setAclTagModify(_perms.tag_modify || false);
        }
      },
    }),
    select: (res) => {
      if (Array.isArray(res)) {
        return res.map(tag => _.extend(tag, { isEditMode: false, isUpdated: false }));
      }
      
      return [];
    },
  });

  const { mutate: createTagMutate } = useMutation({
    mutationFn: ({ group, payload, idx }) => createSeriesTag({ server: activeServer, group, payload }, {
      success: (res, _data) => {
        setTags((prevState) => {
          return prevState.map((t) => {

            // Update edit mode, flags, and ID value for newly created tag
            if (!t.ID && res.ID && t.Value == payload.Value && t.SchemeDesignator == payload.SchemeDesignator) {
              _.extend(t, { ID: res.ID, isEditMode: false, isUpdated: false, });
            }

            return t;
          })  
        });
      }
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['tags']);
      uiNotificationService.show({ title: 'Tag created successfully', type: 'success' });
      console.log(arguments);
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to create tag', message: error.message, type: 'error' });
    },
  });

  const { mutate: removeTagMutate } = useMutation({
    mutationFn: ({ group, tagId }) => removeSeriesTag({ server: activeServer, group, tagId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['tags']);
      uiNotificationService.show({ title: 'Tag removed successfully', type: 'success' });
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to remove tag', message: error.message, type: 'error' });
    },
  });

  const { mutate: updateTagMutate } = useMutation({
    mutationFn: (payload) => updateSeriesTag({
      server: activeServer, group: payload.group, tagId: payload.tagId,
      payload: payload.payload,
    }, {
      success: () => {
        setTags((prevState) => {
          return prevState.map((t) => {

            // Update edit and mode flags for edited value
            if (t.ID == payload.tagId) {
              _.extend(t, { isEditMode: false, isUpdated: false });              
            }

            return t;
          });
        })
      }
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['tags']);
      uiNotificationService.show({ title: 'Tag updated successfully', type: 'success' });
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to update tag', message: error.message, type: 'error' });
    },
  });

  const [tags, setTags] = useState([]);
  const [displayEditIndex, setDisplayEditIndex] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tagToDelete, setTagToDelete] = useState(null);

  // Track device list init
  const hasInitialized = useRef(false);
  useEffect(() => {
    // Initialize tags list (updates on tags list response changes)
    
    // Only run if we have a response _and_ haven't initialized yet
    if (tagResponse?.length && !hasInitialized.current) {
      
      // Update initialized flag
      hasInitialized.current = true;
      setTags(tagResponse);
    }
  }, [tagResponse]);

  useEffect(() => {
    // Update tags response and display list

    // Clear initialized flag when group is reset to allow for the tags to reload
    if (hasInitialized.current && !selectedGroup) {
      hasInitialized.current = false;
      setTags(tagResponse);
    }
  }, [selectedGroup]);

  const addTag = () => {
    // Add new list item to the table

    setTags((prevState) => [
      ...prevState,
      {
        Value: '',
        Meaning: '',
        SchemeDesignator: '',
        SchemeVersion: '',
        isEditMode: true,
      },
    ]);
  };

  const removeTagItem = (id, type) => {
    setTagToDelete({ id, type });
    setShowDeleteConfirm(true);
  }

  const confirmDelete = () => {
    const { id, type } = tagToDelete;

    if (type == 'existing') {

      // Remove from local state immediately
      setTags((prevState) => {
        return prevState.filter((tag) => tag.ID !== id);
      })

      // Remove from server
      removeTagMutate({ group: selectedGroup, tagId: id, })
    } else {
      setTags((prevState) => {
        return prevState.filter((tag, index) => index != id );
      });
    }

    setShowDeleteConfirm(false);
    setTagToDelete(null);
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setTagToDelete(null);
  }

  useEffect(() => {
    // Toggle changes pending based on the state of the tags list

    const _pending = (tags && tags.length > 0 && !_.every(tags, (t) => !t.isEditMode && !t.isUpdated)) ?? false;
    setChangesPending(_pending);
  }, [tags]);

  const handleChange = (idx, fieldType, val) => {
    // Update tag data field

    setTags((prevState) => {
      return prevState.map((tag, tagIndex) => {
        if (idx == tagIndex) {
          const next = { ...tag, [fieldType]: val };
          if (tag.ID) {
            const origTag = tagResponse.find(t => t.ID == tag.ID);
            next.isUpdated = !_.isEqual(tagFields(next), tagFields(origTag));
          }

          return next;
        }

        return tag;
      });
    });
  }

  const handleSave = () => {
    // Persist changes to the database

    // Filter new and updated tags for persistence
    const _new = tags.filter(({ ID, Value, Meaning, SchemeDesignator, SchemeVersion }) => 
      !ID && (Value || Meaning || SchemeDesignator),
    );
    const _updated = tags.filter(({ isUpdated }) => isUpdated);

    if (_new.length) {
      _new.forEach((t) => {
        console.log('Create new tag: ', t);
        createTagMutate({
          group: selectedGroup,
          payload: tagFields(t),
        });
      });
    }

    if (_updated.length) {
      _updated.forEach((tag) => {
        updateTagMutate({
          group: selectedGroup,
          tagId: tag.ID,
          payload: { ..._.pick(tag, TAG_FIELDS), Meta: tag.Meta || null },
        });
      });
    }
  }

  const handleEdit = (idx) => {
    // Toggle editing for the tag row
    
    setTags((prevState) => {

      return prevState.map((tag, tagIndex) => {

        if (tagIndex == idx && tag.ID) {

          // Toggle edit mode of the tag row
          return {
            ...tag,
            isEditMode: !tag.isEditMode,
          }
        }

        return tag;
      });
    });
  }

  const handleCancelRowEdit = (idx) =>  {
    // Cancel editing and restore the previous data

    setTags((prevState) => {
      return prevState.map((tag, tagIndex) => {
        if (tagIndex == idx && tag.ID) {

          // Retrieve response tag
          const tag0 = tagResponse.find(t => t.ID == tag.ID);
          if (tag0) {
            return tag0;
          }
        }

        return tag;
      });
    });
  }

  const handleCancel = () => {
    // Clear pending items and restore tags to previou state

    setTags(tagResponse);
  }

  return (
    <>
    <div>
      <div className={styles.header} >
        <h2 className={styles.tabTitle}>Series Tags</h2>
        {selectedGroup && aclTagModify && (
          <button className={styles.addNewBtn} onClick={addTag}>
            <AddCircleIcon />
            <span>Add Row</span>
          </button>
        )}
      </div>
      <hr className={styles.divider} style={{ marginBottom: '1rem' }} />

    </div>

    <GroupSearch server={activeServer} filter={{ tag: true }} value={selectedGroup} onChange={setSelectedGroup} />

    {selectedGroup && aclTag && (
      <>
      <div className={styles.tagList}>
        <TooltipProvider delayDuration={200}>
        <div className={styles.tableScroll}>
        <table>
          <thead>
          <tr>
            <th className={styles.listHeaderFirstItem} />
              {headers.map(({ id, label }) => {
                return <th key={id}>{label}</th>;
            })}
            {aclTagModify && <th className={settingsPanelTableStyles.stickyActions} />}
          </tr>
          </thead>
          <tbody>
          {tags?.map((tag, idx) => (
            <TagRow key={tag.ID || idx}
              tag={tag}
              index={idx} 
              onChange={handleChange}
              onEdit={handleEdit}
              onCancelEdit={handleCancelRowEdit}
              onRemove={removeTagItem}
              onEditDisplay={setDisplayEditIndex}
              aclModify={aclTagModify}
            />
          ))}
          {(tags?.length == 0) && (
            <tr><td colSpan={headers.length + 1 + (aclTagModify ? 1 : 0)}>
              <p className={globalTableStyles.noMatchingResults}>
                {t('No series tags defined for ')+selectedGroup.name+'.'}
              </p>
            </td></tr>
          )}
          </tbody>
        </table>
        </div>
        </TooltipProvider>

        {changesPending && (
          <div className={styles.footer}>
            <button className={styles.cancel} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.save} onClick={handleSave}>
              Save
            </button>
          </div>
        )}

        {displayEditIndex !== null && tags[displayEditIndex] && (
          <DisplayAttributesDialog
            isOpen
            color={tagColor(tags[displayEditIndex])}
            preview={{ value: tags[displayEditIndex].Value, meaning: tags[displayEditIndex].Meaning }}
            onApply={(color) => {
              handleChange(displayEditIndex, 'Meta', tagMeta(color));
              setDisplayEditIndex(null);
            }}
            onClose={() => setDisplayEditIndex(null)}
          />
        )}

        {showDeleteConfirm && (
          <ModalNG
            isOpen={showDeleteConfirm}
            onClose={cancelDelete}
            title="Confirm Delete"
            size="small"
          >
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <p style={{ color: 'white' }}>Are you sure you want to delete this tag?</p>
              <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button
                  onClick={cancelDelete}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </ModalNG>
        )}
      </div>
      </>
    )}

    </>
  );
}


function RowAction({ label, onClick, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={label}>{children}</button>
      </TooltipTrigger>
      <TooltipContent side="top" className={styles.tooltipContent}>{label}</TooltipContent>
    </Tooltip>
  );
}


RowAction.propTypes = {
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};


function TagRow({
    tag,
    index,
    onChange,
    onEdit,
    onCancelEdit,
    onRemove,
    onEditDisplay,
    aclModify=false,
  }) {
    // Table row for displaying tags
  const { ID, Value, Meaning, SchemeDesignator, SchemeVersion, isEditMode } = tag;
  const color = displayAttributes.resolveDisplayColor(displayAttributes.SERIES_TAG_TOOL, tagColor(tag));

  return (
    <tr className={settingsPanelTableStyles.listItem}>
      <td className={settingsPanelTableStyles.listItemNumber}>{index+1}</td>
      <td>
        {isEditMode ? (
          <input type="text" value={Value}
              onChange={(e) => onChange(index, 'Value', e.target.value)} />
        ) : (
          <p>{Value}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={Meaning}
              onChange={(e) => onChange(index, 'Meaning', e.target.value)} />
        ) : (
          <p>{Meaning}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={SchemeDesignator}
              onChange={(e) => onChange(index, 'SchemeDesignator', e.target.value)} />
        ) : (
          <p>{SchemeDesignator}</p>
        )}
      </td>
      <td className={styles.versionCell}>
        {isEditMode ? (
          <input type="text" value={SchemeVersion}
              onChange={(e) => onChange(index, 'SchemeVersion', e.target.value)} />
        ) : (
          <p>{SchemeVersion}</p>
        )}
      </td>
      <td>
        <span className={styles.displayChip} style={{ backgroundColor: color.Background || 'transparent', borderColor: color.Border }}
          data-cy="series-tag-display-chip">
          <span style={{ color: color.Value }}>{Value || 'Value'}</span>
          <span style={{ color: color.Meaning }}>{Meaning || 'Meaning'}</span>
        </span>
      </td>

      {aclModify && <td className={settingsPanelTableStyles.stickyActions}>
        <div className={settingsPanelTableStyles.rowActions}>
          <RowAction label={`Modify display attributes for "${Meaning || Value || 'new tag'}"`} onClick={() => onEditDisplay(index)}>
            <GearIcon />
          </RowAction>
          {ID && !isEditMode && (
            <RowAction label="Edit" onClick={() => onEdit(index)}>
              <EditIcon />
            </RowAction>
          )}
          {ID && isEditMode && (
            <RowAction label="Cancel" onClick={() => onCancelEdit(index)}>
              <CancelIcon />
            </RowAction>
          )}
          <RowAction label="Remove" onClick={() => onRemove(ID || index, ID ? 'existing' : 'new')}>
            <RemoveIcon />
          </RowAction>
        </div>
      </td>}
    </tr>
  )
}


TagRow.propTypes = {
  tag: PropTypes.shape({
    id: PropTypes.string,
    value: PropTypes.string,
    meaning: PropTypes.string,
    schemeDesignator: PropTypes.string,
    schemeVersion: PropTypes.string,
    Meta: PropTypes.object,
    isEditMode: PropTypes.bool,
    isUpdated: PropTypes.bool,
  }).isRequired,
  index: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onCancelEdit: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onEditDisplay: PropTypes.func.isRequired,
  aclModify: PropTypes.bool.isRequired,
};
