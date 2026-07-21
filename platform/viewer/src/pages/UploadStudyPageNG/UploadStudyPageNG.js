import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import OHIF from '@ohif/core';

import Layout from '../../layouts/Layout/Layout';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';

import RecentUploadTable from './components/RecentUploadTable/RecentUploadTable';
import UploadFiles from './components/UploadFiles/UploadFiles';

const { redux } = OHIF;


export default function UploadStudyPageNG() {

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
