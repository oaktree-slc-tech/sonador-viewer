import React, { useState } from 'react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as ChevronDownIcon } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';

import styles from './SelectNG.module.scss';

export default function SelectNG({ options = [], selected = {}, onChange }) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(10), flip({ fallbackAxisSideDirection: 'end' }), shift()],
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <>
      <button ref={refs.setReference} {...getReferenceProps()} className={styles.selectBtn}>
        <span>{selected.title}</span>
        <ChevronDownIcon fill="#A6CDF5" className={classNames({ [styles.opened]: isOpen })} />
      </button>
      {isOpen && (
        <FloatingFocusManager context={context} modal={false}>
          <ul ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className={styles.list}>
            {options.map((item) => {
              return (
                <li
                  key={item.value}
                  onClick={() => {
                    onChange(item);
                    setIsOpen(false);
                  }}
                  className={styles.item}
                >
                  {item.title}
                </li>
              );
            })}
          </ul>
        </FloatingFocusManager>
      )}
    </>
  );
}

SelectNG.propTypes = {
  options: PropTypes.array.isRequired,
  selected: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};
