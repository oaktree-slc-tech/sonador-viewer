import { useEffect } from 'react';

export default function useClickOutside(elementRef, callback) {
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (Array.isArray(elementRef)) {
        if (!elementRef[0].current?.contains(event.target) && !elementRef[1].current?.contains(event.target)) {
          callback();
        }
      } else {
        if (!elementRef.current?.contains(event.target)) {
          callback();
        }
      }
    };

    document.addEventListener('click', handleClickOutside, true);

    return () => {
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [elementRef, callback]);
}
