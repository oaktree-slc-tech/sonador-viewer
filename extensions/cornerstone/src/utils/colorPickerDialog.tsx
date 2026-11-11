import _ from 'lodash';

import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import OHIF from '@ohif/core';
import { SimpleDialogShell } from '@ohif/ui';
import { Button, FooterAction, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import './colorPickerDialog.css';


interface PaletteSwatch {
  name: string,
  hex: string,
}

type RgbaColor = { r: number, g: number, b: number, a: number };


function toRgba(value): RgbaColor | null {
  // The `{ r, g, b, a }` form of a color: an RGB(A) object, `#RRGGBB` or `rgb(a)(…)`
  if (value && typeof value === 'object' && [value.r, value.g, value.b].every(Number.isFinite)) {
    return { r: value.r, g: value.g, b: value.b, a: Number.isFinite(value.a) ? value.a : 1 };
  }
  if (typeof value !== 'string') {
    return null;
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  const hex = OHIF.displayAttributes.normalizeHexColor(value);
  if (!hex) {
    return null;
  }
  const [r, g, b] = OHIF.utils.color.hex2rgb(hex);
  return { r, g, b, a: 1 };
}

const sameColor = (a: RgbaColor | null, b: RgbaColor | null) => Boolean(a && b) && a.r === b.r && a.g === b.g && a.b === b.b;


function ColorPickerComponent({
  value, hide, onSave, onReset, palette, btnCancelText = 'Cancel', btnConfirmText = 'Save',
  btnResetText = 'Reset', btnResetTooltip = 'Reset to Default',
}) {
  // The picker, with a palette above it when one is given: a swatch sets the picker's color, which
  // can then be adjusted before it is saved. With `onReset`, a reset button clears the color. The
  // footer has Cancel on the left and the reset button beside Save on the right.
  const [color, setColor] = useState(value);
  // Tooltips are portalled into the dialog so they stack above it
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  const handleChange = color => {
    setColor(color.rgb);
  };

  const current = toRgba(color);

  return (
    <div ref={setPortal}>

      <div className="content">
        {palette && palette.length > 0 && (
          <div className="colorPickerPalette" role="group" aria-label="Palette">
            {palette.map(({ name, hex }) => {
              const swatch = toRgba(hex);
              const selected = sameColor(current, swatch);
              return (
                <button key={hex} type="button" title={`${name} ${hex}`} aria-label={name} aria-pressed={selected}
                  className={`colorPickerSwatch ${selected ? 'isSelected' : ''}`}
                  style={{ backgroundColor: hex }} onClick={() => setColor(swatch)} />
              );
            })}
          </div>
        )}
        <ChromePicker
          color={color}
          onChange={handleChange}
          presetColors={[]}
          width={300}
        />
      </div>

      <div className="footer">
        <FooterAction>
          <FooterAction.Left>
            <FooterAction.Secondary className="btn btn-default" onClick={hide}>{btnCancelText}</FooterAction.Secondary>
          </FooterAction.Left>
          <FooterAction.Right>
            {typeof onReset === 'function' && (
              <TooltipProvider>
                <Tooltip delayDuration={500}>
                  <TooltipTrigger asChild>
                    <Button variant="secondary" className="btn btn-default" aria-label={btnResetTooltip || btnResetText}
                      data-cy="color-picker-reset"
                      onClick={() => {
                        hide();
                        onReset();
                      }}
                    >
                      {btnResetText}
                    </Button>
                  </TooltipTrigger>
                  {btnResetTooltip && (
                    <TooltipContent container={portal} side="top">{btnResetTooltip}</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
            <FooterAction.Primary className="btn btn-primary"
              onClick={() => {
                hide();
                onSave(toRgba(color));
              }}
            >
              {btnConfirmText}
            </FooterAction.Primary>
          </FooterAction.Right>
        </FooterAction>
      </div>

    </div>
  );
}


interface ColorPickerDefaultProps {
  hide: () => void,
  onSave: (value: RgbaColor) => void,
  onReset?: () => void,
  value: string | RgbaColor,
  palette?: PaletteSwatch[],
  btnResetText?: string,
  btnResetTooltip?: string,
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
  onReset,
  palette,
  btnResetText,
  btnResetTooltip,
}: ColorPickerDefaultProps) {
  // Simple dialog based color picker
  return (<SimpleDialogShell headerTitle={headerTitle} onClose={hide} rootClass={rootClass}
      componentStyle={componentStyle}>
    <ColorPickerComponent value={value} onSave={onSave} onReset={onReset} palette={palette} hide={hide}
      btnCancelText={btnCancelText} btnConfirmText={btnConfirmText}
      {...(btnResetText ? { btnResetText } : {})} {...(btnResetTooltip ? { btnResetTooltip } : {})} />
  </SimpleDialogShell>);
}


async function callColorPickerDialog({
  uiDialogService,
  value,
  title = 'Select Color',
  rootClass = 'sonadorSimpleInputDialog',
  palette,
  allowReset = false,
  extraContentProps = {},
  ...dialogProps
}: {
  uiDialogService: AppTypes.UIDialogService;
  value?: string | { r: number, g: number, b: number, a?: number };
  title?: string,
  rootClass?: string,
  palette?: PaletteSwatch[],
  allowReset?: boolean,
}) {
  // Show the color picker dialog; resolves the chosen color (`{ r, g, b, a }`, 0-255 and 0-1), or
  // null when the reset button is chosen. The dialog opens centred over an overlay and cannot be
  // dragged (a dragged dialog re-renders on every move); a caller may override these through
  // `dialogProps`.
  // @input palette ({ name, hex }[], default none): swatches shown above the picker (annotations
  //   pass the annotation palette, displayAttributes.ANNOTATION_PALETTE)
  // @input allowReset (bool, default false): offer a reset button ("Reset", hover text "Reset to
  //   Default"; `btnResetText` / `btnResetTooltip` in `extraContentProps`), which clears the color
  const dialogId = 'dialog-select-color';
  _.defaults(extraContentProps, {
    headerTitle: title,
    hide: () => uiDialogService.dismiss({ id: dialogId }),
    rootClass,
  });

  const dialog = await new Promise<RgbaColor | null>(resolve => {
    uiDialogService.show({
      id: dialogId,
      content: ColorPickerDialog,
      title: title,
      shouldCloseOnEsc: true,
      contentProps: {
        ...extraContentProps,
        onSave: value => { resolve(value); },
        ...(allowReset ? { onReset: () => resolve(null) } : {}),
        palette,
        value,
      },
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      ...dialogProps
    });
  });

  return dialog;
}


export default ColorPickerDialog;
export { ColorPickerComponent, ColorPickerDialog, callColorPickerDialog }