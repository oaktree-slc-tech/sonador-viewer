import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { flatten } from 'lodash';
import PropTypes from 'prop-types';

import SelectDropdownNG from '@ohif/ui/src/components/SelectDropdownNG/SelectDropdownNG';
import SettingsIcon from '@ohif/ui/src/elements/Svg/svgs/settings.svg';

import useTags from '../../../../../hooks/useTags';
import { DEFAULT_COLUMNS, DEFAULT_COLUMNS_IDS, FILTER_TYPES } from '../../../../../lib/constants';
import { useColumnsSelectStore } from '../../../../../store/useColumnsSelectStore';

import styles from './SettingsHeader.module.scss';


export default function SettingsHeader({  selectedColumns, setSelectedColumns }) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const { isOpenColumnsSelect, setIsOpenColumnsSelect } = useColumnsSelectStore();

  const { data: tags } = useTags({ server:activeServer });

  const columns = useMemo(() => {
    if (tags) {
      const mapped = Object.entries(tags)
        .filter(([key]) => key !== 'Instance' && key !== 'Series')
        .map(([, filtersObj]) => {
          return Object.values(filtersObj)
            .filter((filter) => filter.vr?.name !== 'Time') // TODO remove once time data is actual to display
            .map((filter) => {
              const type = filter.options ? 'select' : FILTER_TYPES[filter.vr?.name];

              return {
                id: filter.tag === 'Modality' ? 'modalities' : filter.tag,
                type,
                label: filter.label,
              };
            });
        });

      return flatten(mapped).concat([{ id: 'modalities', type: 'search', label: 'Modality' }]);
    }

    return DEFAULT_COLUMNS;
  }, [tags]);

  const handleSelectOption = (id, e) => {
    const { checked } = e.target;
    setSelectedColumns(checked ? [...selectedColumns, id] : selectedColumns.filter((item) => item !== id));
  };

  return (
    <SelectDropdownNG
      isOpen={isOpenColumnsSelect}
      setIsOpen={setIsOpenColumnsSelect}
      Button={() => <SettingsIcon className={styles.settings} fill="#a9a9a9" />}
      title="Select Columns"
      isSearch
      options={columns}
      selectedOptions={selectedColumns}
      onSelectOption={handleSelectOption}
      onSelectAllOptions={() =>
        setSelectedColumns(selectedColumns.length === columns.length ? [] : columns.map((item) => item.id))
      }
      onClickAction={() => setSelectedColumns(DEFAULT_COLUMNS_IDS)}
    />
  );
}


SettingsHeader.propTypes = {
  selectedColumns: PropTypes.arrayOf(PropTypes.string),
  setSelectedColumns: PropTypes.func,
};
