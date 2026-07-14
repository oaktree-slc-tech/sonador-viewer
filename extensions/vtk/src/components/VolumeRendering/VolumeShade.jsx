import React, { useCallback, useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Switch } from '@ohif/ui-next';
import { getCornerstone3dViewport } from '../../utils/cornerstone3d.js';
import Enums from '../../enums';

export function VolumeShade({ viewportId, onClickShade = () => {} }) {
  const { commandsManager } = useSystem();
  const [shade, setShade] = useState(true);
  const [key, setKey] = useState(0);

  const onShadeChange = useCallback(
    checked => {
      commandsManager.runCommand('setVolumeLighting', {
        viewportId,
        options: { shade: checked },
      }, Enums.VIEWPORT);
    },
    [commandsManager, viewportId]
  );

  useEffect(() => {
    const viewport = getCornerstone3dViewport(viewportId);
    if (!viewport) {
      return;
    }
    const actors = viewport.getActors();
    if (!actors?.length) {
      return;
    }
    const { actor } = actors[0];
    const currentShade = actor.getProperty().getShade();
    setShade(currentShade);
    onClickShade(currentShade);
    setKey(k => k + 1);
  }, [viewportId]);

  return (
    <>
      <span className="flex-grow">Shade</span>
      <Switch
        className="ml-2 flex-shrink-0"
        key={key}
        checked={shade}
        onCheckedChange={() => {
          const next = !shade;
          setShade(next);
          onClickShade(next);
          onShadeChange(next);
        }}
      />
    </>
  );
}
