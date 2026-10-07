import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import _ from 'lodash';
import PropTypes from 'prop-types';

import { uiNotificationService } from '@ohif/core';
import { fieldTitle, isKnownFieldValue, isTagFieldValue } from '@ohif/core/src/utils/overlayFields';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as SaveIcon } from '@ohif/ui/src/elements/Svg/svgs/save.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import SelectNG from '../../components/SelectNG/SelectNG';
import { PREFERENCE_SECTIONS,PREFERENCES_VERSION } from '../../constants/preferences';
import { useUpdateUserPreferenceSection } from '../../queries/preferences';
import { useViewerMetadataSettingsStore } from '../../store/useViewerMetadataSettingsStore';

import styles from './ViewerMetadataSettings.module.scss';

const LIMIT_CORNER_ITEMS = 10;

const CORNERS = [
  { key: 'topLeftCorner', className: null, addAfter: true },
  { key: 'topRightCorner', className: 'topRightBlock', addAfter: true },
  { key: 'bottomLeftCorner', className: 'bottomLeftBlock', addAfter: false },
  { key: 'bottomRightCorner', className: 'bottomRightBlock', addAfter: false },
];

const ORPHAN_HINT = ' (no longer shared)';

// Unselected rows and values the overlay no longer knows are dropped at save time.
const isRenderable = ({ value }) => value !== null && isKnownFieldValue(value);

const pickCorners = store => _.pick(store, CORNERS.map(corner => corner.key));

/**
 * The viewport display picker: what each corner of the viewport overlay shows.
 *
 * @param {object[]} options picker rows (`{ title, value }` or `{ heading }`)
 */
export default function ViewportDisplayTab({ options, onClose }) {
  const store = useViewerMetadataSettingsStore();
  const saved = pickCorners(store);

  const [corners, setCorners] = useState(saved);

  // Preferences hydrated after mount replace the local copy unless the user has edited it.
  const lastSynced = useRef(saved);
  useEffect(() => {
    if (_.isEqual(corners, lastSynced.current)) {
      setCorners(saved);
    }

    lastSynced.current = saved;
  }, [saved.topLeftCorner, saved.topRightCorner, saved.bottomLeftCorner, saved.bottomRightCorner]);

  const changesPending = !_.isEqual(corners, saved);

  const { mutate: saveViewerMetadataSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.VIEWER_METADATA);

  const offered = new Set(options.filter(option => !option.heading).map(option => option.value));

  const selectedFor = item => {
    const title = fieldTitle(item);
    const orphan = isTagFieldValue(item.value) && !offered.has(item.value);

    return { ...item, title: orphan ? `${title}${ORPHAN_HINT}` : title };
  };

  const update = (key, updater) => setCorners(prev => ({ ...prev, [key]: updater(prev[key]) }));

  const handleSave = () => {
    const filtered = _.mapValues(corners, items => items.filter(isRenderable).map(({ title, value }) => ({ title, value })));

    CORNERS.forEach(({ key }) => store[`set${key[0].toUpperCase()}${key.slice(1)}`](filtered[key]));
    setCorners(filtered);
    lastSynced.current = filtered;

    if (onClose) {
      onClose();
    }

    saveViewerMetadataSection(
      { version: PREFERENCES_VERSION, values: filtered },
      {
        onSuccess: ({ outcome }) => {
          if (outcome === 'saved') {
            uiNotificationService.show({ title: 'Viewer metadata settings saved successfully', type: 'success' });
          } else if (outcome === 'queued') {
            uiNotificationService.show({
              title: 'Viewer metadata settings saved locally',
              message: 'They will sync when reconnected.',
              type: 'info',
            });
          } else {
            uiNotificationService.show({
              title: 'Failed to save viewer metadata settings',
              message: 'The server rejected the change; it was kept locally.',
              type: 'error',
            });
          }
        },
        onError: error => {
          uiNotificationService.show({ title: 'Failed to save viewer metadata settings', message: error.message, type: 'error' });
        },
      }
    );
  };

  const handleCancel = () => {
    setCorners(saved);

    if (onClose) {
      onClose();
    }
  };

  const renderAdd = key => (
    <button
      onClick={() => update(key, items => [...items, { value: null }])}
      className={styles.addBtn}
      disabled={corners[key].length >= LIMIT_CORNER_ITEMS}
    >
      <span>Add</span>
      <AddCircleIcon />
    </button>
  );

  const renderItems = key =>
    corners[key].map((item, index) => (
      <div key={index} className={styles.select}>
        <SelectNG
          options={options}
          selected={selectedFor(item)}
          onChange={newItem =>
            update(key, items => {
              const copy = [...items];
              copy[index] = newItem;
              return copy;
            })
          }
        />
        <TrashBinIcon
          className={styles.deleteIcon}
          onClick={() =>
            update(key, items => {
              const copy = [...items];
              copy.splice(index, 1);
              return copy;
            })
          }
        />
      </div>
    ));

  return (
    <>
      <div className={styles.blocks}>
        {CORNERS.slice(0, 2).map(({ key, className, addAfter }) => (
          <div key={key} className={classNames(styles.block, className && styles[className])}>
            {!addAfter && renderAdd(key)}
            {renderItems(key)}
            {addAfter && renderAdd(key)}
          </div>
        ))}
        <div className={styles.blocksSpaceDivider} />
        {CORNERS.slice(2).map(({ key, className, addAfter }) => (
          <div key={key} className={classNames(styles.block, className && styles[className])}>
            {!addAfter && renderAdd(key)}
            {renderItems(key)}
            {addAfter && renderAdd(key)}
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        {changesPending && (
          <>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.saveBtn} onClick={handleSave}>
              <span>Save</span>
              <SaveIcon />
            </button>
          </>
        )}
      </div>
    </>
  );
}

ViewportDisplayTab.propTypes = {
  options: PropTypes.array.isRequired,
  onClose: PropTypes.func,
};

export { LIMIT_CORNER_ITEMS, isRenderable };
