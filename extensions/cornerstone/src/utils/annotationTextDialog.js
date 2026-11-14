// The labelling dialog of an arrow annotation: the classic cornerstone-tools `ArrowAnnotate` and the
// Cornerstone3D `ArrowAnnotateTool` (the 3D Inspector and the MPR panes) take their label from the
// same dialog, centred over an overlay. Over the Inspector it is stacked above the modal.
//
// Both tools hand a new arrow's label to `getTextCallback` and delete the arrow when it is empty, so
// a cancelled dialog gives an empty label. An edit (`changeTextCallback`) that is cancelled, or
// submitted empty, keeps the label the arrow has.

import { InputDialog } from '@ohif/ui';

/** The label an arrow holds: the classic tool's `text`, the Cornerstone3D annotation's `data.label` */
const currentLabelOf = target => {
  const value = target && (target.data ? target.data.label : target.text);
  return typeof value === 'string' ? value : '';
};

function showAnnotationTextDialog(uiDialogService, { text = '', aboveModal = false, onSubmit, onCancel }) {
  if (!uiDialogService) {
    onCancel();
    return;
  }
  const dialogId = uiDialogService.create({
    centralize: true,
    isDraggable: false,
    useLastPosition: false,
    showOverlay: true,
    aboveModal,
    content: InputDialog,
    contentProps: {
      title: 'Enter your annotation',
      label: 'New label',
      defaultValue: text,
      onClose: () => {
        uiDialogService.dismiss({ id: dialogId });
        onCancel();
      },
      onSubmit: (value) => {
        uiDialogService.dismiss({ id: dialogId });
        onSubmit(typeof value === 'string' ? value : '');
      },
    },
  });
}

/**
 * The `getTextCallback` and `changeTextCallback` of an arrow tool, classic or Cornerstone3D.
 *
 * @param {object} uiDialogService - UIDialogService
 * @param {object} [options]
 * @param {boolean} [options.aboveModal] - the tool is in a modal (the 3D Inspector)
 */
function annotationTextCallbacks(uiDialogService, { aboveModal = false } = {}) {
  return {
    getTextCallback: (done) => showAnnotationTextDialog(uiDialogService, {
      aboveModal, onSubmit: done, onCancel: () => done(''),
    }),
    changeTextCallback: (target, eventDetail, done) => {
      const text = currentLabelOf(target);
      showAnnotationTextDialog(uiDialogService, {
        text, aboveModal, onSubmit: value => done(value || text), onCancel: () => done(text),
      });
    },
  };
}


export { annotationTextCallbacks, showAnnotationTextDialog };
