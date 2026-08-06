import _ from 'lodash';

import React, { useCallback, useContext, useState, useEffect, useMemo, useRef } from 'react';
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
import {
  fetchDownloadSeries,
  fetchSeriesAclPermissions,
  fetchStudyAclPermissions,
} from '../../../api/ext';
import { _getStudyDescriptor } from '../StudyListNG/components/SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell';

import RemoveResourceConfirm from '../StudyListNG/components/RemoveResourceConfirm/RemoveResourceConfirm';
import useRemoveResource from '../StudyListNG/hooks/useRemoveResource';

import Comments from './components/Comments/Comments';
import { useAllSeriesComments, useStudyComments } from './components/Comments/logic';
// NOTE: the ReviewHistory drawer panel (components/ReviewHistory) is intentionally not
// rendered yet — the timeline layout is pending a design round (orthanc-sonador#54)
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
  const [aclComments, setAclComments] = useState(activeServer?.perms?.comment_view || studyMeta.perms?.CommentView || false);
  const [aclCommentEdit, setAclCommentEdit] = useState(activeServer?.perms?.comment_edit || studyMeta.perms?.CommentEdit || false);
  // Study-level `remove` grant. Distinct from #125's offline-cache eviction, which needs no
  // server permission at all: this one destroys the data on the imaging server.
  const [aclRemove, setAclRemove] = useState(activeServer?.perms?.remove || studyMeta?.perms?.Remove || false);

  useEffect(() => {
    // Sonador Viewer Service Integration

    // Subscribe to changes in series metadata to update permissions/display
    const dcm_meta_studychange_subscription = DicomMetadataStore.subscribe(
      DicomMetadataStore.EVENTS.STUDY_UPDATED, ({ StudyInstanceUID, studyMetadata }) => {
        if (StudyInstanceUID == studyId) {

          if (!aclView && studyMetadata?.perms?.View) {
            setAclView(studyMetadata?.perms?.View);
          }

          if (!aclComments && (studyMetadata?.perms?.CommentView)) {
            setAclComments(studyMetadata?.perms?.CommentView);
          }

          if (!aclCommentEdit && studyMetadata?.perms?.CommentEdit) {
            setAclCommentEdit(studyMetadata?.perms?.CommentEdit);
          }

          if (!aclRemove && studyMetadata?.perms?.Remove) {
            setAclRemove(studyMetadata?.perms?.Remove);
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

  // Series-granular ACL grants (ohif-viewers#127, FR-9/AR-8).
  //
  // Resolved here, not in Metadata: the drawer already owns selection and the study-level signals,
  // and Metadata stays a presentation component. The effective permission for a series action is
  // `study-or-server grant OR series grant` — a series grant can authorise where the study grant
  // does not, and the study grant covers its series by inheritance. Because
  // `activeServer.perms.*` is wildcard-only (true only for a superuser or a `resource: '*'` group
  // policy), gating on it alone would hide these actions from exactly the users the ACL system
  // exists to serve.
  //
  // Fetched lazily on menu open and cached per series for the lifetime of the drawer; the cache is
  // keyed by SeriesInstanceUID, so switching series simply misses rather than needing invalidation.
  const [seriesPerms, setSeriesPerms] = useState({});
  const seriesAclInFlight = useRef({});

  const selectedSeriesUID = selectedThumbnail?.SeriesInstanceUID;

  const resolveSeriesAcl = useCallback(async () => {
    // Lazy per-series ACL fetch, issued when the series Actions menu opens.

    if (!activeServer || !selectedSeriesUID) {
      return;
    }
    // Already resolved, or a resolution for this series is already in flight (the trigger can be
    // re-opened faster than the request settles).
    if (selectedSeriesUID in seriesPerms || seriesAclInFlight.current[selectedSeriesUID]) {
      return;
    }

    seriesAclInFlight.current[selectedSeriesUID] = true;

    try {
      const resourcePerms = await fetchSeriesAclPermissions(activeServer, selectedSeriesUID);
      setSeriesPerms((prev) => ({ ...prev, [selectedSeriesUID]: resourcePerms?.perms || {} }));
    } catch (err) {
      // A failed lookup must not strand the menu in a permanently-loading state. Record an empty
      // grant so the study/server signals still decide, and allow a later retry.
      OHIF.log.error(`Unable to retrieve ACL permissions for series=${selectedSeriesUID}`, err);
      setSeriesPerms((prev) => ({ ...prev, [selectedSeriesUID]: {} }));
    } finally {
      delete seriesAclInFlight.current[selectedSeriesUID];
    }
  }, [activeServer, selectedSeriesUID, seriesPerms]);

  const selectedSeriesPerms = selectedSeriesUID ? seriesPerms[selectedSeriesUID] : undefined;
  const seriesAclView = !!(aclView || selectedSeriesPerms?.View);
  const seriesAclRemove = !!(aclRemove || selectedSeriesPerms?.Remove);

  const seriesDescriptor = useMemo(() => {
    // Descriptor for the selected series, assembled from three sources (ohif-viewers#127, §5.2):
    // the thumbnail carries SeriesInstanceUID/SeriesNumber/SeriesDescription but NOT Modality or
    // StudyInstanceUID, Modality comes off the display set, and the patient/study attributes come
    // off the study-list row (react-table cells are `{ value, label, type }` triples, which
    // _getStudyDescriptor already unwraps — reused rather than reimplemented).
    if (!selectedThumbnail) {
      return null;
    }

    const displaySet = selectedThumbnail.displaySetInstanceUID
      ? displaySetApi.displaySetService.getDisplaySetByUID(selectedThumbnail.displaySetInstanceUID)
      : undefined;

    return {
      ..._getStudyDescriptor({ row: { original: study }, StudyInstanceUID: studyId, studyMeta }),
      SeriesInstanceUID: selectedThumbnail.SeriesInstanceUID,
      SeriesNumber: selectedThumbnail.SeriesNumber,
      SeriesDescription: selectedThumbnail.SeriesDescription,
      Modality: displaySet?.Modality,
      numImageFrames: selectedThumbnail.numImageFrames,
      // What the removal confirmation states will be destroyed. The display set's image list is
      // the instance count; numImageFrames is the fallback and counts frames, which for a
      // single-frame series is the same number.
      numberOfSeriesRelatedInstances: displaySet?.images?.length ?? selectedThumbnail.numImageFrames,
    };
  }, [selectedThumbnail, study, studyId]);


  const handleDownloadSeries = () => {
    // Queue a zip-archive export of the selected series (ohif-viewers#127, FR-3).
    //
    // fetchDownloadSeries is the existing adapter onto ArchiveDownloadService, which has handled
    // `kind: 'series'` end to end since #52 and until now had no caller: the bounded queue,
    // streaming progress, cancellation, de-duplication, the Downloads-menu series row and the
    // queued/completed notifications all come along by calling it. There is deliberately no new
    // command and no second code path (AR-3).
    if (!seriesDescriptor?.SeriesInstanceUID) {
      return;
    }

    fetchDownloadSeries(activeServer, seriesDescriptor.SeriesInstanceUID, seriesDescriptor);
  };


  // Pending series removal (ohif-viewers#127, FR-4). The descriptor is captured when the menu item
  // is chosen rather than read from `seriesDescriptor` at confirm time, so the overlay keeps
  // naming the series the user actually picked even if selection moves underneath it.
  const [pendingSeriesRemoval, setPendingSeriesRemoval] = useState(null);
  const { isRemoving, removeSeriesResource } = useRemoveResource();

  const handleConfirmRemoveSeries = async () => {
    const descriptor = pendingSeriesRemoval;
    const ok = await removeSeriesResource(activeServer, descriptor);

    setPendingSeriesRemoval(null);

    if (ok && selectedThumbnail?.SeriesInstanceUID === descriptor?.SeriesInstanceUID) {
      // Selection falls back to the STUDY tile: the series it pointed at no longer exists, and
      // leaving it selected would leave the Metadata panel describing a deleted resource until
      // the rail's refetch lands.
      setSelectedThumbnail(null);
      setSelectedStudy(studyId);
    }
  };


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
              seriesAclView={seriesAclView}
              seriesAclRemove={seriesAclRemove}
              onDownloadSeries={handleDownloadSeries}
              onRemoveSeries={() => setPendingSeriesRemoval(seriesDescriptor)}
              onSeriesActionsOpen={resolveSeriesAcl}
            />
            
            {aclView && aclComments && (
              <Comments  series={selectedThumbnail} studyId={selectedStudy} commentsEdit={aclCommentEdit} />
            )}
          </div>
        ) : (
          <TabletMobileTabs study={study} series={selectedThumbnail} studyId={selectedStudy}
            commentsEdit={aclCommentEdit} />
        )}
      </div>

      {/* Blocking removal confirmation, covering the whole drawer so nothing in it — including the
          thumbnail rail and the Open in Viewer controls — is clickable until the user confirms or
          cancels. .container is the positioned ancestor its `absolute; inset: 0` anchors to. */}
      {pendingSeriesRemoval && (
        <RemoveResourceConfirm
          kind="series"
          descriptor={pendingSeriesRemoval}
          isRemoving={isRemoving}
          onConfirm={handleConfirmRemoveSeries}
          onCancel={() => setPendingSeriesRemoval(null)}
        />
      )}
    </div>
  );
}


StudyItemExpandedNG.propTypes = {
  studyId: PropTypes.string.isRequired,
  study: PropTypes.object.isRequired,
};
