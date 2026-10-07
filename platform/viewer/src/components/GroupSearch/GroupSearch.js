import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { groupSearchQueryKey, searchGroups } from '../../api/groups';
import useClickOutside from '../../hooks/useClickOutside';

import styles from '../../styles/groupSearch.module.scss';

/**
 * Group picker for the group-scoped settings editors: a search box over the Sonador groups of
 * the active server, narrowed by a policy-flag filter, with a dropdown of matches. The selection
 * clears when the server changes or the user edits the search text.
 */
export default function GroupSearch({ server, filter, value, onChange, label = 'Select Group', placeholder = 'Search for group', id = 'group-search' }) {
  const [term, setTerm] = useState(value ? value.name : '');
  const [showMatches, setShowMatches] = useState(false);
  const container = useRef(null);
  useClickOutside(container, useCallback(() => setShowMatches(false), []), showMatches);

  const { data: matches = [] } = useQuery({
    queryKey: groupSearchQueryKey(server, filter, term),
    queryFn: () => searchGroups(server, term, filter),
    enabled: !!(server && server.token),
  });

  useEffect(() => {
    setTerm('');
    setShowMatches(false);
    onChange(null);
  }, [server]);

  const select = group => {
    setTerm(group.name);
    setShowMatches(false);
    onChange(group);
  };

  return (
    <div className={styles.inputGroup} ref={container}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={term}
        placeholder={placeholder}
        className={styles.input}
        autoComplete="off"
        onChange={event => {
          setTerm(event.target.value);
          setShowMatches(true);
          if (value) {
            onChange(null);
          }
        }}
        onFocus={() => setShowMatches(true)}
      />
      {showMatches && !value && matches.length > 0 && (
        <ul className={styles.dropdown}>
          {matches.map(group => (
            <li key={group.id} className={styles.dropdownItem}>
              <button type="button" className={styles.dropdownBtn} onClick={() => select(group)}>
                {group.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

GroupSearch.propTypes = {
  server: PropTypes.object,
  filter: PropTypes.object,
  value: PropTypes.shape({ id: PropTypes.number, name: PropTypes.string }),
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  placeholder: PropTypes.string,
  id: PropTypes.string,
};
