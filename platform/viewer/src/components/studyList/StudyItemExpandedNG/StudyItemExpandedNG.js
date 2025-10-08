import _ from 'lodash';

import React, { useContext, useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import { DropdownMenu } from 'radix-ui';
import {
  ChevronDownIcon, 
} from '@radix-ui/react-icons';

import OHIF, { display, redux, DicomMetadataStore, utils, sonador } from '@ohif/core';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import { ReactComponent as EyeIcon } from '@ohif/ui/src/elements/Svg/svgs/eye.svg';
import { ReactComponent as Cube3dIcon } from '@ohif/ui/src/elements/Icon/icons/cube-3d-solid.svg';
import { ReactComponent as InelineEditIcon } from '@ohif/ui/src/elements/Icon/icons/inline-edit.svg';

import AppContext from '@ohif/sonador-viewer/src/context/AppContext';
import useSeriesMetadata from '@ohif/sonador-viewer/src/hooks/useSeriesMetadata';
import * as RoutesUtil from '@ohif/sonador-viewer/src/routes/routesUtil';

import { useDeviceStore } from '../../../store/useDeviceStore';
import { fetchStudyAclPermissions } from '../../../api/ext';

import Comments from './components/Comments/Comments';
import { useAllSeriesComments, useStudyComments } from './components/Comments/logic';
import ImageThumbnailNG from './components/ImageThumbnailNG/ImageThumbnailNG';
import Metadata from './components/Metadata/Metadata';
import TabletMobileTabs from './components/TabletMobileTabs/TabletMobileTabs';
import { ReactComponent as StudyCopyIcon } from './study-copy.svg';

import radixStyles from '../../../styles/radixUi.module.scss';
import styles from './StudyItemExpandedNG.module.scss';


export default function StudyItemExpandedNG({ studyId,  study }) {
  // Drawer control for Sonador Viewer Study List

  const displaySetApi = display.DisplaySetApi.Instance;
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  
  // Show details for the currently selected study
  const { appConfig } = useContext(AppContext);
  const _study = DicomMetadataStore.getStudy(studyId);
  if (!_study) {
    DicomMetadataStore.addStudy({ StudyInstanceUID: studyId });
  }
  const studyMeta = DicomMetadataStore.getStudyMetadata(studyId);

  // Access permissions
  const ohif3Enabled = activeServer?.ohifEnabled;
  const aclUpload = activeServer.perms.upload;
  const [aclView, setAclView] = useState(activeServer?.perms?.view || studyMeta?.perms?.View || false);
  const [aclComments, setAclComments] = useState(activeServer?.perms?.comment_view || studyMeta.perms?.CommentView || aclView || false);
  const [aclCommentEdit, setAclCommentEdit] = useState(activeServer?.perms?.comment_edit || studyMeta.perms?.CommentEdit || false);

  useEffect(() => {
    // Sonador Viewer Service Integration

    // Subscribe to changes in series metadata to update permissions/display
    const dcm_meta_studychange_subscription = DicomMetadataStore.subscribe(
      DicomMetadataStore.EVENTS.STUDY_UPDATED, ({ StudyInstanceUID, studyMetadata }) => {
        if (StudyInstanceUID == studyId) {

          if (!aclView && studyMetadata?.perms?.View) {
            setAclView(studyMetadata?.perms?.View);
          }

          if (!aclComments && (studyMetadata?.perms?.CommentView || aclView)) {
            setAclComments(studyMetadata?.perms?.CommentView || aclView);
          }

          if (!aclCommentEdit && studyMetadata?.perms?.CommentEdit) {
            setAclCommentEdit(studyMetadata?.perms?.CommentEdit);
          }
        }
      });

    return () => {

      // Remove displaySets associated with the study when the drawer is closed/unmounted
      _.each(displaySetApi.displaySetService.getDisplaySetsForStudy(studyId), (ds) => {
        displaySetApi.displaySetService.deleteDisplaySet(ds.displaySetInstanceUID);
      });

      // Unsubscribe from external service subscriptions
      dcm_meta_studychange_subscription.unsubscribe();
    }
  }, []);

  useEffect(() => {
    // Update permissions dependent on the series "view" permission
    
    if (!aclComments && aclView) {
      setAclComments(aclView);
    }
  }, [aclView]);


  useEffect(() => {    
    // Retrieve ACL permissions (if not already specified in DicomMetadataStore)
    
    const _fetchAcl = async () => {
      const resourcePerms = await fetchStudyAclPermissions(activeServer, studyId);
      DicomMetadataStore.updateStudyMetadata(_.omit(resourcePerms, 'Level'));
    }

    if (activeServer && studyMeta && !aclView && !studyMeta.perms) {
      _fetchAcl();
    }
  }, []);

  // Initialize displaySets for the drawer and retrieve thumbnail data
  const { data } = useSeriesMetadata({ studyId, server: activeServer });

  const { isDesktop, isLarge } = useDeviceStore();

  // Selected thumbnail and series
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);
  const [selectedStudy, setSelectedStudy] = useState(studyId);

  const allSeries = data?.[0]?.thumbnails;
  const { data: allSeriesCommentsArr = [] } = useAllSeriesComments(activeServer, aclComments ? allSeries : []);
  const { data: studyCommentsArr = [] } = useStudyComments(activeServer, aclComments ? studyId : undefined);

  
  const handleClickOpenInViewer = () => {
    // Open link in Sonador Viewer

    const link = RoutesUtil.parseViewerPath(appConfig, activeServer, {
      studyInstanceUIDs: studyId,
    });

    window.open(link, '_blank');
  };


  const handleClickOpenOhif3 = (link, queryOptions) => {
    // Open link in OHIF v3 instance on Orthanc
    queryOptions = queryOptions || {};

    // Add StudyInstance UID to the query options
    _.extend(queryOptions, {
      StudyInstanceUIDs: studyId,
    });
      
    // Create Sonador / Orthanc OHIF URL
    const _url = utils.urlUtil.buildUrl(activeServer.rootUrl, link, queryOptions);
    window.open(`${_url}&token=${sonador.getAuthToken()}`, '_blank');
  }


  return (
    <div className={styles.container}>

      {aclView && (
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
                {(aclComments && studyCommentsArr.length) ? <div className={styles.countWrapper}>
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
                    <p className={styles.thumbnailName}>{thumbnail.SeriesDescription}</p>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      
      <div className={styles.content}>
        <div className={styles.contentHeader}>
          <div>
            <p className={styles.studyName}>{selectedThumbnail?.SeriesDescription}</p>
            <p className={styles.studyDate}>
              {study.StudyDate && moment(study.StudyDate.value, 'YYYYMMDD').format('MMM DD, YYYY')}
            </p>
          </div>
          {aclView && (
            <div className={styles.viewerLinksContainer}>
              <button className={ohif3Enabled ? styles.openInViewerSplit : styles.openInViewer} 
                  onClick={handleClickOpenInViewer}>
                <EyeIcon className={radixStyles.icon15x} />
               <span>Open in Viewer</span>
             </button>
             {ohif3Enabled && (
                <DropdownMenu.Root>
                
                  <DropdownMenu.Trigger asChild>
                    <button className={classNames(radixStyles.IconButton, styles.moreViewersIconButton)} aria-label="Open In Viewer Links">
                      <ChevronDownIcon height={25} width={25} />
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className={classNames(radixStyles.Content, styles.moreViewersContentContainer)} sideOffset={5}>
                      <DropdownMenu.Item className={radixStyles.DropdownItem} onClick={() => handleClickOpenOhif3('/ohif/viewer')}>
                          <EyeIcon className={classNames(radixStyles.icon15x, radixStyles.DropDownSvgIcon)} />
                          <span>View in Sonador / OHIF</span>
                        </DropdownMenu.Item>
                      <DropdownMenu.Item className={radixStyles.DropdownItem}
                          onClick={() => handleClickOpenOhif3('/ohif/viewer', { hangingprotocolId: 'mprAnd3DVolumeViewport' })}>
                        <Cube3dIcon className={classNames(radixStyles.icon12x, radixStyles.DropDownSvgIcon)} />
                        <span>View in Volume Rendering Mode</span>
                      </DropdownMenu.Item>
                      {aclUpload && (
                        <DropdownMenu.Item className={radixStyles.DropdownItem} onClick={() => handleClickOpenOhif3('/ohif/segmentation')}>
                          <InelineEditIcon className={radixStyles.DropDownSvgIcon} />
                          <span>View in Segmentation Editor</span>
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>

               </DropdownMenu.Root>
             )}
            </div>
          )}
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
              </div>
            )}
            
            <Metadata 
              study={study} seriesCount={data?.[0]?.thumbnails?.length??0} 
              selectedSeries={selectedThumbnail}
            />
            
            {aclComments && (
              <Comments  series={selectedThumbnail} studyId={selectedStudy} commentsEdit={aclCommentEdit} />
            )}
          </div>
        ) : (
          <TabletMobileTabs study={study} series={selectedThumbnail} />
        )}
      </div>
    </div>
  );
}


StudyItemExpandedNG.propTypes = {
  studyId: PropTypes.string.isRequired,
  study: PropTypes.object.isRequired,
};
