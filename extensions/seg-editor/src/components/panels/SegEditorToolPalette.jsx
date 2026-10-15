import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { Icon } from '@ohif/ui';
import { Icons, Tabs, TabsContent, TabsList, TabsTrigger } from '@ohif/ui-next';

import { SECTIONS, SEG_EDITOR_COMMAND_CONTEXT } from '../../toolbox/constants';

import SegEditorToolbox from './SegEditorToolbox';

import styles from './SegEditorToolPalette.module.scss';

const { DisplaySetApi } = OHIF.display;


export const PALETTES = {
  labelmap: 'labelmap',
  threeD: '3d',
};

// Palette tabs, marked as the 3D tools' action row marks its actions (Remove / Smooth / Repair):
// the active tab filled (the secondary button's surface) at full strength, the other ghosted and
// muted. Each tab names its palette beside its icon: the Labelmap palette uses v3's
// segmentation-panel icon; the 3D palette the cube the 2D MPR toolbar button uses (a viewer icon,
// so it is drawn with the viewer's Icon).
const PALETTE_TABS = [
  { value: PALETTES.labelmap, iconName: 'tab-segmentation', label: 'Labelmap Tools' },
  { value: PALETTES.threeD, legacyIconName: 'cube', label: '3D Tools' },
];

const TAB_CLASSES =
  'h-7 min-w-0 flex-1 gap-1.5 rounded px-2 text-xs font-normal shadow-none transition-colors ' +
  'text-muted-foreground hover:bg-primary/25 hover:text-primary ' +
  'data-[state=active]:bg-secondary/85 data-[state=active]:text-secondary-foreground ' +
  'data-[state=active]:shadow-none data-[state=active]:hover:bg-secondary';


function _initialPalette(displaySetInstanceUID, defaultPalette) {
  // Follow the editor's current mode, so a remounted panel matches what the 3D tab shows
  const displaySet = displaySetInstanceUID
    && DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  return displaySet?.segEditor3dEditingEnabled ? PALETTES.threeD : defaultPalette;
}


export default function SegEditorToolPalette({
    commandsManager, displaySetInstanceUID, defaultPalette = PALETTES.labelmap }) {
  // Segmentation Editor tool palettes (ohif-viewers#142), shown under the segment list: the
  // Labelmap (slice) tools, ported from the OHIF v3 segmentation toolbox, and the 3D tools, which
  // act on the 3D tab's editing canvas. Leaving a palette releases its tools: a labelmap tool
  // holding the primary mouse binding, or the active 3D tool.

  const { t } = useTranslation('SegmentationEditor');
  const [palette, setPalette] = useState(() => _initialPalette(displaySetInstanceUID, defaultPalette));

  const onPaletteChange = (value) => {
    if (value !== PALETTES.labelmap) {
      commandsManager.runCommand('deactivateLabelmapTools', {}, SEG_EDITOR_COMMAND_CONTEXT);
    }
    if (value !== PALETTES.threeD) {
      commandsManager.runCommand('deactivate3DTools', {}, SEG_EDITOR_COMMAND_CONTEXT);
    }

    // The 3D palette switches the 3D tab to the Three.js editing canvas
    commandsManager.runCommand('setSegEditor3DEditing', {
      enabled: value === PALETTES.threeD,
    }, SEG_EDITOR_COMMAND_CONTEXT);

    setPalette(value);
  };

  return (
    <div className={`seg-editor-palette ${styles.palette ?? ''}`}>
      <Tabs value={palette} onValueChange={onPaletteChange} className="w-full">
        <div className="bg-muted px-2 py-2">
          <TabsList
            className="flex h-auto w-full gap-1 rounded-none bg-transparent p-0 hover:bg-transparent"
            aria-label={t('Tool palette')}
          >
            {PALETTE_TABS.map(({ value, iconName, legacyIconName, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                data-cy={`seg-editor-palette-${value}`}
                className={TAB_CLASSES}
              >
                {legacyIconName ? (
                  <Icon name={legacyIconName} className="flex-none" style={{ width: '16px', height: '16px' }} />
                ) : (
                  <Icons.ByName name={iconName} className="flex-none" style={{ width: '18px', height: '18px' }} />
                )}
                <span className="truncate">{t(label)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value={PALETTES.labelmap} className="mt-0">
          <SegEditorToolbox buttonSectionId={SECTIONS.labelMapToolbox} title={t('Labelmap Tools')} />
        </TabsContent>

        <TabsContent value={PALETTES.threeD} className="mt-0">
          <SegEditorToolbox buttonSectionId={SECTIONS.threeDToolbox} title={t('3D Tools')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}


SegEditorToolPalette.propTypes = {
  commandsManager: PropTypes.object.isRequired,
  displaySetInstanceUID: PropTypes.string,
  defaultPalette: PropTypes.oneOf(Object.values(PALETTES)),
};
