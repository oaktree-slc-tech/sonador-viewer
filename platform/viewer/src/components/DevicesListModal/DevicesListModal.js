import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as EditIcon } from '@ohif/ui/src/elements/Svg/svgs/edit.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/fillClose.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { createDevice, getDeviceList, removeDevice, updateDevice } from '../../api/deviceList';

import styles from './DevicesListModal.module.scss';

const headers = [
  { label: 'Imaging Center', id: 'imaging-center' },
  { label: 'Manufacturer', id: 'Manufacturer' },
  { label: 'Model Number', id: 'model-number' },
  { label: 'Software Version', id: 'software-version' },
  { label: 'Filter DICOM Tag Name', id: 'tag-name' },
  { label: 'Filter DICOM Tag Value', id: 'tag-value' },
];

export default function DevicesListModal({ setIsOpen }) {
  const queryClient = useQueryClient();

  const { data: deviceListResponse } = useQuery({
    queryKey: ['deviceList'],
    queryFn: getDeviceList,
    select: (response) => {
      if (Array.isArray(response)) {
        return response.map(
          ({
            ID,
            InstitutionName,
            Manufacturer,
            ManufacturerModelName,
            SoftwareVersion,
            DICOMTagName,
            DICOMTagValue,
          }) => {
            return {
              id: ID,
              imagingCenter: InstitutionName,
              manufacturer: Manufacturer,
              modelNumber: ManufacturerModelName,
              softwareVersion: SoftwareVersion,
              dcmTagName: DICOMTagName,
              dcmTagValue: DICOMTagValue,
              isEditMode: false,
              isUpdated: false,
            };
          }
        );
      }
    },
  });

  const { mutate: createDeviceMutate } = useMutation({
    mutationFn: (payload) => createDevice(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
    },
  });

  const { mutate: removeDeviceMutate } = useMutation({
    mutationFn: (deviceId) => removeDevice(deviceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
    },
  });

  const { mutate: updateDeviceMutate } = useMutation({
    mutationFn: (payload) => updateDevice(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
    },
  });

  const [devicesList, setDevicesList] = useState([]);
  const [removedDevices, setRemovedDevices] = useState([]);

  useEffect(() => {
    if (deviceListResponse) {
      setDevicesList(deviceListResponse);
    }
  }, [deviceListResponse]);

  const addListItem = () => {
    setDevicesList((prevState) => [
      ...prevState,
      {
        imagingCenter: '',
        manufacturer: '',
        modelNumber: '',
        softwareVersion: '',
        dcmTagName: '',
        dcmTagValue: '',
        isEditMode: true,
      },
    ]);
  };

  const removeListItem = (id, type) => {
    setDevicesList((prevState) => {
      return prevState.filter((device, index) => {
        if (type === 'new') {
          return index !== id;
        }

        return device.id !== id;
      });
    });

    if (type === 'existed') {
      setRemovedDevices((prevState) => [...prevState, id]);
    }
  };

  const handleChange = (index, fieldType, value) => {
    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {
        if (index === deviceIndex) {
          const initialValue = deviceListResponse?.find((_, deviceIndex) => deviceIndex === index)?.[fieldType];
          const isUpdated = value !== initialValue;

          return {
            ...device,
            [fieldType]: value,
            isUpdated,
          };
        }

        return device;
      });
    });
  };

  const handleSave = () => {
    const newDevices = devicesList.filter(({ id }) => !id);
    const updatedDevices = devicesList.filter(({ isUpdated }) => isUpdated);

    if (newDevices.length) {
      newDevices.forEach(({ imagingCenter, manufacturer, modelNumber, softwareVersion, dcmTagName, dcmTagValue }) => {
        createDeviceMutate({
          imaging_center: imagingCenter,
          manufacturer: manufacturer,
          model_number: modelNumber,
          software_version: softwareVersion,
          dcm_tag_name: dcmTagName,
          dcm_tag_value: dcmTagValue,
        });
      });
    }

    if (removedDevices.length) {
      removedDevices.forEach((id) => {
        removeDeviceMutate(id);
      });
    }

    if (updatedDevices.length) {
      updatedDevices.forEach((device) => {
        updateDeviceMutate({
          deviceId: device.id,
          payload: {
            imaging_center: device.imagingCenter,
            manufacturer: device.manufacturer,
            model_number: device.modelNumber,
            software_version: device.softwareVersion,
            dcm_tag_name: device.dcmTagName,
            dcm_tag_value: device.dcmTagValue,
          },
        });
      });
    }
  };

  const handleEdit = (index) => {
    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {
        if (deviceIndex === index && device.id) {
          return {
            ...device,
            isEditMode: !device.isEditMode,
          };
        }

        return device;
      });
    });
  };

  const handleCancel = () => {
    setDevicesList(deviceListResponse);
  };

  return createPortal(
    <>
      <div className={styles.backdrop} />
      <div className={styles.devicesListModal}>
        <div className={styles.header}>
          <p className={styles.title}>Devices List</p>
          <button className={styles.close} onClick={() => setIsOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th className={styles.listHeaderFirstItem} />
              {headers.map(({ id, label }) => {
                return <th key={id}>{label}</th>;
              })}
              <th className={styles.listHeaderLastItem} />
            </tr>
          </thead>
          <tbody>
            {devicesList.map((device, index) => (
              <DeviceRow
                key={device.id || index}
                device={device}
                index={index}
                onChange={handleChange}
                onEdit={handleEdit}
                onRemove={removeListItem}
              />
            ))}
          </tbody>
        </table>
        <div className={styles.addNewContainer}>
          <button className={styles.addNewBtn} onClick={addListItem}>
            <AddCircleIcon />
            <span>Add Row</span>
          </button>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={handleCancel}>
            Cancel
          </button>
          <button className={styles.save} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </>,
    document.getElementById('body')
  );
}

