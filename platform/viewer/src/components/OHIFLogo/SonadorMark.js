// Bundled square mark for the collapsed sidebar (ohif-viewers#128).
//
// The counterpart to OHIFLogo: where that renders the full wordmark for the 315px rail, this
// renders the 28px square mark the 40px rail has room for. It is the fallback whenever the server
// omits `branding.logo_narrow` — see WhiteLabelingContext's defaults and the
// createNarrowLogoComponentFn built in sonador.index.js — so it is the mark most deployments show,
// not a stub.
//
// The artwork is the Sonador project badge ("Sonador Tree"), supplied on ohif-viewers#128. Sonador
// keeps a byte-identical copy at sonador/static/images/sonador-mark.svg, which is what
// OhifConfigView falls back to when a site has no logo_narrow uploaded; this bundled copy covers
// the case where the server sends no `branding` block at all.
//
// DO NOT add width/height back to sonador-mark.svg. `babel-plugin-inline-react-svg` inlines it
// through SVGO with default settings, and SVGO's removeViewBox drops the viewBox whenever width and
// height are present and agree with it. Without a viewBox the mark cannot scale: the CSS below
// would crop it to the top-left 28 units of a 128-unit canvas instead of fitting it. viewBox alone
// survives, which is why the file carries no intrinsic size.
//
// The mark is a gradient fill, so it does not follow `currentColor` the way the navigation icons
// do -- deliberately, since it is branding rather than UI chrome.

import React from 'react';

import { ReactComponent as Mark } from '@ohif/ui/src/elements/Svg/svgs/sonador-mark.svg';

import './SonadorMark.css';

function SonadorMark() {
  return (
    <a target="_self" rel="noopener noreferrer" className="header-brand-narrow" href="/">
      <Mark />
    </a>
  );
}

export default SonadorMark;
