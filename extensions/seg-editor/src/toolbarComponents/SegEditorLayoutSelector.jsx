import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';
import { viewerbaseGetDisplaySet } from '@ohif/ui';
import { Icons, LayoutSelector } from '@ohif/ui-next';

import { SEG_EDITOR_LAYOUTS } from '../layouts/segEditorLayouts';

const { DisplaySetApi } = OHIF.display;

// displaySet attribute holding the editor's current layout preset id
const LAYOUT_ATTR = 'segEditorLayout';


function SegEditorLayoutSelector({ button, toolbarClickCallback }) {
  // The editor's "Layout" toolbar widget: OHIF v3's LayoutSelector offering the editor's layout
  // presets. The trigger is styled as a viewer toolbar button; choosing a preset runs the
  // setSegEditorLayout command through the toolbar, like any other button.

  const { t } = useTranslation('SegmentationEditor');
  const [open, setOpen] = useState(false);

  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { displaySet } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);
  const displaySetInstanceUIDRef = useRef(displaySet?.displaySetInstanceUID);

  const _current = () => DisplaySetApi.Instance.displaySetService
    .getDisplaySetByUID(displaySetInstanceUIDRef.current)?.[LAYOUT_ATTR];
  const [current, setCurrent] = useState(_current);

  useEffect(() => {
    const subscription = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED,
      ({ displaySetInstanceUID, displaySet: changed }) => {
        if (displaySetInstanceUID == displaySetInstanceUIDRef.current) {
          setCurrent(changed?.[LAYOUT_ATTR]);
        }
      });

    return () => subscription?.unsubscribe();
  }, []);

  const onSelectionChange = (commandOptions) => {
    toolbarClickCallback({ ...button, commandName: 'setSegEditorLayout', commandOptions });
  };

  return (
    <LayoutSelector open={open} onOpenChange={setOpen} onSelectionChange={onSelectionChange}>
      <LayoutSelector.Trigger>
        {/* A button, so the widget is a tab stop and Enter / Space open it; the utilities undo
            the browser's button chrome (no Tailwind preflight in the viewer) */}
        <button
          type="button"
          className={'toolbar-button appearance-none border-0 bg-transparent' + (open ? ' active' : '')}
          title={t('Change layout')}
          aria-label={t('Change layout')}
        >
          <Icons.ByName name="tool-layout" />
          <span className="toolbar-button-label block">{t('Layout', { ns: 'Buttons' })}</span>
        </button>
      </LayoutSelector.Trigger>
      <LayoutSelector.Content align="start">
        <div className="bg-popover flex flex-col gap-2.5 rounded-lg p-2">
          <LayoutSelector.PresetSection title={t('Layouts')}>
            {SEG_EDITOR_LAYOUTS.map(preset => (
              <LayoutSelector.Preset
                key={preset.id}
                title={t(preset.title)}
                icon={preset.icon}
                commandOptions={{ layoutId: preset.id }}
                isPreset
                className={preset.id === current ? 'bg-muted' : undefined}
              />
            ))}
          </LayoutSelector.PresetSection>
        </div>
      </LayoutSelector.Content>
    </LayoutSelector>
  );
}


SegEditorLayoutSelector.propTypes = {
  button: PropTypes.object.isRequired,
  toolbarClickCallback: PropTypes.func.isRequired,
};

export default SegEditorLayoutSelector;
