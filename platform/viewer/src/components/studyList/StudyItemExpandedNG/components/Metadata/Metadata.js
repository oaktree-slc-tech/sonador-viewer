import _ from 'lodash';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import { DropdownMenu } from 'radix-ui';
import { DotsVerticalIcon } from '@radix-ui/react-icons';

import OHIF, { display, redux } from '@ohif/core';
import { useDebounce } from '@ohif/ui';

import { ReactComponent as ClosedEyeIcon } from '@ohif/ui/src/elements/Svg/svgs/closed-eye.svg';
import { ReactComponent as DownloadIcon } from '@ohif/ui/src/elements/Svg/svgs/cloud-download.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as FiltersIcon } from '@ohif/ui/src/elements/Svg/svgs/filters.svg';
import { ReactComponent as OfflineCacheIcon } from '@ohif/ui/src/elements/Icon/icons/offline-cache.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import useClickOutside from '../../../../../hooks/useClickOutside';
import useTags from '../../../../../hooks/useTags';
import { useMetadataSettingsStore } from '../../../../../store/useMetadataSettingsStore';

import radixStyles from '../../../../../styles/radixUi.module.scss';
import styles from './Metadata.module.scss';


export default function Metadata({
  study,
  selectedSeries,
  seriesCount,
  seriesAclView = false,
  seriesAclRemove = false,
  seriesIsCached = false,
  seriesIsTransferring = false,
  seriesTransferInFlight = false,
  onDownloadSeries,
  onSaveSeriesOffline,
  onRemoveSeriesOffline,
  onRemoveSeries,
  onSeriesActionsOpen,
}) {
  // Display study and series metadata

  const { t } = useTranslation('StudyList');

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


  // Series-scoped actions (ohif-viewers#127, FR-1/FR-2). The menu describes the SELECTED SERIES,
  // so it is absent while the STUDY tile is selected, and absent again when the user holds none of
  // the permissions its items need — a trigger that opens an empty menu, or one that is rendered
  // disabled, both advertise an operation the user cannot perform.
  const seriesActions = [];

  if (seriesAclView) {
    seriesActions.push({
      // Export this series as a .zip through the tracked archive queue. Named "Download Series" —
      // not "Download" — because the study-list row menu already carries a study-scoped
      // "Download", and #125's "Save Offline Copy"/"Remove Offline Copy" are a different
      // destination entirely (AR-9).
      id: 'download-series',
      label: t('Download Series'),
      Icon: DownloadIcon,
      iconClassName: classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon),
      onSelect: onDownloadSeries,
    });

    // Save THIS series into this browser's offline cache (ohif-viewers#130, FR-1/FR-2). Same
    // `view` gate as the export above. "Save Series Offline" against #125's study-scoped "Save
    // Offline Copy": neither is a variant of the other, and neither writes a file to the
    // computer -- that is what "Download Series" does (AR-1).
    //
    // Absent when the series is already cached, and absent while the STUDY transfer is writing it
    // -- queueing it then would start a second transfer of the same images.
    if (seriesIsTransferring || (!seriesIsCached && !seriesTransferInFlight)) {
      seriesActions.push({
        id: 'save-series-offline',
        label: seriesIsTransferring ? t('Cancel Transfer') : t('Save Series Offline'),
        Icon: OfflineCacheIcon,
        iconClassName: classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon),
        onSelect: onSaveSeriesOffline,
      });
    }
  }

  // Evicts this browser's cached copy. NOT gated on the server `remove` grant (FR-4) -- it touches
  // no server data -- and withheld while a transfer is still writing this series, so a removal can
  // never be silently undone by the job that follows it (FR-8).
  if (seriesIsCached && !seriesTransferInFlight) {
    seriesActions.push({
      id: 'remove-series-offline',
      label: t('Remove Offline Storage'),
      Icon: OfflineCacheIcon,
      iconClassName: classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon),
      onSelect: onRemoveSeriesOffline,
    });
  }

  if (seriesAclRemove) {
    seriesActions.push({
      // Permanently deletes the series from the imaging server. Named "Remove Series" against
      // #125's "Remove Offline Copy" — the two are not variants of one operation, and the
      // confirmation says which one this is in full (AR-9).
      id: 'remove-series',
      label: t('Remove Series'),
      Icon: TrashBinIcon,
      iconClassName: classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon),
      itemClassName: styles.seriesActionsItemDestructive,
      onSelect: onRemoveSeries,
    });
  }

  const showSeriesActions = !!selectedSeries && seriesActions.length > 0;


  return (
    <div className={styles.contentMetadata}>
      <div className={styles.contentMetadataHeader} ref={ref}>
        <FiltersIcon
          className={styles.metadataFilterIcon}
          onClick={() => setIsMetadataDropdownOpen((prevState) => !prevState)}
        />
        <p className={styles.contentMetadataTitle}>Metadata</p>

        {showSeriesActions && (
          // Right-aligned within the header: .contentMetadataHeader is a flex row with no
          // justify-content, so the trigger pushes itself over with margin-left: auto rather than
          // the whole row changing its distribution (which would move the filter icon and title).
          <DropdownMenu.Root
            onOpenChange={(open) => {
              if (open && onSeriesActionsOpen) {
                onSeriesActionsOpen();
              }
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                className={classNames(radixStyles.IconButton, styles.seriesActionsTrigger)}
                aria-label={t('Series Actions')}
              >
                <DotsVerticalIcon height={18} width={18} />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className={classNames(radixStyles.Content, styles.seriesActionsContent)}
                align="end"
                sideOffset={5}
              >
                {seriesActions.map(({ id, label, Icon, iconClassName, itemClassName, onSelect }) => (
                  <DropdownMenu.Item
                    key={id}
                    className={classNames(radixStyles.DropdownItem, styles.seriesActionsItem, itemClassName)}
                    onSelect={() => onSelect && onSelect()}
                  >
                    <Icon className={iconClassName} />
                    <span>{label}</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

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
  // The selected thumbnail, or null while the STUDY tile is selected. (Previously declared as
  // `PropTypes.oneOfType(null, PropTypes.string)` — wrong arity and wrong type for what is passed.)
  selectedSeries: PropTypes.object,
  seriesCount: PropTypes.number,
  // Series-scoped permissions and handlers are resolved by the drawer and passed down; this stays
  // a presentation component and does no fetching of its own (AR-8).
  seriesAclView: PropTypes.bool,
  seriesAclRemove: PropTypes.bool,
  // Offline-cache signals for the selected series (ohif-viewers#130). Read from the services by
  // the drawer and passed down, so this component still calls no service of its own (AR-2).
  seriesIsCached: PropTypes.bool,
  seriesIsTransferring: PropTypes.bool,
  seriesTransferInFlight: PropTypes.bool,
  onDownloadSeries: PropTypes.func,
  onSaveSeriesOffline: PropTypes.func,
  onRemoveSeriesOffline: PropTypes.func,
  onRemoveSeries: PropTypes.func,
  onSeriesActionsOpen: PropTypes.func,
};
