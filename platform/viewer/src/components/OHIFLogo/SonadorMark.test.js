// The narrow-sidebar mark has to survive the build pipeline, not just exist on disk
// (ohif-viewers#128).
//
// It is delivered by babel-plugin-inline-react-svg, which runs SVGO with default settings on the
// way in. Two of those defaults are hostile to this particular asset:
//
//   * removeViewBox strips the viewBox whenever width and height are present and agree with it.
//     The mark is drawn on a 128-unit canvas and rendered at 28px, so losing the viewBox does not
//     fail loudly -- it silently crops to the top-left corner, which reads as "the icon is
//     missing".
//   * the artwork is a gradient fill, so the path's fill="url(#id)" has to keep pointing at a
//     gradient that is still in the output after cleanupIds has renamed it.
//
// Rendering to static markup is the cheapest way to assert both against what actually ships.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SonadorMark from './SonadorMark';

describe('SonadorMark', () => {
  const html = renderToStaticMarkup(SonadorMark());

  it('renders a link to the site root', () => {
    expect(html).toContain('href="/"');
    expect(html).toContain('header-brand-narrow');
  });

  it('keeps the viewBox, so the 128-unit artwork can scale to the 28px rail', () => {
    expect(html).toContain('viewBox="0 0 128 128"');
  });

  it('carries no intrinsic width/height on the svg, which is what preserves the viewBox', () => {
    const svgTag = html.match(/<svg[^>]*>/)[0];

    expect(svgTag).not.toMatch(/\bwidth=/);
    expect(svgTag).not.toMatch(/\bheight=/);
  });

  it('resolves its gradient fill to a gradient that is present in the output', () => {
    const referenced = html.match(/fill="url\(#([^)]+)\)"/);

    expect(referenced).not.toBeNull();
    expect(html).toContain(`id="${referenced[1]}"`);
    expect(html).toContain('stop-color="#f4cd57"');
    expect(html).toContain('stop-color="#eb8878"');
  });

  it('inlines no <style> block, which would leak its class names into the app', () => {
    expect(html).not.toContain('<style');
  });
});
