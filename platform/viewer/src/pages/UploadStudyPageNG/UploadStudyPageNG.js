import React from 'react';

import Layout from '../../layouts/Layout/Layout';

import RecentUploadTable from './components/RecentUploadTable/RecentUploadTable';
import UploadFiles from './components/UploadFiles/UploadFiles';

export default function UploadStudyPageNG() {
  return (
    <Layout>
      <UploadFiles />
      <RecentUploadTable />
    </Layout>
  );
}
