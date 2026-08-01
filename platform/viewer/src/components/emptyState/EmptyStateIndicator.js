import React from 'react';
import ReactMarkdown from 'react-markdown';

import WhiteLabelingContext from '../../context/WhiteLabelingContext';
import styles from './EmptyStateIndicator.module.scss';


/**
 * Presentational shell for the site's white-labeled markdown messages. Exported so that other
 * surfaces which show an operator-authored message -- currently the sign-out confirmation page --
 * render with exactly the same typography as the welcome/empty state message.
 */
export function BrandedMessage({ children }) {
  return (
    <div className={styles.messageContainer}>
      <ReactMarkdown>{children || ''}</ReactMarkdown>
    </div>
  );
}


export default function EmptyStateIndicator() {
  // Show empty state message for the viewer instance

  return (
    <WhiteLabelingContext.Consumer>
      {(whiteLabeling) => (
        <BrandedMessage>
          {whiteLabeling?.emptyStateMessageFn && whiteLabeling?.emptyStateMessageFn()}
        </BrandedMessage>
      )}
    </WhiteLabelingContext.Consumer>
  );
}
