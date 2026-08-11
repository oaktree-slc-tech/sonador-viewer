import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import OHIF from '@ohif/core';

import Layout from '../../layouts/Layout/Layout';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';
import PageHeaderNG from '../../components/PageHeaderNG/PageHeaderNG';

import RecentUploadTable from './components/RecentUploadTable/RecentUploadTable';
import UploadFiles from './components/UploadFiles/UploadFiles';

const { redux } = OHIF;


export default function UploadStudyPageNG() {
  const { t } = useTranslation('StudyList');

  const [forceRerender, setForceRerender] = useState(Math.random());

  const serverCount = useSelector(redux.selectors.serverCount);
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  
  // Permissions
  const canUpload = activeServer && activeServer?.perms?.upload;

  const refreshUploadTable = () => {
    setForceRerender(Math.random());
  }

  return (
    <>

      {(serverCount > 0) && canUpload && (
        // noHorizontalPadding matches Studies/Worklist/Shared: page components own the 40/30/20px
        // padding rails, and the results table's scrollbar reaches the right edge of the panel.
        <Layout noHorizontalPadding fixedHeight>
          {/* The same title row Studies, Worklist and Shared carry, rather than the bare title and
              notice this page used to render for itself — so Downloads, Offline Storage and the
              account menu are reachable from here too. */}
          <PageHeaderNG title={t('Upload')} />
          <UploadFiles onUpload={refreshUploadTable} />
          <RecentUploadTable key={forceRerender} />
        </Layout>
      )}

      {(serverCount == 0) && (
        <Layout noHorizontalPadding>
          <EmptyStateIndicator />
        </Layout>
      )}
    </>
  );
}
