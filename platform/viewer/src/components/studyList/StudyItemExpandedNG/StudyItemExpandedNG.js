import React, { useContext, useEffect, useState } from 'react';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import Loader from '@ohif/ui/src/components/Loader/Loader';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import AppContext from '@ohif/viewer/src/context/AppContext';
import * as RoutesUtil from '@ohif/viewer/src/routes/routesUtil';

import { useDeviceStore } from '../../../store/useDeviceStore';

import Comments from './components/Comments/Comments';
import ImageThumbnailNG from './components/ImageThumbnailNG/ImageThumbnailNG';
import Metadata from './components/Metadata/Metadata';
import TabletMobileTabs from './components/TabletMobileTabs/TabletMobileTabs';
import { useSeriesMetadata } from './logic';

import styles from './StudyItemExpandedNG.module.scss';

export default function StudyItemExpandedNG({ studyId, server, study }) {
  // Show details for the currently selected study

  const { appConfig } = useContext(AppContext);

  const { data } = useSeriesMetadata({ studyId, server });
  const { isDesktop, isLarge } = useDeviceStore();

  // Selected thumbnail and series
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);

  const handleClickOpenInViewer = () => {
    const link = RoutesUtil.parseViewerPath(appConfig, server, {
      studyInstanceUIDs: studyId,
    });

    window.open(link, '_blank');
  };

  useEffect(() => {
    // Set the currently active thumbnail and series
    if (data?.[0]?.thumbnails.length && !selectedThumbnail) {
      setSelectedThumbnail(data[0].thumbnails[0]);
    }
  }, [data, selectedThumbnail]);

  const openInViewerButton = server?.perms.view && (
    <button className={styles.openInViewer} onClick={handleClickOpenInViewer}>
      <EyeIcon />
      <span>Open in Viewer</span>
    </button>
  );

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {!data ? (
          <Loader />
        ) : (
          data?.[0]?.thumbnails?.map((thumbnail, index) => {
            return (
              <div
                key={index}
                className={classNames(styles.item, {
                  [styles.active]: selectedThumbnail?.imageId === thumbnail.imageId,
                })}
              >
                <ImageThumbnailNG
                  key={thumbnail.imageId}
                  active={selectedThumbnail?.imageId === thumbnail.imageId}
                  imageSrc=""
                  imageId={thumbnail.imageId}
                  error={false}
                  width={120}
                  height={120}
                  onClick={() => {
                    setSelectedThumbnail(thumbnail);
                  }}
                />
                <p className={styles.thumbnailName}>{thumbnail.SeriesDescription}</p>
                {/*<p className={styles.thumbnailDate}>Jan 5, 2020 15:22:01</p>*/}
              </div>
            );
          })
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.contentHeader}>
          <div>
            <p className={styles.studyName}>{selectedThumbnail?.SeriesDescription}</p>
            <p className={styles.studyDate}>
              {study.StudyDate && moment(study.StudyDate.value, 'YYYYMMDD').format('MMM DD, YYYY')}
            </p>
          </div>
          {isDesktop ? <DotsIcon /> : openInViewerButton}
        </div>
        {isDesktop || isLarge ? (
          <div className={styles.contentData}>
            {isDesktop && (
              <div>
                <ImageThumbnailNG
                  active={false}
                  imageSrc=""
                  imageId={selectedThumbnail?.imageId}
                  error={false}
                  width={240}
                  height={240}
                />
                {openInViewerButton}
              </div>
            )}
            <Metadata study={study} />
            <Comments server={server} series={selectedThumbnail} />
          </div>
        ) : (
          <TabletMobileTabs server={server} study={study} series={selectedThumbnail} />
        )}
      </div>
    </div>
  );
}

StudyItemExpandedNG.propTypes = {
  studyId: PropTypes.string.isRequired,
  server: PropTypes.object.isRequired,
  study: PropTypes.object.isRequired,
};
