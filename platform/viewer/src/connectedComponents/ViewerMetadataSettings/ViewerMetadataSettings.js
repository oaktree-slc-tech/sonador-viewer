import React, { useState } from 'react';
import classNames from 'classnames';

import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as SettingsIcon } from '@ohif/ui/src/elements/Svg/svgs/gear.svg';
import { ReactComponent as SaveIcon } from '@ohif/ui/src/elements/Svg/svgs/save.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import SelectNG from '../../components/SelectNG/SelectNG';
import { useViewerMetadataSettingsStore } from '../../store/useViewerMetadataSettingsStore';

import styles from './ViewerMetadataSettings.module.scss';

const options = [
  { title: 'Patient Name', value: 'patientName' },
  { title: 'Patient Id', value: 'patientId' },
  { title: 'Study Description', value: 'studyDescription' },
  { title: 'Study Date Time', value: 'studyDate-studyTime' },
  { title: 'Zoom Percentage', value: 'zoomPercentage' },
  { title: 'WWWC', value: 'wwwc' },
  { title: 'Compression', value: 'compression' },
  { title: 'Inconsistency Warnings', value: 'inconsistencyWarnings-warning' },
  { title: 'SRLabels', value: 'SRLabels-warning' },
  { title: 'Series Number', value: 'seriesNumber' },
  { title: 'Img instance number index/stack size', value: 'Img-instance-number-index-stack-size' },
  { title: 'Frame Rate Image Info', value: 'frameRate-image-info' },
  { title: 'Modality', value: 'modality' },
  { title: 'Series Instance UID', value: 'seriesInstanceUID' },
  { title: 'Study Instance UID', value: 'studyInstanceUID' },
  { title: 'Accession Number', value: 'accessionNumber' },
];

const LIMIT_CORNER_ITEMS = 10;

