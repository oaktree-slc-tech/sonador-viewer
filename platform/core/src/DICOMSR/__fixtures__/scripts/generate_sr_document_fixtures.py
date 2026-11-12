'''	Synthetic fixtures for the SR document kinds and the properties under the NUM item.

	Writes, under `platform/core/src/DICOMSR/__fixtures__/`:

	* `synthetic-ct/ct-NN.dcm`: an axial CT series of 12 slices, 64 x 48 pixels, Pixel Spacing
	  0.8 mm between rows and 1.2 mm between columns, slices 3 mm apart (z = 0 to 33), in one Frame
	  of Reference. Unequal spacing and slices more than 2 mm apart are what the read-only geometry
	  and the out-of-plane rules are tested against.
	* `sonador-io.application-document.dcm`: an application document, a Comprehensive 3D SR with the
	  Sonador-SR root title (`Clinical-Report`), written by the Sonador IO client. It holds a Length,
	  an Angle and a Cobb angle in the patient domain on the plane of the slice at z = 9, a second
	  Length at z = 10.5 (on a plane no image holds), a Series Tag, a scalar measurement in the
	  primary group (a group without a Cornerstone tracking identifier) and a meta group holding a
	  planning note (content outside the Imaging Measurements container). The measurements carry a
	  description and display colours under the NUM item.
	* `sonador-io.exchange-document.dcm`: an exchange document (`126000`) with the same Length, Angle
	  and Cobb angle on the slice at z = 18, under tracking UIDs of its own, so that the two
	  documents are not drawn over each other.

	Both documents also hold a circle on the plane of their measurements: the Area, Perimeter and
	Radius NUMs, each inferred from its own copy of the SCOORD3D ELLIPSE, properties under the Area
	NUM. The client release this script runs against has no circle model, so the script adds that
	group to each document after the client writes it, copying the properties of the document's
	first Length. A client release with the circle model replaces the hand-built group.

	Every identifier is synthetic. Run with the Sonador IO client (sonador-client `master`) and the
	Oak-Tree highdicom fork it requires on the Python path, from the directory holding the `sonador`
	package:

		python generate_sr_document_fixtures.py OUTPUT_DIRECTORY
'''
import copy, os, sys

import numpy as np

import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.sr.codedict import codes
from pydicom.uid import ExplicitVRLittleEndian

from highdicom.sr import CodedConcept, GraphicTypeValues3D, NumContentItem, RelationshipTypeValues, \
	Scoord3DContentItem, TextContentItem

from sonador.apisettings.base import AngleMeasurement, CobbAngleMeasurement, Finding, ImageReference, \
	LengthMeasurement, Measurement, ReportMetaGroup
from sonador.apisettings.display_attrs import DisplayAttributes
from sonador.imaging.helpers.sr import SonadorComprehensiveSR3D, SonadorImagingMeasurementReport


# Synthetic study
PATIENT = {'PatientName': 'Synthetic^Phantom', 'PatientID': 'SYNTHETIC-PHANTOM', 'PatientBirthDate': '', 'PatientSex': 'O'}
STUDY_UID = '2.25.316170001'
SERIES_UID = '2.25.316170002'
FRAME_OF_REFERENCE_UID = '2.25.316170003'
CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2'

ROWS, COLUMNS = 48, 64
ROW_SPACING, COLUMN_SPACING = 0.8, 1.2
SLICE_SPACING = 3.0
SLICES = 12
ORIGIN = (-COLUMNS * COLUMN_SPACING / 2, -ROWS * ROW_SPACING / 2)

PROCEDURE = codes.LN.CTUnspecifiedBodyRegion
COLORS = {'Background': (16, 32, 48), 'Border': (255, 136, 0), 'Value': (138, 208, 168), 'Meaning': (192, 199, 248)}
TAG = CodedConcept('img-qc.accept', 'Sonador-SEG', 'Image Accepted', scheme_version='0.2')

# The slices the in-plane measurements lie on (application and exchange document), and the plane
# between two slices for the other Length
Z_IMAGE = 9.0
Z_EXCHANGE = 18.0
Z_BETWEEN = 10.5


def sop_instance_uid(index):
	return '2.25.3161701%02d' % (index + 10)


