import React, { Component, createRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import dicomParser from 'dicom-parser';
import PropTypes from 'prop-types';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

import OHIF from '@ohif/core';
const { TypedArrayProp } = OHIF.classes;

import { PDF_DOCUMENT_MIMETYPE, SOP_CLASS_UIDS } from './OHIFDicomPDFSopClassHandler.js';

import './DicomPDFViewport.css';

const { createEncapsulatedDocumentFileUrl } = OHIF.utils;

class DicomPDFViewport extends Component {
  // Viewport instance able to display DICOM encapsulated PDF documents

  constructor(props) {
    super(props);

    this.state = {
      fileURL: null,
      error: null,
      currentPageIndex: 1,
      pdf: null,
      scale: 1,
      width: 500,
      height: 700,
    };

    this.canvas = createRef();
  }

  static propTypes = {
    byteArray: TypedArrayProp.uint8,
    rawPdf: PropTypes.bool,
    useNative: PropTypes.bool,
    viewportData: PropTypes.object,
    activeViewportIndex: PropTypes.number,
    setViewportActive: PropTypes.func,
    viewportIndex: PropTypes.number,
  };

  static defaultProps = {
    useNative: false,
  };

  async componentDidMount() {
    const { rawPdf } = this.props;
    const dataSet = !rawPdf && this.parseByteArray(this.props.byteArray);
    const fileURL = this.getPDFFileUrl(dataSet, this.props.byteArray);

    this.setState({ fileURL });
  }

  updatePDFCanvas = async () => {
    const { pdf, scale, currentPageIndex } = this.state;

    const page = await pdf.getPage(currentPageIndex);
    let viewport = page.getViewport({ scale });
    const width = viewport.viewBox.length === 4 ? viewport.viewBox[2] : 500;
    const height = viewport.viewBox.length === 4 ? viewport.viewBox[3] : 300;

    this.setState({ width: viewport.width || width, height: viewport.height || height });
  };

  componentDidUpdate(prevProps, prevState) {
    const { currentPageIndex, scale } = this.state;
    const newValidScale = prevState.scale !== scale && scale > 0;
    const newValidPageNumber = prevState.currentPageIndex !== currentPageIndex && currentPageIndex > 0;

    if (newValidScale || newValidPageNumber) {
      this.updatePDFCanvas();
    }
  }

  getPDFFileUrl = (dataSet, byteArray) => {
    if (dataSet) {
      const SOPClassUID = dataSet.string('x00080016');

      if (SOPClassUID !== SOP_CLASS_UIDS.ENCAPSULATED_PDF) {
        throw new Error('This is not a DICOM-encapsulated PDF');
      }
    }

    return createEncapsulatedDocumentFileUrl(dataSet, byteArray, {
      mimetype: PDF_DOCUMENT_MIMETYPE,
    });
  };

  onPageChange = async (event) => {
    const { currentPageIndex, pdf } = this.state;
    let newPageIndex = currentPageIndex;

    const action = event.target.getAttribute('data-pager');
    if (action === 'prev') {
      if (currentPageIndex === 1) {
        return;
      }
      newPageIndex -= 1;
      if (currentPageIndex < 0) {
        newPageIndex = 0;
      }
    }

    if (action === 'next') {
      if (currentPageIndex === pdf.numPages - 1) {
        return;
      }
      newPageIndex += 1;
      if (currentPageIndex > pdf.numPages - 1) {
        newPageIndex = pdf.numPages - 1;
      }
    }

    this.setState({ currentPageIndex: newPageIndex });
  };

  onZoomChange = (event) => {
    let newZoomValue = this.state.scale;

    const action = event.target.getAttribute('data-pager');

    if (action === '+') {
      newZoomValue += 0.25;
    }

    if (action === '-') {
      newZoomValue -= 0.25;
    }

    this.setState((state) => ({ ...state, scale: newZoomValue }));
  };

  parseByteArray = (byteArray) => {
    const options = { untilTag: '' };

    let dataSet;
    try {
      dataSet = dicomParser.parseDicom(byteArray, options);
    } catch (error) {
      this.setState((state) => ({ ...state, error }));
    }

    return dataSet;
  };

  setViewportActiveHandler = () => {
    const { setViewportActive, viewportIndex, activeViewportIndex } = this.props;

    if (viewportIndex !== activeViewportIndex) {
      setViewportActive(viewportIndex);
    }
  };

  downloadPDFCanvas = () => {
    const { fileURL } = this.state;
    const a = document.createElement('a');
    a.href = fileURL;
    a.download = fileURL.substr(fileURL.lastIndexOf('/') + 1);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  render() {
    const { fileURL, pdf, error, width, height, scale, currentPageIndex } = this.state;

    return (
      <div
        className={'DicomPDFViewport'}
        onClick={this.setViewportActiveHandler}
        onScroll={this.setViewportActiveHandler}
        style={{ width: '100%', height: '100%' }}
      >
        {!this.props.useNative ? (
          <>
            <div id="toolbar">
              <div id="pager">
                {pdf && pdf.numPages > 1 && (
                  <>
                    <button data-pager="prev" onClick={this.onPageChange}>
                      {`<`}
                    </button>
                    <button data-pager="next" onClick={this.onPageChange}>
                      {`>`}
                    </button>
                  </>
                )}
                <button data-pager="-" onClick={this.onZoomChange}>
                  {`-`}
                </button>
                <button data-pager="+" onClick={this.onZoomChange}>
                  {`+`}
                </button>
                <button onClick={this.downloadPDFCanvas}>Download</button>
              </div>
            </div>
            <div id="canvas">
              <div id="pdf-canvas-container" style={{ width, height }}>
                <Document
                  file={fileURL}
                  onLoadSuccess={async (pdf) => {
                    this.setState({ pdf }, () => this.updatePDFCanvas());
                  }}
                >
                  <Page pageNumber={currentPageIndex} scale={scale} />
                </Document>
              </div>
            </div>
          </>
        ) : (
          <object aria-label="PDF Viewer" data={fileURL} type="application/pdf" width="100%" height="100%" />
        )}
        {error && <h2>{JSON.stringify(error)}</h2>}
      </div>
    );
  }
}

export default DicomPDFViewport;