export default function ViewerMetadataSettings() {
  const [isOpen, setIsOpen] = useState(false);

  const {
    topLeftCorner,
    topRightCorner,
    bottomLeftCorner,
    bottomRightCorner,
    setBottomRightCorner,
    setBottomLeftCorner,
    setTopRightCorner,
    setTopLeftCorner,
  } = useViewerMetadataSettingsStore();

  const [topLeftCornerState, setTopLeftCornerState] = useState(topLeftCorner);
  const [topRightCornerState, setTopRightCornerState] = useState(topRightCorner);
  const [bottomLeftCornerState, setBottomLeftCornerState] = useState(bottomLeftCorner);
  const [bottomRightCornerState, setBottomRightCornerState] = useState(bottomRightCorner);

  const handleSave = () => {
    const filteredTopLeftCornerState = topLeftCornerState.filter(({ value }) => value !== null);
    const filteredTopRightCornerState = topRightCornerState.filter(({ value }) => value !== null);
    const filteredBottomLeftCornerState = bottomLeftCornerState.filter(({ value }) => value !== null);
    const filteredBottomRightCornerState = bottomRightCornerState.filter(({ value }) => value !== null);

    setTopLeftCorner(filteredTopLeftCornerState);
    setTopRightCorner(filteredTopRightCornerState);
    setBottomLeftCorner(filteredBottomLeftCornerState);
    setBottomRightCorner(filteredBottomRightCornerState);

    setTopLeftCornerState(filteredTopLeftCornerState);
    setTopRightCornerState(filteredTopRightCornerState);
    setBottomLeftCornerState(filteredBottomLeftCornerState);
    setBottomRightCornerState(filteredBottomRightCornerState);

    setIsOpen(false);
  };

  const handleCancel = () => {
    setTopLeftCornerState(topLeftCorner);
    setTopRightCornerState(topRightCorner);
    setBottomLeftCornerState(bottomLeftCorner);
    setBottomRightCornerState(bottomRightCorner);

    setIsOpen(false);
  };

  return (
    <>
      <button className={styles.settingsBtn} onClick={() => setIsOpen(true)}>
        <SettingsIcon />
        <p className={styles.settingsText}>Settings</p>
      </button>
      {isOpen && (
        <ModalNG
          onClose={handleCancel}
          isOpen={isOpen}
          title="Viewer Settings"
          classes={{ content: styles.modal }}
          hideDivider
        >
          <p className={styles.subtitle}>Metadata</p>
          <p className={styles.description}>Customize the metadata displayed in the viewer window.</p>
          <hr className={styles.divider} />
          <div className={styles.blocks}>
            <div className={styles.block}>
              {topLeftCornerState.map((item, index) => {
                return (
                  <div key={index} className={styles.select}>
                    <SelectNG
                      options={options}
                      selected={item}
                      onChange={(newItem) =>
                        setTopLeftCornerState((prevState) => {
                          const copy = [...prevState];

                          copy[index] = newItem;

                          return copy;
                        })
                      }
                    />
                    <TrashBinIcon
                      className={styles.deleteIcon}
                      onClick={() =>
                        setTopLeftCornerState((prevState) => {
                          const copy = [...prevState];

                          copy.splice(index, 1);

                          return copy;
                        })
                      }
                    />
                  </div>
                );
              })}
              <button
                onClick={() => setTopLeftCornerState((prevState) => [...prevState, { value: null }])}
                className={styles.addBtn}
                disabled={topLeftCornerState.length === LIMIT_CORNER_ITEMS}
              >
                <span>Add</span>
                <AddCircleIcon />
              </button>
            </div>
            <div className={classNames(styles.block, styles.topRightBlock)}>
              {topRightCornerState.map((item, index) => {
                return (
                  <div key={index} className={styles.select}>
                    <SelectNG
                      options={options}
                      selected={item}
                      onChange={(newItem) =>
                        setTopRightCornerState((prevState) => {
                          const copy = [...prevState];

                          copy[index] = newItem;

                          return copy;
                        })
                      }
                    />
                    <TrashBinIcon
                      className={styles.deleteIcon}
                      onClick={() =>
                        setTopRightCornerState((prevState) => {
                          const copy = [...prevState];

                          copy.splice(index, 1);

                          return copy;
                        })
                      }
                    />
                  </div>
                );
              })}
              <button
                onClick={() => setTopRightCornerState((prevState) => [...prevState, { value: null }])}
                className={styles.addBtn}
                disabled={topRightCornerState.length === LIMIT_CORNER_ITEMS}
              >
                <span>Add</span>
                <AddCircleIcon />
              </button>
            </div>
            <div className={styles.blocksSpaceDivider} />
            <div className={classNames(styles.block, styles.bottomLeftBlock)}>
              <button
                onClick={() => setBottomLeftCornerState((prevState) => [...prevState, { value: null }])}
                className={styles.addBtn}
                disabled={bottomLeftCornerState.length === LIMIT_CORNER_ITEMS}
              >
                <span>Add</span>
                <AddCircleIcon />
              </button>
              {bottomLeftCornerState.map((item, index) => {
                return (
                  <div key={index} className={styles.select}>
                    <SelectNG
                      options={options}
                      selected={item}
                      onChange={(newItem) =>
                        setBottomLeftCornerState((prevState) => {
                          const copy = [...prevState];

                          copy[index] = newItem;

                          return copy;
                        })
                      }
                    />
                    <TrashBinIcon
                      className={styles.deleteIcon}
                      onClick={() =>
                        setBottomLeftCornerState((prevState) => {
                          const copy = [...prevState];

                          copy.splice(index, 1);

                          return copy;
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className={classNames(styles.block, styles.bottomRightBlock)}>
              <button
                onClick={() => setBottomRightCornerState((prevState) => [...prevState, { value: null }])}
                className={styles.addBtn}
                disabled={bottomRightCornerState.length === LIMIT_CORNER_ITEMS}
              >
                <span>Add</span>
                <AddCircleIcon />
              </button>
              {bottomRightCornerState.map((item, index) => {
                return (
                  <div key={index} className={styles.select}>
                    <SelectNG
                      options={options}
                      selected={item}
                      onChange={(newItem) =>
                        setBottomRightCornerState((prevState) => {
                          const copy = [...prevState];

                          copy[index] = newItem;

                          return copy;
                        })
                      }
                    />
                    <TrashBinIcon
                      className={styles.deleteIcon}
                      onClick={() =>
                        setBottomRightCornerState((prevState) => {
                          const copy = [...prevState];

                          copy.splice(index, 1);

                          return copy;
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.saveBtn} onClick={handleSave}>
              <span>Save</span>
              <SaveIcon />
            </button>
          </div>
        </ModalNG>
      )}
    </>
  );
}