def ct_slice(index):
	'''	One axial slice: air, a cylinder of bone-like density, and a marker in the first row and column
		so the orientation can be checked by eye
	'''
	z = index * SLICE_SPACING
	ds = Dataset()
	ds.file_meta = FileMetaDataset()
	ds.file_meta.MediaStorageSOPClassUID = CT_IMAGE_STORAGE
	ds.file_meta.MediaStorageSOPInstanceUID = sop_instance_uid(index)
	ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

	for name, value in PATIENT.items():
		setattr(ds, name, value)
	ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.SOPInstanceUID = STUDY_UID, SERIES_UID, sop_instance_uid(index)
	ds.SOPClassUID = CT_IMAGE_STORAGE
	ds.StudyID, ds.AccessionNumber, ds.StudyDate, ds.StudyTime = '1', '', '20261110', '120000'
	ds.StudyDescription = 'Synthetic phantom'
	ds.Modality, ds.SeriesNumber, ds.SeriesDescription = 'CT', 1, 'Synthetic CT, unequal pixel spacing'
	ds.InstanceNumber = index + 1
	ds.FrameOfReferenceUID = FRAME_OF_REFERENCE_UID
	ds.PositionReferenceIndicator = ''
	ds.ImagePositionPatient = [ORIGIN[0], ORIGIN[1], z]
	ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
	ds.PixelSpacing = [ROW_SPACING, COLUMN_SPACING]
	ds.SliceThickness = SLICE_SPACING
	ds.SliceLocation = z
	ds.Rows, ds.Columns = ROWS, COLUMNS
	ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, 'MONOCHROME2'
	ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
	ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = -1024, 1, 'HU'
	ds.WindowCenter, ds.WindowWidth = 300, 1500
	ds.ImageType = ['DERIVED', 'SECONDARY', 'AXIAL']

	y, x = np.mgrid[0:ROWS, 0:COLUMNS]
	px, py = ORIGIN[0] + x * COLUMN_SPACING, ORIGIN[1] + y * ROW_SPACING
	hu = np.full((ROWS, COLUMNS), -1000, dtype=np.int16)
	hu[px ** 2 + py ** 2 <= 15 ** 2] = 400
	hu[0, :8] = 1000
	hu[:8, 0] = 1000
	ds.PixelData = (hu + 1024).astype(np.int16).tobytes()
	return ds


def properties(name, **extra):
	return dict(description='%s (synthetic)' % name, text='Synthetic', location='Synthetic location',
		display=DisplayAttributes.from_color(COLORS), **extra)


def measurements(uid_base, z):
	'''	The Length, Angle and Cobb angle on the plane of the slice at `z`, in the patient domain
	'''
	return [
		LengthMeasurement([(-20.0, -10.0, z), (20.0, 5.0, z)], frame_of_reference_uid=FRAME_OF_REFERENCE_UID,
			tracking_uid='%s1' % uid_base, views=['axial'], **properties('Length')),
		AngleMeasurement((20.0, 0.0, z), (0.0, 0.0, z), (0.0, 15.0, z), frame_of_reference_uid=FRAME_OF_REFERENCE_UID,
			tracking_uid='%s2' % uid_base, views=['axial'], **properties('Angle')),
		CobbAngleMeasurement(((-30.0, -12.0, z), (-10.0, -12.0, z)), ((-30.0, 10.0, z), (-12.0, 2.0, z)),
			frame_of_reference_uid=FRAME_OF_REFERENCE_UID, tracking_uid='%s3' % uid_base, views=['axial'],
			**properties('Cobb angle')),
	]


# The circle of each document: its center on the plane of the measurements, its radius in mm
CIRCLE_CENTER = (10.0, -8.0)
CIRCLE_RADIUS = 6.0
CIRCLE_TRACKING_ID = 'cornerstoneTools@^4.0.0:CircleROI'
CIRCLE_VALUES = (
	(CodedConcept('42798000', 'SCT', 'Area'), CodedConcept('mm2', 'UCUM', 'square millimeter'), lambda r: np.pi * r ** 2),
	(CodedConcept('131191004', 'SCT', 'Perimeter'), CodedConcept('mm', 'UCUM', 'mm'), lambda r: 2 * np.pi * r),
	(CodedConcept('131190003', 'SCT', 'Radius'), CodedConcept('mm', 'UCUM', 'mm'), lambda r: r),
)


def code_value(item):
	concept = item.ConceptNameCodeSequence[0]
	return getattr(concept, 'CodeValue', None) or getattr(concept, 'LongCodeValue', None)


