import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Numeric } from '@ohif/ui-next';
import { getCornerstone3dViewport } from '../../utils/cornerstone3d.js';
import Enums from '../../enums';

export function VolumeShift({ viewportId }) {
  const { commandsManager } = useSystem();
  const [minShift, setMinShift] = useState(null);
  const [maxShift, setMaxShift] = useState(null);
  const [shift, setShift] = useState(null);
  const [step, setStep] = useState(null);
  const [isBlocking, setIsBlocking] = useState(false);

  const prevShiftRef = useRef(0);

  useEffect(() => {
    const viewport = getCornerstone3dViewport(viewportId);
    if (!viewport) {
      return;
    }
    const currentShift = viewport.shiftedBy || 0;
    setShift(currentShift);
    prevShiftRef.current = currentShift;
  }, [viewportId]);

  useEffect(() => {
    if (isBlocking) {
      return;
    }
    const viewport = getCornerstone3dViewport(viewportId);
    if (!viewport) {
      return;
    }
    const actors = viewport.getActors();
    if (!actors?.length) {
      return;
    }
    const { actor } = actors[0];
    const ofun = actor.getProperty().getScalarOpacity(0);
    const range = ofun.getRange();
    const transferFunctionWidth = range[1] - range[0];

    setMinShift(-transferFunctionWidth);
    setMaxShift(transferFunctionWidth);
    setStep(Math.pow(10, Math.floor(Math.log10(transferFunctionWidth / 500))));
  }, [viewportId, isBlocking]);

  const onChangeRange = useCallback(
    newShift => {
      const viewport = getCornerstone3dViewport(viewportId);
      if (!viewport) {
        return;
      }
      const shiftDifference = newShift - prevShiftRef.current;
      prevShiftRef.current = newShift;
      viewport.shiftedBy = newShift;
      commandsManager.runCommand('shiftVolumeOpacityPoints', {
        viewportId,
        shift: shiftDifference,
      }, Enums.VIEWPORT);
      setShift(newShift);
    },
    [commandsManager, viewportId]
  );

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      {step !== null && minShift !== null && maxShift !== null && shift !== null && (
        <div className="w-full pl-2 pr-1">
          <Numeric.Container
            mode="singleRange"
            min={minShift}
            max={maxShift}
            step={step}
            value={shift}
            onChange={onChangeRange}
            onMouseDown={() => setIsBlocking(true)}
            onMouseUp={() => setIsBlocking(false)}
          >
            <div className="flex flex-row items-center">
              <Numeric.Label className="w-16">Shift</Numeric.Label>
              <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
            </div>
          </Numeric.Container>
        </div>
      )}
    </div>
  );
}
