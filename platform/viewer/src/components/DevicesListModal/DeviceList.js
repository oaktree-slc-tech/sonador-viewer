import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as EditIcon } from '@ohif/ui/src/elements/Svg/svgs/edit.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { createDevice, getDeviceList, removeDevice, updateDevice } from '../../api/deviceList';

import styles from './DevicesList.module.scss';

const headers = [
  { label: 'Imaging Center', id: 'imaging-center' },
  { label: 'Manufacturer', id: 'Manufacturer' },
  { label: 'Model Name', id: 'model-number' },
  { label: 'Software Version', id: 'software-version' },
  { label: 'Filter DICOM Tag Name', id: 'tag-name' },
  { label: 'Filter DICOM Tag Value', id: 'tag-value' },
];

export default function DeviceList({ withDefaultHeader }) {
  const queryClient = useQueryClient();
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const { data: deviceListResponse = [] } = useQuery({
    queryKey: ['deviceList'],
    queryFn: () => getDeviceList(activeServer),
    select: (response) => {
      if (Array.isArray(response)) {
        return response.map(
          ({
             ID,
             InstitutionName,
             Manufacturer,
             ManufacturerModelName,
             SoftwareVersions,
             DcmTag,
             DcmTagValue,
           }) => {
            return {
              ID,
              InstitutionName,
              Manufacturer,
              ManufacturerModelName,
              SoftwareVersions,
              DcmTag,
              DcmTagValue,
              isEditMode: false,
              isUpdated: false,
            };
          },
        );
      }
      return [];
    },
  });

  const { mutate: createDeviceMutate } = useMutation({
    mutationFn: (payload) => createDevice({ server: activeServer, payload }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      toast.success('Device created successfully');
    },
    onError: (error) => {
      toast.error(`Failed to create device: ${error.message}`, { duration: 5000 });
    },
  });

  const { mutate: removeDeviceMutate } = useMutation({
    mutationFn: (deviceId) => removeDevice({ server: activeServer, deviceId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      toast.success('Device removed successfully');
    },
    onError: (error) => {
      toast.error(`Failed to remove device: ${error.message}`, { duration: 5000 });
    },
  });

  const { mutate: updateDeviceMutate } = useMutation({
    mutationFn: (payload) => updateDevice({
      server: activeServer,
      payload: payload.payload,
      deviceId: payload.deviceId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      toast.success('Device updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update device: ${error.message}`, { duration: 5000 });
    },
  });

  const [devicesList, setDevicesList] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState(null);


  const hasInitialized = useRef(false);
  useEffect(() => {
    // Only run if we have a response _and_ haven't initialized yet
    if (deviceListResponse?.length && !hasInitialized.current) {
      // mark as run
      hasInitialized.current = true;

      setDevicesList(deviceListResponse);
    }
  }, [deviceListResponse]);

  const addListItem = () => {
    setDevicesList((prevState) => [
      ...prevState,
      {
        InstitutionName: '',
        Manufacturer: '',
        ManufacturerModelName: '',
        SoftwareVersions: '',
        DcmTag: '',
        DcmTagValue: '',
        isEditMode: true,
      },
    ]);
  };

  const removeListItem = (id, type) => {
    setDeviceToDelete({ id, type });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    const { id, type } = deviceToDelete;

    if (type === 'existed') {
      // Remove from local state immediately for better UX
      setDevicesList((prevState) => {
        return prevState.filter((device) => device.ID !== id);
      });
      // Also call the API to remove from server
      removeDeviceMutate(id);
    } else {
      setDevicesList((prevState) => {
        return prevState.filter((device, index) => index !== id);
      });
    }

    setShowDeleteConfirm(false);
    setDeviceToDelete(null);
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeviceToDelete(null);
  };

  const handleChange = (index, fieldType, value) => {
    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {
        if (index === deviceIndex) {
          let isUpdated = false;
          if (device.ID) {
            const originalDevice = deviceListResponse?.find(d => d.ID === device.ID);
            const initialValue = originalDevice?.[fieldType];
            isUpdated = value !== initialValue;
          }

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
    // Filter out new devices that have at least one required field filled in
    const newDevices = devicesList.filter(({ ID, InstitutionName, Manufacturer, ManufacturerModelName }) =>
      !ID && (InstitutionName || Manufacturer || ManufacturerModelName),
    );
    const updatedDevices = devicesList.filter(({ isUpdated }) => isUpdated);

    if (newDevices.length) {
      newDevices.forEach(
        ({ InstitutionName, Manufacturer, ManufacturerModelName, SoftwareVersions, DcmTag, DcmTagValue }) => {
          createDeviceMutate({
            InstitutionName,
            Manufacturer,
            ManufacturerModelName,
            SoftwareVersions,
            DcmTag,
            DcmTagValue,
          });
        },
      );
    }

    if (updatedDevices.length) {
      updatedDevices.forEach((device) => {
        updateDeviceMutate({
          deviceId: device.ID,
          payload: {
            InstitutionName: device.InstitutionName,
            Manufacturer: device.Manufacturer,
            ManufacturerModelName: device.ManufacturerModelName,
            SoftwareVersions: device.SoftwareVersions,
            DcmTag: device.DcmTag,
            DcmTagValue: device.DcmTagValue,
          },
        });
      });
    }

    setDevicesList((prevState) =>
      prevState.map((device) => ({
        ...device,
        isEditMode: false,
        isUpdated: false,
      })),
    );
  };

  const handleEdit = (index) => {
    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {
        if (deviceIndex === index && device.ID) {
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
  return (
    <>
      {withDefaultHeader && (
        <div>
          <div className={styles.header} >
            <h2 className={styles.tabTitle}>Device list</h2>
            <button className={styles.addNewBtn} onClick={addListItem}>
              <AddCircleIcon />
              <span>Add Row</span>
            </button>
          </div>
          <hr className={styles.divider} style={{ marginBottom: '1rem' }} />

        </div>
      )}
      <div className={styles.devicesList}>
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
          {devicesList?.map((device, index) => (
            <DeviceRow
              key={device.ID || index}
              device={device}
              index={index}
              onChange={handleChange}
              onEdit={handleEdit}
              onRemove={removeListItem}
            />
          ))}
          </tbody>
        </table>
        {!withDefaultHeader &&<div className={styles.addNewContainer}>
          <button className={styles.addNewBtn} onClick={addListItem}>
            <AddCircleIcon />
            <span>Add Row</span>
          </button>
        </div>}
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={handleCancel}>
            Cancel
          </button>
          <button className={styles.save} onClick={handleSave}>
            Save
          </button>
        </div>

        {showDeleteConfirm && (
          <ModalNG
            isOpen={showDeleteConfirm}
            onClose={cancelDelete}
            title="Confirm Delete"
            size="small"
          >
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <p style={{ color: 'white' }}>Are you sure you want to delete this device?</p>
              <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button
                  onClick={cancelDelete}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </ModalNG>
        )}
      </div>
    </>
  );
}

function DeviceRow({
                     device: {
                       ID,
                       InstitutionName,
                       Manufacturer,
                       ManufacturerModelName,
                       SoftwareVersions,
                       DcmTag,
                       DcmTagValue,
                       isEditMode,
                     },
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
          <input type="text" value={InstitutionName}
                 onChange={(e) => onChange(index, 'InstitutionName', e.target.value)} />
        ) : (
          <p>{InstitutionName}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={Manufacturer} onChange={(e) => onChange(index, 'Manufacturer', e.target.value)} />
        ) : (
          <p>{Manufacturer}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={ManufacturerModelName}
                 onChange={(e) => onChange(index, 'ManufacturerModelName', e.target.value)} />
        ) : (
          <p>{ManufacturerModelName}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input
            type="text"
            value={SoftwareVersions}
            onChange={(e) => onChange(index, 'SoftwareVersions', e.target.value)}
          />
        ) : (
          <p>{SoftwareVersions}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={DcmTag} onChange={(e) => onChange(index, 'DcmTag', e.target.value)} />
        ) : (
          <p>{DcmTag}</p>
        )}
      </td>
      <td>
        {isEditMode ? (
          <input type="text" value={DcmTagValue} onChange={(e) => onChange(index, 'DcmTagValue', e.target.value)} />
        ) : (
          <p>{DcmTagValue}</p>
        )}
      </td>

      <td>
        <div className={styles.rowActions}>
          <button onClick={() => onEdit(index)}>
            <EditIcon />
          </button>
          <button onClick={() => onRemove(ID || index, ID ? 'existed' : 'new')}>
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
