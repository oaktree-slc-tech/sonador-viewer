import React, { useContext, useState } from 'react';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import AppContext from '@ohif/sonador-viewer/src/context/AppContext';
import useSeriesMetadata from '@ohif/sonador-viewer/src/hooks/useSeriesMetadata';
import * as RoutesUtil from '@ohif/sonador-viewer/src/routes/routesUtil';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import { ReactComponent as DotsIcon } from '@ohif/ui/src/elements/Svg/svgs/dots.svg';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';

import { useDeviceStore } from '../../../store/useDeviceStore';

import Comments from './components/Comments/Comments';
import { useAllSeriesComments, useStudyComments } from './components/Comments/logic';
import ImageThumbnailNG from './components/ImageThumbnailNG/ImageThumbnailNG';
import Metadata from './components/Metadata/Metadata';
import TabletMobileTabs from './components/TabletMobileTabs/TabletMobileTabs';
// import { useSeriesMetadata } from './logic';
import { ReactComponent as StudyCopyIcon } from './study-copy.svg';

import styles from './StudyItemExpandedNG.module.scss';

export default function StudyItemExpandedNG({ studyId, server, study }) {
  // Show details for the currently selected study

  const { appConfig } = useContext(AppContext);

  const { data } = useSeriesMetadata({ studyId, server });
  const { isDesktop, isLarge } = useDeviceStore();

  // Selected thumbnail and series
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);
  const [selectedStudy, setSelectedStudy] = useState(studyId);

  const allSeries = data?.[0]?.thumbnails;
  const { data: allSeriesCommentsArr = [] } = useAllSeriesComments(server, allSeries);
  const { data: studyCommentsArr = [] } = useStudyComments(server, studyId);

  const handleClickOpenInViewer = () => {
    const link = RoutesUtil.parseViewerPath(appConfig, server, {
      studyInstanceUIDs: studyId,
    });

    window.open(link, '_blank');
  };

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
          <>
            <div
              role="button"
              className={classNames(styles.studyItem, {
                [styles.active]: selectedStudy,
              })}
              onClick={() => {
                setSelectedThumbnail(null);
                setSelectedStudy(studyId);
                // TODO set study as selected
              }}
            >
              {studyCommentsArr.length ? <div className={styles.countWrapper}>
                      <span className={styles.countNumber}>
                    {studyCommentsArr.length}
                    </span>
                </div>
                : null}
              <StudyCopyIcon />
              <span>STUDY</span>
            </div>
            <div className={styles.spacer} />
            {data?.[0]?.thumbnails?.map((thumbnail, index) => {
              const currentElementInCommentsArray = allSeriesCommentsArr.find(el => el.SeriesInstanceUID === thumbnail.SeriesInstanceUID);
              const count = currentElementInCommentsArray?.response?.length;

              return (
                <div
                  role="button"
                  key={index}
                  className={classNames(styles.item, {
                    [styles.active]: selectedThumbnail?.SeriesInstanceUID === thumbnail.SeriesInstanceUID,
                  })}
                  onClick={() => {
                    setSelectedThumbnail(thumbnail);
                    setSelectedStudy(null);
                  }}
                >
                  {count ? <div className={styles.countWrapper}>
                      <span className={styles.countNumber}>
                    {count}
                    </span>
                    </div>
                    : null}
                  <ImageThumbnailNG
                    key={thumbnail.imageId}
                    active={selectedThumbnail?.imageId === thumbnail.imageId}
                    imageSrc=""
                    imageId={thumbnail.imageId}
                    error={false}
                    width={120}
                    height={120}
                    altImageText={thumbnail.altImageText}
                  />
                  <p className={styles.thumbnailName}>{thumbnail.SeriesDescription}hello</p>
                </div>
              );
            })}
          </>
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
            {isDesktop && selectedThumbnail && (
              <div>
                <ImageThumbnailNG
                  active={false}
                  imageSrc=""
                  imageId={selectedThumbnail?.imageId}
                  error={false}
                  width={240}
                  height={240}
                  altImageText={selectedThumbnail?.altImageText}
                />
                {openInViewerButton}
              </div>
            )}
            <Metadata study={study} />
            <Comments server={server} series={selectedThumbnail} studyId={selectedStudy} />
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
