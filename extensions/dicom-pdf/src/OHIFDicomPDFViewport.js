import React, { Component } from 'react';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { str2ab } from '@ohif/core';

import DicomPDFViewport from './DicomPDFViewport';
import OHIFComponentPlugin from './OHIFComponentPlugin.js';

const { DicomLoaderService } = OHIF.utils;

class OHIFDicomPDFViewport extends Component {
  // OHIF viewport with support displaying PDF documents. (Based on PDF.js.)
  static propTypes = {
    studies: PropTypes.object,
    displaySet: PropTypes.object,
    viewportIndex: PropTypes.number,
    viewportData: PropTypes.object,
    activeViewportIndex: PropTypes.number,
    setViewportActive: PropTypes.func,
  };

  state = {
    byteArray: null,
    rawPdf: false,
    error: null,
  };

  static id = 'DicomPDFViewportPDF';

  componentDidMount() {
    // Retrieve PDF document and initialize viewport
    const { displaySet, studies } = this.props.viewportData;

    // File available from cache, retrieve and set inline byte array
    if (displaySet.metadata && displaySet.metadata.EncapsulatedDocument) {
      const { InlineBinary, BulkDataURI } = displaySet.metadata.EncapsulatedDocument;
      if (InlineBinary) {
        const inlineBinaryData = atob(InlineBinary);
        const byteArray = str2ab(inlineBinaryData);
        this.setState({ byteArray, rawPdf: true });
        return;
      }
    }

    // Retrieve from remote server
    DicomLoaderService.findDicomDataPromise(displaySet, studies).then(
      (data) => this.setState({ byteArray: new Uint8Array(data) }),
      (error) => {
        this.setState({ error });
        throw new Error(error);
      }
    );
  }

  render() {
    const { setViewportActive, viewportIndex, activeViewportIndex } = this.props;
    const { byteArray, error, rawPdf } = this.state;
    const { id, init, destroy } = OHIFDicomPDFViewport;
    const pluginProps = { id, init, destroy };

    return (
      <OHIFComponentPlugin {...pluginProps}>
        {byteArray && (
          <DicomPDFViewport
            byteArray={byteArray}
            rawPdf={rawPdf}
            setViewportActive={setViewportActive}
            viewportIndex={viewportIndex}
            activeViewportIndex={activeViewportIndex}
          />
        )}
        {error && <h2>{JSON.stringify(error)}</h2>}
      </OHIFComponentPlugin>
    );
  }
}

export default OHIFDicomPDFViewport;
