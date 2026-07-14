import React, { useCallback, useState } from 'react';
import { useSystem } from '@ohif/core';
import { SimpleDialogShell } from '@ohif/ui';
import { PresetDialog, FooterAction, Icons } from '@ohif/ui-next';

import styles from './VolumeRenderingPresetsContent.css';
import Enums from '../../enums';

const formatLabel = (label, maxChars) =>
  label.length > maxChars ? `${label.slice(0, maxChars)}...` : label;


export function VolumeRenderingPresetsContent({
    presets, viewportId, hide, headerTitle='', rootClass = 'volumeRenderingPresetsDialog', componentStyle={},
  }) {
  // Dialog showing VTK volume rendering presets which can be used by Cornerstone3D.

  const { commandsManager } = useSystem();
  const [searchValue, setSearchValue] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(null);

  const handleSearchChange = useCallback(event => {
    setSearchValue(event.target.value);
  }, []);

  const handleApply = useCallback(
    props => {
      commandsManager.runCommand('setViewportPreset', props, Enums.VIEWPORT);
    },
    [commandsManager]
  );

  const filteredPresets = searchValue
    ? presets.filter(preset => preset.name.toLowerCase().includes(searchValue.toLowerCase()))
    : presets;

  return (<SimpleDialogShell headerTitle={headerTitle} onClose={hide} rootClass={rootClass} componentStyle={componentStyle}>
    <PresetDialog className="h-[500px]">
      <PresetDialog.PresetBody>
        <PresetDialog.PresetFilter className='pr-2 pl-2'>
          <PresetDialog.PresetSearch
            value={searchValue}
            onChange={handleSearchChange}
            placeholder="Search all"
          />
        </PresetDialog.PresetFilter>
        <PresetDialog.PresetGrid className='pr-3 pl-3'>
          {filteredPresets.map((preset, index) => (
            <div
              key={index}
              className="flex cursor-pointer flex-col items-start"
              onClick={() => {
                setSelectedPreset(preset);
                handleApply({ preset: preset.name, viewportId });
              }}
            >
              <Icons.ByName
                name={preset.name}
                className={
                  selectedPreset?.name === preset.name
                    ? 'border-highlight h-[75px] w-[95px] max-w-none rounded border-2'
                    : 'hover:border-highlight h-[75px] w-[95px] max-w-none rounded border-2 border-background'
                }
              />
              <label className="text-muted-foreground mt-1 text-left text-xs">
                {formatLabel(preset.name, 11)}
              </label>
            </div>
          ))}
        </PresetDialog.PresetGrid>
      </PresetDialog.PresetBody>

      <div className='footer p-2'>
      <FooterAction className="flex-shrink-0">
        <FooterAction.Right>
          <FooterAction.Secondary onClick={hide} className={'btn btn-primary'}>Close</FooterAction.Secondary>
        </FooterAction.Right>
      </FooterAction>
      </div>

    </PresetDialog>
  </SimpleDialogShell>);
}