def circle_group(doc, tracking_uid, z):
	'''	A circle measurement group on the axial plane at `z`: the ELLIPSE `c - ru, c + ru, c - rv, c + rv`
		with u the row direction and v = n x u (n the plane normal, +z), under each NUM; under the Area
		NUM the properties of the document's first Length, with a description of its own. Like the
		other measurements of the documents it has no Drawing-Plane: it lies on the plane of a slice.
	'''
	(cx, cy), r = CIRCLE_CENTER, CIRCLE_RADIUS
	ellipse = np.array([(cx - r, cy, z), (cx + r, cy, z), (cx, cy - r, z), (cx, cy + r, z)])

	container = next(item for item in doc.ContentSequence if code_value(item) == '126010')
	length = next(group for group in container.ContentSequence
		if any(getattr(item, 'TextValue', None) == 'cornerstoneTools@^4.0.0:Length' for item in group.ContentSequence))
	length_num = next(item for item in length.ContentSequence if item.ValueType == 'NUM')
	properties = [copy.deepcopy(item) for item in length_num.ContentSequence if item.RelationshipType == 'HAS PROPERTIES']
	for item in properties:
		if code_value(item) == 'Sonador-Measurement.Description':
			item.TextValue = 'Circle (synthetic)'

	group = copy.deepcopy(length)
	for item in group.ContentSequence:
		if code_value(item) == '112039':
			item.TextValue = CIRCLE_TRACKING_ID
		elif code_value(item) == '112040':
			item.UID = tracking_uid
	nums = []
	for index, (name, unit, value) in enumerate(CIRCLE_VALUES):
		num = Dataset(NumContentItem(name=name, value=float(value(r)), unit=unit,
			relationship_type=RelationshipTypeValues.CONTAINS))
		geometry = Dataset(Scoord3DContentItem(name=codes.DCM.ImageRegion, graphic_type=GraphicTypeValues3D.ELLIPSE,
			graphic_data=ellipse, frame_of_reference_uid=FRAME_OF_REFERENCE_UID,
			relationship_type=RelationshipTypeValues.INFERRED_FROM))
		# As the client writes its geometry: no concept name
		del geometry.ConceptNameCodeSequence
		num.ContentSequence = Sequence([geometry] + (properties if index == 0 else []))
		nums.append(num)
	group.ContentSequence = Sequence([item for item in group.ContentSequence if item.ValueType != 'NUM'] + nums)
	container.ContentSequence.append(group)


def write(model, path, instance_uid, circle_uid, z):
	model.create_sr(record_instances=True, dcmsr_series_uid='%s.1' % instance_uid, dcmsr_instance_uid=instance_uid).save_as(path)
	# The circle group is added to the document as written, read back as plain datasets
	doc = pydicom.dcmread(path)
	circle_group(doc, circle_uid, z)
	doc.save_as(path)
	return doc


def main(output):
	images = [ct_slice(index) for index in range(SLICES)]
	os.makedirs(os.path.join(output, 'synthetic-ct'), exist_ok=True)
	for index, ds in enumerate(images):
		pydicom.dcmwrite(os.path.join(output, 'synthetic-ct', 'ct-%02d.dcm' % (index + 1)), ds, enforce_file_format=True)

	common = dict(report_procedure=PROCEDURE, dcm_evidence=[images[0]], person_observer='Observer^Synthetic')
	reference = ImageReference(CT_IMAGE_STORAGE, sop_instance_uid(0), None, SERIES_UID)

	# Application document: measurements, a Series Tag, a group without a Cornerstone tracking
	# identifier, and content outside the Imaging Measurements container
	between = LengthMeasurement([(-10.0, -10.0, Z_BETWEEN), (10.0, 10.0, Z_BETWEEN)], frame_of_reference_uid=FRAME_OF_REFERENCE_UID,
		tracking_uid='2.25.31617054', views=['axial'], **properties('Length between slices'))
	scalar = Measurement(7.0, name=codes.SCT.Length)
	application = SonadorComprehensiveSR3D(
		measurements=measurements('2.25.3161705', Z_IMAGE) + [between, scalar],
		findings=[Finding.series_tag(TAG, reference=reference, tracking_uid='2.25.31617055')],
		groups=[ReportMetaGroup(tracking_id='Synthetic planning', tracking_uid='2.25.31617056',
			meta=[TextContentItem(name=codes.DCM.Comment, value='Synthetic planning note',
				relationship_type=RelationshipTypeValues.CONTAINS)])],
		**common)
	write(application, os.path.join(output, 'sonador-io.application-document.dcm'), '2.25.316170500', '2.25.31617057', Z_IMAGE)

	exchange = SonadorImagingMeasurementReport(measurements=measurements('2.25.3161706', Z_EXCHANGE), **common)
	write(exchange, os.path.join(output, 'sonador-io.exchange-document.dcm'), '2.25.316170600', '2.25.31617067', Z_EXCHANGE)


if __name__ == '__main__':
	main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
