import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSelector } from 'react-redux';

import WhiteLabelingContext from '../../context/WhiteLabelingContext';
import styles from './EmptyStateIndicator.module.scss';


export default function EmptyStateIndicator() {
  // Show empty state message for the viewer instance

  return (
    <WhiteLabelingContext.Consumer>
      {(whiteLabeling) => (
        <div className={styles.messageContainer}>
        <ReactMarkdown>{whiteLabeling?.emptyStateMessageFn && whiteLabeling?.emptyStateMessageFn()}</ReactMarkdown>
        </div>
      )}      
    </WhiteLabelingContext.Consumer>
  );
}