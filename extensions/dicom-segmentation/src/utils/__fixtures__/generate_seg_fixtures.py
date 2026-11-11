"""Generate the synthetic DICOM SEG fixtures used by parseSegWithAdapter.test.js.

Everything here is synthetic: a 4-slice 8x8 CT phantom, UIDs derived deterministically from fixed
strings, and no patient or study identifiers beyond placeholders.

Run with Python 3, pydicom 3 and highdicom 0.28 or later:

    python generate_seg_fixtures.py <output-directory>

Outputs:
    ct_<n>.dcm                 the single-frame reference series (n = 0..3)
    seg_nonoverlap.dcm         BINARY, two segments that never share a voxel
    seg_overlap.dcm            BINARY, two segments that share voxels on slices 0-2
    seg_overlap_interleaved.dcm  seg_overlap with its frames in slice-major order, segment 2 first
    seg_labelmap.dcm           LABELMAP, the non-overlapping segments
    seg_labelmap_rle.dcm       seg_labelmap, RLE Lossless (BINARY cannot be RLE: it is bit-packed)
    enhanced_ct.dcm            the reference series as one legacy-converted enhanced CT
    seg_multiframe_ref.dcm     BINARY, the non-overlapping segments, referencing enhanced_ct frames
"""

import os
import sys

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.pixels import pack_bits
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, RLELossless, generate_uid

ROWS = 8
COLUMNS = 8
SLICES = 4


def uid(*parts):
    return generate_uid(prefix=None, entropy_srcs=['sonador-seg-fixture', *parts])


STUDY_UID = uid('study')
CT_SERIES_UID = uid('ct-series')
FRAME_OF_REFERENCE_UID = uid('frame-of-reference')


def make_ct_slice(index):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = CTImageStorage
    meta.MediaStorageSOPInstanceUID = uid('ct', str(index))
    meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = STUDY_UID
    ds.SeriesInstanceUID = CT_SERIES_UID
    ds.FrameOfReferenceUID = FRAME_OF_REFERENCE_UID
    ds.Modality = 'CT'
    ds.PatientName = 'Phantom^Synthetic'
    ds.PatientID = 'PHANTOM'
    ds.PatientBirthDate = ''
    ds.PatientSex = 'O'
    ds.StudyDate = '20000101'
    ds.StudyTime = '000000'
    ds.ContentDate = '20000101'
    ds.ContentTime = '000000'
    ds.AccessionNumber = ''
    ds.ReferringPhysicianName = ''
    ds.StudyID = '1'
    ds.SeriesNumber = 1
    ds.InstanceNumber = index + 1
    ds.Manufacturer = 'Synthetic'
    ds.ImageType = ['ORIGINAL', 'PRIMARY', 'AXIAL']
    ds.PositionReferenceIndicator = ''
    ds.ImagePositionPatient = [0.0, 0.0, float(index)]
    ds.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    ds.PixelSpacing = [1.0, 1.0]
    ds.SliceThickness = 1.0
    ds.SliceLocation = float(index)
    ds.Rows = ROWS
    ds.Columns = COLUMNS
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1
    ds.RescaleIntercept = 0
    ds.RescaleSlope = 1
    ds.KVP = 120
    ds.AcquisitionNumber = 1
    ds.PixelData = (np.arange(ROWS * COLUMNS, dtype=np.int16) + index).tobytes()
    return ds


def segment(number, label, rgb):
    return hd.seg.SegmentDescription(
        segment_number=number,
        segment_label=label,
        segmented_property_category=hd.sr.CodedConcept('91723000', 'SCT', 'Anatomical Structure'),
        segmented_property_type=hd.sr.CodedConcept('85756007', 'SCT', 'Tissue'),
        algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        display_color=hd.color.CIELabColor.from_rgb(*rgb),
    )


def segments():
    return [
        segment(1, 'Region A', (255, 0, 0)),
        segment(2, 'Region B', (0, 0, 255)),
    ]


def masks_nonoverlap():
    mask = np.zeros((SLICES, ROWS, COLUMNS, 2), dtype=bool)
    mask[0:2, 1:4, 1:4, 0] = True
    mask[1:4, 4:7, 4:7, 1] = True
    return mask


