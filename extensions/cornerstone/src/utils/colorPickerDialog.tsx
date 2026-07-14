import _ from 'lodash';

import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import { SimpleDialogShell } from '@ohif/ui';
import { FooterAction } from '@ohif/ui-next';

import './colorPickerDialog.css';


function ColorPickerComponent({ value, hide, onSave, btnCancelText = 'Cancel', btnConfirmText = 'Save' }) {
  const [color, setColor] = useState(value);

  const handleChange = color => {
    setColor(color.rgb);
  };

  return (
    <div>
      
      <div className={'content'}>
      <ChromePicker
        color={color}
        onChange={handleChange}
        presetColors={[]}
        width={300}
      />
      </div>

      <div className='footer'>
      <FooterAction>
        <FooterAction>
          <FooterAction.Secondary className={'btn btn-default'} onClick={hide}>{btnCancelText}</FooterAction.Secondary>
          <FooterAction.Primary className={'btn btn-primary'}
            onClick={() => {
              hide();
              onSave(color);
            }}
          >
          {btnConfirmText}
          </FooterAction.Primary>
        </FooterAction>
      </FooterAction>
      </div>

    </div>
  );
}


interface ColorPickerDefaultProps {
  hide: () => void,
  onSave: (value: string) => void,
  value: string,
}


function ColorPickerDialog({
  hide,
  onSave,
  headerTitle,
  value,
  rootClass = '',
  componentStyle = {},
  btnCancelText = 'Cancel',
  btnConfirmText = 'Save',
}: ColorPickerDefaultProps) {
  // Simple dialog based color picker
  return (<SimpleDialogShell headerTitle={headerTitle} onClose={hide} rootClass={rootClass}
      componentStyle={componentStyle}>
    <ColorPickerComponent value={value} onSave={onSave} hide={hide}
      btnCancelText={btnCancelText} btnConfirmText={btnConfirmText} />
  </SimpleDialogShell>);
}


async function callColorPickerDialog({
  uiDialogService,
  value,
  title = 'Select Color',
  rootClass = 'sonadorSimpleInputDialog',
  extraContentProps = {},
  ...dialogProps
}: {
  uiDialogService: AppTypes.UIDialogService;
  value?: string;
  title?: string,
  rootClass?: string,
}) {
  // Show an input dialog for selecting a color string
  const dialogId = 'dialog-select-color';
  _.defaults(extraContentProps, {
    headerTitle: title,
    hide: () => uiDialogService.dismiss({ id: dialogId }),
    rootClass,
  });

  const dialog = await new Promise<string>(resolve => {
    uiDialogService.show({
      id: dialogId,
      content: ColorPickerDialog,
      title: title,
      shouldCloseOnEsc: true,
      contentProps: {
        ...extraContentProps,
        onSave: value => { resolve(value); },
        value,
      },
      ...dialogProps
    });
  });

  return dialog;
}


export default ColorPickerDialog;
export { ColorPickerComponent, ColorPickerDialog, callColorPickerDialog }