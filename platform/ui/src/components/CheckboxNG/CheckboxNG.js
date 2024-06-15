import React, { useEffect, useRef } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import styles from './CheckboxNG.module.scss';

export default function CheckboxNG({ checked, onChange, indeterminate, id, label = '', classes = {}, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    if (typeof indeterminate === 'boolean') {
      ref.current.indeterminate = !rest.checked && indeterminate;
    }
  }, [indeterminate, rest.checked]);

  return (
    <label
      onClick={(event) => event.stopPropagation()}
      className={classNames(
        styles.container,
        {
          [styles.withLabel]: !!label,
          [styles.indeterminate]: indeterminate,
        },
        classes.label
      )}
    >
      {label && <span className={styles.label}>{label}</span>}
      <input
        id={id}
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        onChange={onChange}
        ref={ref}
        {...rest}
      />
      <span className={classNames(styles.checkmark, classes.checkmark)} />
    </label>
  );
}

CheckboxNG.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  indeterminate: PropTypes.bool,
  id: PropTypes.string,
  label: PropTypes.string,
  classes: PropTypes.shape({
    checkmark: PropTypes.string,
  }),
};