function DeviceRow({
  device: { id, imagingCenter, manufacturer, modelNumber, softwareVersion, dcmTagName, dcmTagValue, isEditMode },
  index,
  onChange,
  onEdit,
  onRemove,
}) {
  return (
    <tr className={styles.listItem}>
      <td className={styles.listItemNumber}>{index + 1}</td>
      <td>
        {isEditMode ? (
          <input type="text" value={imagingCenter} onChange={(e) => onChange(index, 'imagingCenter', e.target.value)} />
        ) : (
          <p>{imagingCenter}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={manufacturer} onChange={(e) => onChange(index, 'manufacturer', e.target.value)} />
        ) : (
          <p>{manufacturer}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={modelNumber} onChange={(e) => onChange(index, 'modelNumber', e.target.value)} />
        ) : (
          <p>{modelNumber}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input
            type="text"
            value={softwareVersion}
            onChange={(e) => onChange(index, 'softwareVersion', e.target.value)}
          />
        ) : (
          <p>{softwareVersion}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={dcmTagName} onChange={(e) => onChange(index, 'dcmTagName', e.target.value)} />
        ) : (
          <p>{dcmTagName}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={dcmTagValue} onChange={(e) => onChange(index, 'dcmTagValue', e.target.value)} />
        ) : (
          <p>{dcmTagValue}</p>
        )}
      </td>

      <td>
        <div className={styles.rowActions}>
          <button onClick={() => onEdit(index)}>
            <EditIcon />
          </button>
          <button onClick={() => onRemove(id || index, id ? 'existed' : 'new')}>
            <RemoveIcon />
          </button>
        </div>
      </td>
    </tr>
  );
}

DeviceRow.propTypes = {
  device: PropTypes.shape({
    id: PropTypes.string,
    imagingCenter: PropTypes.string,
    manufacturer: PropTypes.string,
    modelNumber: PropTypes.string,
    softwareVersion: PropTypes.string,
    dcmTagName: PropTypes.string,
    dcmTagValue: PropTypes.string,
    isEditMode: PropTypes.bool,
    isUpdated: PropTypes.bool,
  }).isRequired,
  index: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};
