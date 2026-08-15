import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Navigate,useNavigate } from 'react-router-dom';

// The primary toolbar's own close glyph: full-bleed square viewBox, currentColor stroke
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';
import { ReactComponent as LeftArrowIcon } from '@ohif/ui/src/elements/Svg/svgs/leftArrow.svg';
import { ReactComponent as RightArrowIcon } from '@ohif/ui/src/elements/Svg/svgs/rightArrow.svg';

import TruncatedText from '../../components/TruncatedText/TruncatedText';
import { WORK_LIST_VIEWER_PARAM } from '../../constants/worklist';
import { useWorkListStore } from '../../store/useWorkListStore';

import WorkListStatusDropdown from './components/WorkListStatusDropdown/WorkListStatusDropdown';
import WorkListStudyDropdown from './components/WorkListStudyDropdown/WorkListStudyDropdown';

import styles from './WorkListViewerPageNG.module.scss';

export default function WorkListViewerPageNG() {
  const { workListSelectedStudies, setWorkListSelectedStudies } = useWorkListStore();
  const navigate = useNavigate();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [selectedStudy, setSelectedStudy] = useState(workListSelectedStudies[0]);
  const [selectedStudyIndex, setSelectedStudyIndex] = useState(0);

  if(!selectedStudy){
    return  <Navigate to='/worklist'/>
  }

  const handleSelectPrev = () => {
    if (selectedStudyIndex > 0) {
      setSelectedStudy(workListSelectedStudies[selectedStudyIndex - 1]);
      setSelectedStudyIndex((prevState) => prevState - 1);
    }
  };

  const handleSelectNext = () => {
    if (selectedStudyIndex < workListSelectedStudies.length - 1) {
      setSelectedStudy(workListSelectedStudies[selectedStudyIndex + 1]);
      setSelectedStudyIndex((prevState) => prevState + 1);
    }
  };

  const src = `${window.location.origin}/server/${activeServer?.token}/viewer/study/${selectedStudy.original.StudyInstanceUID.value}?${WORK_LIST_VIEWER_PARAM}=true`;

  return (
    <div className={styles.workListViewer}>
      <div className={styles.header}>
        <div className={styles.leftHeader}>
          <button
            onClick={() => {
              setWorkListSelectedStudies([]);
              navigate('/worklist');
            }}
            className={styles.exit}
          >
            <CloseIcon />
            <span>Exit</span>
          </button>
          <div className={styles.studyItemData}>
            <div className={styles.studyDataItem}>
              <span>Patient Name</span>
              <span>{selectedStudy.original?.PatientName?.value ?? "N/A"}</span>
            </div>
            <div className={styles.studyDataItem}>
              <span>MRN</span>
              <span>{selectedStudy.original?.mrn?.value ?? "N/A"}</span>
            </div>
            {/* Both of these are free text and routinely outrun the 220px the header gives them.
                They keep the same clipping (`.longValue`) and trade the browser's `title` tooltip
                for the viewer's own hover card, which only appears when there is genuinely
                something clipped to reveal. */}
            {selectedStudy.original?.ReasonForReview?.value && (
              <div className={styles.studyDataItem}>
                <span>Reason for Review</span>
                <TruncatedText
                  value={selectedStudy.original.ReasonForReview.value}
                  className={styles.longValue}
                />
              </div>
            )}
            {selectedStudy.original?.RequestedProcedure?.value && (
              <div className={styles.studyDataItem}>
                <span>Requested Procedure</span>
                <TruncatedText
                  value={selectedStudy.original.RequestedProcedure.value}
                  className={styles.longValue}
                />
              </div>
            )}
          </div>
        </div>
        <div className={styles.rightHeader}>
          <div className={styles.count}>
            <p className={styles.items}>
              {selectedStudyIndex + 1}/{workListSelectedStudies.length}
            </p>
            <p className={styles.completed}>Completed</p>
          </div>
          <button className={styles.leftArrow} onClick={handleSelectPrev} disabled={selectedStudyIndex === 0}>
            <LeftArrowIcon />
          </button>
          <WorkListStudyDropdown
            selectedStudy={selectedStudy}
            setSelectedStudy={setSelectedStudy}
            setSelectedStudyIndex={setSelectedStudyIndex}
            selectedStudyIndex={selectedStudyIndex}
          />
          <button
            className={styles.rightArrow}
            onClick={handleSelectNext}
            disabled={selectedStudyIndex === workListSelectedStudies.length - 1}
          >
            <RightArrowIcon />
          </button>
          <WorkListStatusDropdown
            key={selectedStudy.original.worklistId}
            currentStatus={selectedStudy.original.Status.value}
            StudyInstanceUID={selectedStudy.original.StudyInstanceUID.value}
            selectedStudy={selectedStudy}
            worklistId={selectedStudy.id} />
        </div>
      </div>
      <iframe src={src} frameBorder="0" width="100%" title="worklist-viewer" className={styles.iframe} />
    </div>
  );
}
