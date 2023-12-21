import React, { useRef, useState } from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';

import { ReactComponent as ClosedEyeIcon } from '@ohif/ui/src/elements/Svg/svgs/closed-eye.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as FiltersIcon } from '@ohif/ui/src/elements/Svg/svgs/filters.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import useClickOutside from '../../../../../hooks/useClickOutside';
import { useMetadataSettingsStore } from '../../../../../store/useMetadataSettingsStore';

import styles from './Metadata.module.scss';

export default function Metadata({ study }) {
  // Display study and series metadata

  const [isMetadataDropdownOpen, setIsMetadataDropdownOpen] = useState(false);

  const { metadataSettings, toggleMetadataSetting } = useMetadataSettingsStore();

  const ref = useRef(null);
  useClickOutside(ref, () => {
    setIsMetadataDropdownOpen(false);
  });

  const studyDate = moment(study.StudyDate.value, 'YYYYMMDD').format('MM/DD/YYYY');

  return (
    <div className={styles.contentMetadata}>
      <div className={styles.contentMetadataHeader} ref={ref}>
        <FiltersIcon
          className={styles.metadataFilterIcon}
          onClick={() => setIsMetadataDropdownOpen((prevState) => !prevState)}
        />
        <p className={styles.contentMetadataTitle}>Metadata</p>
        {isMetadataDropdownOpen && (
          <div className={styles.metadataDropdown}>
            <p className={styles.metadataDropdownTitle}>Metadata Settings</p>
            <div className={styles.metadataDropdownSearch}>
              <SearchIcon />
              <input type="text" placeholder="Search Fields..." className={styles.metadataDropdownSearchInput} />
            </div>
            {metadataSettings.map(({ title, options }) => {
              return (
                <div key={title}>
                  <p className={styles.metadataDropdownGroupTitle}>{title}</p>
                  {options.map(({ label, id, isSelected }) => {
                    return (
                      <div key={label} className={styles.metadataDropdownItem}>
                        <div className={styles.metadataDropdownItemLeft}>
                          {isSelected ? (
                            <EyeIcon
                              className={styles.metadataDropdownItemIconOpen}
                              onClick={() => toggleMetadataSetting(id)}
                              fill="#a9a9a9"
                            />
                          ) : (
                            <ClosedEyeIcon
                              className={styles.metadataDropdownItemIconClose}
                              onClick={() => toggleMetadataSetting(id)}
                            />
                          )}
                          <p className={styles.metadataDropdownItemLabel}>{label}</p>
                        </div>
                        <p className={styles.metadataDropdownItemValue}>
                          {id === 'StudyDate' ? studyDate : study[id]?.value || 'N/A'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {metadataSettings.map(({ title, options }) => {
        return (
          <div key={title}>
            <p className={styles.contentMetadataGroupTitle}>{title}</p>
            {options
              .filter(({ isSelected }) => isSelected)
              .map(({ label, id }) => {
                return (
                  <div key={label} className={styles.contentMetadataItem}>
                    <p className={styles.contentMetadataItemLabel}>{label}</p>
                    <p className={styles.contentMetadataItemValue}>
                      {id === 'StudyDate' ? studyDate : study[id]?.value || 'N/A'}
                    </p>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

Metadata.propTypes = {
  study: PropTypes.object.isRequired,
};
