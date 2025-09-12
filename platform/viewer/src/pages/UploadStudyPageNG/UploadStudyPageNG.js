import React from 'react';
import { useSelector } from 'react-redux';

import OHIF from '@ohif/core';

import Layout from '../../layouts/Layout/Layout';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';

import RecentUploadTable from './components/RecentUploadTable/RecentUploadTable';
import UploadFiles from './components/UploadFiles/UploadFiles';

const { redux } = OHIF;


export default function UploadStudyPageNG() {

  const serverCount = useSelector(redux.selectors.serverCount);
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);  
  
  // Permissions
  const canUpload = activeServer && activeServer?.perms?.upload;

  return (
    <>

      {(serverCount > 0) && canUpload && (
        <Layout>
          <UploadFiles />
          <RecentUploadTable />
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
