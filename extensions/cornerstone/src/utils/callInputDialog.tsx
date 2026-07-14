import _ from 'lodash';

import React from 'react';
import { setAnnotationLabel } from '@cornerstonejs/tools/utilities';
import { annotation } from '@cornerstonejs/tools';

import { SimpleDialogShell } from '@ohif/ui';
import { LabellingFlow } from '@ohif/ui-next';
import { InputDialog } from '@ohif/ui-next';

import '../components/SonadorCornerstoneCoreStyles.css';


interface InputDialogDefaultProps {
  hide: () => void;
  onSave: (value: string) => void;
  placeholder: string;
  defaultValue: string;
  submitOnEnter: boolean;
}


function InputDialogDefault({
  hide,
  onSave,
  headerTitle,
  placeholder = 'Enter value',
  defaultValue = '',
  rootClass = '',
  componentStyle = {},
  submitOnEnter,
  btnCancelText = 'Cancel',
  btnConfirmText = 'Save',
}: InputDialogDefaultProps) {
  return (<SimpleDialogShell headerTitle={headerTitle} onClose={hide} rootClass={rootClass}
      componentStyle={componentStyle}>
    <InputDialog
      submitOnEnter={submitOnEnter}
      defaultValue={defaultValue}
    >

      <div className="content">
      <InputDialog.Field>
        <InputDialog.Input placeholder={placeholder} />
      </InputDialog.Field>
      </div>

      <div className="footer">
      <InputDialog.Actions>
        <InputDialog.ActionsSecondary onClick={hide} className={'btn btn-default'} >
          {btnCancelText}
        </InputDialog.ActionsSecondary>
        <InputDialog.ActionsPrimary
          onClick={value => {
            onSave(value);
            hide();
          }}
          className={'btn btn-primary'} >
          {btnConfirmText}
        </InputDialog.ActionsPrimary>
      </InputDialog.Actions>
      </div>

    </InputDialog>
  </SimpleDialogShell>);
}


/**
 * Shows an input dialog for entering text with customizable options
 * @param uiDialogService - Service for showing UI dialogs
 * @param onSave - Callback function called when save button is clicked with entered value
 * @param defaultValue - Initial value to show in input field
 * @param title - Title text to show in dialog header
 * @param placeholder - Placeholder text for input field
 * @param submitOnEnter - Whether to submit dialog when Enter key is pressed
 */
export async function callInputDialog({
  uiDialogService,
  defaultValue = '',
  title = 'Annotation',
  placeholder = '',
  submitOnEnter = true,
  rootClass = 'sonadorSimpleInputDialog',
  extraContentProps = {},
  ...dialogProps
}: {
  uiDialogService: AppTypes.UIDialogService;
  defaultValue?: string;
  title?: string;
  placeholder?: string;
  submitOnEnter?: boolean;
}) {
  const dialogId = 'dialog-enter-annotation';
  _.defaults(extraContentProps, {
    headerTitle: title,
    hide: () => uiDialogService.dismiss({ id: dialogId }),
    rootClass,
  });

  const value = await new Promise<string>(resolve => {
    uiDialogService.show({
      id: dialogId,
      content: InputDialogDefault,
      title: title,
      shouldCloseOnEsc: true,
      contentProps: {
        ...extraContentProps,
        onSave: value => {
          resolve(value);
        },
        placeholder,
        defaultValue,
        submitOnEnter,
      },
      ...dialogProps,
    });
  });

  return value;
}


export async function callInputDialogAutoComplete({
  measurement,
  uiDialogService,
  labelConfig,
  renderContent = LabellingFlow,
  element,
}) {
  const exclusive = labelConfig ? labelConfig.exclusive : false;
  const dropDownItems = labelConfig ? labelConfig.items : [];

  const value = await new Promise<Map<string, string>>((resolve, reject) => {
    const labellingDoneCallback = newValue => {
      uiDialogService.hide('select-annotation');
      if (measurement && typeof newValue === 'string') {
        const sourceAnnotation = annotation.state.getAnnotation(measurement.uid);
        setAnnotationLabel(sourceAnnotation, element, newValue);
      }
      resolve(newValue);
    };

    uiDialogService.show({
      id: 'select-annotation',
      title: 'Annotation',
      content: renderContent,
      contentProps: {
        labellingDoneCallback: labellingDoneCallback,
        measurementData: measurement,
        componentClassName: {},
        labelData: dropDownItems,
        exclusive: exclusive,
      },
    });
  });

  return value;
}


export default callInputDialog;