def masks_overlap():
    mask = np.zeros((SLICES, ROWS, COLUMNS, 2), dtype=bool)
    mask[0:3, 1:5, 1:5, 0] = True
    mask[0:4, 3:7, 3:7, 1] = True
    return mask


def make_seg(source_images, pixel_array, name, segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
             transfer_syntax_uid=ExplicitVRLittleEndian):
    return hd.seg.Segmentation(
        source_images=source_images,
        pixel_array=pixel_array,
        segmentation_type=segmentation_type,
        segment_descriptions=segments(),
        series_instance_uid=uid('seg-series', name),
        series_number=100,
        sop_instance_uid=uid('seg', name),
        instance_number=1,
        manufacturer='Synthetic',
        manufacturer_model_name='Fixture Generator',
        software_versions='1',
        device_serial_number='0',
        series_description=f'Synthetic {name}',
        omit_empty_frames=True,
        transfer_syntax_uid=transfer_syntax_uid,
    )


def interleave_frames(seg):
    # Reorder frames slice-major (segment 2 before segment 1 on each slice). Frame order is free in
    # DICOM; this one places a frame of the segment that has to move to a second layer at index 0.
    frames = seg.pixel_array if seg.NumberOfFrames > 1 else seg.pixel_array[None]
    groups = list(seg.PerFrameFunctionalGroupsSequence)

    def key(index):
        group = groups[index]
        z = float(group.PlanePositionSequence[0].ImagePositionPatient[2])
        number = int(group.SegmentIdentificationSequence[0].ReferencedSegmentNumber)
        return (z, -number)

    order = sorted(range(len(groups)), key=key)
    seg.PerFrameFunctionalGroupsSequence = [groups[i] for i in order]
    seg.PixelData = pack_bits(np.stack([frames[i] for i in order]).astype(np.uint8))
    seg.SOPInstanceUID = uid('seg', 'overlap-interleaved')
    seg.file_meta.MediaStorageSOPInstanceUID = seg.SOPInstanceUID
    seg.SeriesInstanceUID = uid('seg-series', 'overlap-interleaved')
    for attribute in ('DimensionOrganizationType',):
        if attribute in seg:
            delattr(seg, attribute)
    return seg


def labelmap_from(mask):
    # (slices, rows, columns) of segment numbers, 0 = background
    labelmap = np.zeros(mask.shape[:3], dtype=np.uint8)
    for index in range(mask.shape[3]):
        labelmap[mask[..., index]] = index + 1
    return labelmap


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ct = [make_ct_slice(i) for i in range(SLICES)]
    for i, ds in enumerate(ct):
        ds.save_as(os.path.join(out_dir, f'ct_{i}.dcm'), enforce_file_format=True)

    make_seg(ct, masks_nonoverlap(), 'nonoverlap').save_as(os.path.join(out_dir, 'seg_nonoverlap.dcm'))
    make_seg(ct, masks_overlap(), 'overlap').save_as(os.path.join(out_dir, 'seg_overlap.dcm'))
    interleave_frames(make_seg(ct, masks_overlap(), 'overlap')).save_as(
        os.path.join(out_dir, 'seg_overlap_interleaved.dcm'))
    make_seg(
        ct, labelmap_from(masks_nonoverlap()), 'labelmap-rle',
        segmentation_type=hd.seg.SegmentationTypeValues.LABELMAP, transfer_syntax_uid=RLELossless,
    ).save_as(os.path.join(out_dir, 'seg_labelmap_rle.dcm'))
    make_seg(
        ct, labelmap_from(masks_nonoverlap()), 'labelmap',
        segmentation_type=hd.seg.SegmentationTypeValues.LABELMAP,
    ).save_as(os.path.join(out_dir, 'seg_labelmap.dcm'))

    enhanced = hd.legacy.LegacyConvertedEnhancedCTImage(
        legacy_datasets=ct,
        series_instance_uid=uid('enhanced-ct-series'),
        series_number=2,
        sop_instance_uid=uid('enhanced-ct'),
        instance_number=1,
    )
    enhanced.save_as(os.path.join(out_dir, 'enhanced_ct.dcm'))
    make_seg([enhanced], masks_nonoverlap(), 'multiframe-ref').save_as(
        os.path.join(out_dir, 'seg_multiframe_ref.dcm'))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
