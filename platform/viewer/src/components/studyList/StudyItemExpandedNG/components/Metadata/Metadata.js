import _ from 'lodash';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';

import moment from 'moment';
import PropTypes from 'prop-types';

import OHIF, { display, redux } from '@ohif/core';
import { useDebounce } from '@ohif/ui';

import { ReactComponent as ClosedEyeIcon } from '@ohif/ui/src/elements/Svg/svgs/closed-eye.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as FiltersIcon } from '@ohif/ui/src/elements/Svg/svgs/filters.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import useClickOutside from '../../../../../hooks/useClickOutside';
import useTags from '../../../../../hooks/useTags';
import { useMetadataSettingsStore } from '../../../../../store/useMetadataSettingsStore';

import styles from './Metadata.module.scss';


export default function Metadata({ study, selectedSeries, seriesCount }) {
  // Display study and series metadata

  // Retrieve tags and metadata settings
  const { displaySetService } = display.DisplaySetApi.Instance;
  const { metadataSettings, toggleMetadataSetting } = useMetadataSettingsStore();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  const { data: tagsData } = useTags({ server: activeServer });

  // Retrieve displaySet for series
  let seriesDisplaySet;
  if (selectedSeries && selectedSeries.displaySetInstanceUID) {
    seriesDisplaySet = displaySetService.getDisplaySetByUID(selectedSeries.displaySetInstanceUID);
  }

  const dcmTags = useMemo(() => {
    // Retrieve DICOM tags and map to header name
    
    const mapped = {};
    
    _.each(tagsData, (val, key) => {
      const _tags = {};

      // Re-map tags to tag name rather than tag hexcode
      _.each(_.values(val), (t) => { _tags[t.tag] = t; })
      mapped[key] = _tags;
    });
    
    return mapped;
  }, [tagsData]);

  // State properties
  const [isMetadataDropdownOpen, setIsMetadataDropdownOpen] = useState(false);
  const [extendedMetaSearch, setExtendedMetaSearch] = useState('');

  const metaDropdownTags = useMemo(() => {
    // Generate iterable of header tags which includes the display settings
    // from metadataSettings.

    const dropdownMetaDisplay = [];

    _.each(metadataSettings, ({ title, options }) => {

      // Clone summary table tags/options to prevent data corruption, use
      // summary table fields as start of extended meta table.
      const _tags = _.cloneDeep(options);

      // Add extended tags to metadata display table
      if (dcmTags && dcmTags[title] && !(title == 'Series' && !selectedSeries)) {
        _.each(_.values(dcmTags[title]), ({ tag, label }) => {

          // Check to see if the tag is already part of the extende meta display set.
          // If not, add it.
          const t = _tags.find((_t) => _t.id == tag);
          if (!t) {
            _tags.push({ id: tag, label, });
          }
        });
      }

      // Add group to the table
      dropdownMetaDisplay.push({ title, tags: _tags });
    });

    return dropdownMetaDisplay;
  }, [dcmTags, metadataSettings, selectedSeries]);

  const ref = useRef(null);
  useClickOutside(ref, () => {
    setIsMetadataDropdownOpen(false);
  });

  const studyDate = study?.StudyDate?.value ? moment(study.StudyDate.value, 'YYYYMMDD').format('MM/DD/YYYY') : '';

  
  const dcmValue = (id) => {
    // Retrieve requested value from series and study

    let value = id === 'StudyDate' ? studyDate : study[id]?.value;
    if (!value && id === 'numberOfStudyRelatedSeries') {
      value = seriesCount;
    }
    if (!value && selectedSeries) {
      value = selectedSeries[id];
    }
    if (!value && seriesDisplaySet) {
      value =seriesDisplaySet[id];
    }

    return value || undefined;
  }


  const filterTags = ({ id, label, value }) => {
    // Filter tags based on whether a study/series is selected and whether it matches
    // the extended meta search string.

    let matchSearch;
    if (debouncedExtendedMetaSearch) {

      // Check if the search text matches the label, tag ID, or tag value
      matchSearch = label.toLowerCase().includes(debouncedExtendedMetaSearch.toLowerCase())
        || id.toLowerCase().includes(debouncedExtendedMetaSearch.toLowerCase())
        || (value && _.isString(value) && value.toLowerCase().includes(debouncedExtendedMetaSearch.toLowerCase()));

    } else { matchSearch = true; }

    if (id == 'numberOfStudyRelatedSeries' || id == 'modalities') {
      return matchSearch && !selectedSeries;
    }

    return matchSearch && !_.isNil(value);
  }


  const handleChangeExtendedMetaSearch = (e) => {
    setExtendedMetaSearch(e.target.value);
  }
  const debouncedExtendedMetaSearch = useDebounce(extendedMetaSearch, 500);


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
              <input type="text" 
                placeholder="Search Fields..." 
                className={styles.metadataDropdownSearchInput}
                onChange={handleChangeExtendedMetaSearch}
              />
            </div>
            {metaDropdownTags.map(({ title, tags }) => {
              return (
                <div key={title}>
                  <p className={styles.metadataDropdownGroupTitle}>{title}</p>
                  {tags.map(({ label, id, isSelected }) => {
                    return { id, label, isSelected, value: dcmValue(id) };
                  }).filter(filterTags).map(({ label, id, isSelected, value }) => {
                    return (
                      <div key={label} className={styles.metadataDropdownItem}>
                        <div className={styles.metadataDropdownItemLeft}>
                          {!_.isNil(isSelected) && (
                            <>
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
                            </>
                          )}
                          <p className={styles.metadataDropdownItemLabel}>{label}</p>
                        </div>
                        <p className={styles.metadataDropdownItemValue}>
                          {value}
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
          <div key={title} className={styles.contentGroupContainer}>
            <p className={styles.contentMetadataGroupTitle}>{title}</p>
            {options
              .filter(({ isSelected, id }) => {
                if (id === 'numberOfStudyRelatedSeries'){
                  return isSelected && !selectedSeries
                }
                return isSelected;
              })
              .map(({ label, id }) => {
                return { id, label, value: dcmValue(id), };
              })
              .filter(({ value }) => !_.isNil(value))
              .map(({ label, id, value }) => {
                return (
                  <div key={label} className={styles.contentMetadataItem}>
                    <p className={styles.contentMetadataItemLabel}>{label}</p>
                    <p className={styles.contentMetadataItemValue}>
                      {value}
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
  series: PropTypes.object,
  selectedSeries: PropTypes.oneOfType(null, PropTypes.string)
};
