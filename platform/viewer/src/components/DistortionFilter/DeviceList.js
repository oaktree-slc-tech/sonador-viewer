import _ from 'lodash';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF, { redux } from '@ohif/core';

import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as EditIcon } from '@ohif/ui/src/elements/Svg/svgs/edit.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';
import { ReactComponent as CancelIcon } from '@ohif/ui/src/elements/Icon/icons/times.svg';

import { getDevicelistGroup, createDevice, getDeviceList, removeDevice, updateDevice } from '../../api/distortionFilter';

import groupSearchStyles from '../../styles/groupSearch.module.scss';
import globalTableStyles from '../../styles/globalTableStyles.module.scss';
import settingsPanelTableStyles from '../../styles/settingsPanelTableStyles.module.scss';
import styles from './DevicesList.module.scss';
import { uiNotificationService } from '@ohif/core';


const headers = [
  { label: 'Imaging Center', id: 'imaging-center' },
  { label: 'Manufacturer', id: 'Manufacturer' },
  { label: 'Model Name', id: 'model-number' },
  { label: 'Software Version', id: 'software-version' },
  { label: 'Filter DICOM Tag Name', id: 'tag-name' },
  { label: 'Filter DICOM Tag Value', id: 'tag-value' },
];


const useGroupSearch = (server, searchTerm) => {
  // Cache function for device list group search

  return useQuery({
    queryKey: ['deviceList', 'groupSearch', server, searchTerm],
    queryFn: () => getDevicelistGroup(server, searchTerm),
  });
};


export default function DeviceList() {
  // Editing component for the Sonador / Distortion Filter Device List.

  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  // Group Search State
  const [groupSearchTerm, setGroupSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupSearchResponse, setShowGroupSearchResponse] = useState(true);
  const { data: groupSearch = [] } = useGroupSearch(activeServer, groupSearchTerm);

  useEffect(() => {
    // Clear selected group if activeServer is changed
    setSelectedGroup(null);
    setGroupSearchTerm('');
  }, [activeServer]);

  // ACL for the device list
  const [aclDeviceList, setAclDeviceList] = useState(false);
  const [aclDeviceListModify, setAclDeviceListModify] = useState(false);

  // Save / Cancel State
  const [changesPending, setChangesPending] = useState(false);

  const handleGroupInputChange = async (e) => {
    // Search for groups
    
    setGroupSearchTerm(e.target.value);
    setSelectedGroup(null);
  }

  const handleSelectGroup = (group) => {
    // Set currently selected group and update the input name to the group name

    setSelectedGroup(group);
    setGroupSearchTerm(group.name);
    setShowGroupSearchResponse(false);
  }

  const { data: deviceListResponse = [] } = useQuery({
    // Retrieve the device list for the group

    queryKey: ['deviceList', selectedGroup],
    queryFn: () => getDeviceList(activeServer, selectedGroup, {
      success: (res) => {

        if (res.headers.get('sonador-permissions')) {
          const _perms = JSON.parse(res.headers.get('sonador-permissions'));

          setAclDeviceList(_perms.devices_list || false);
          setAclDeviceListModify(_perms.devices_list_modify || false);
        }
      }
    }),
    select: (response) => {
      if (Array.isArray(response)) {
        return response.map(device => _.extend(device, { isEditMode: false, isUpdated: false }));
      }
      
      return [];
    },
  });

  const { mutate: createDeviceMutate } = useMutation({
    mutationFn: ({ group, payload }) => createDevice({ server: activeServer, group, payload }, {
      success: (res) => {
        setDevicesList((prevState) => {
          return prevState.map((d) => {

            // Update edit mode, flags, and ID value for newly created device
            if (!d.ID && res.ID && d.InstitutionName == payload.InstitutionName 
              && d.Manufacturer == payload.Manufacturer && d.ManufacturerModelName == payload.ManufacturerModelName 
              && d.SoftwareVersions == payload.SoftwareVersions && d.DcmTag == payload.DcmTag && d.DcmTagValue == payload.DcmTagValue) {
              _.extend(d, { ID: res.ID, isEditMode: false, isUpdated: false });
            }

            return d;
          });
        });
      }
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      uiNotificationService.show({ title: 'Device created successfully', type: 'success' });
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to create device', message: error.message, type: 'error' });
    },
  });

  const { mutate: removeDeviceMutate } = useMutation({
    mutationFn: ({ group, deviceId }) => removeDevice({ server: activeServer, group, deviceId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      uiNotificationService.show({ title: 'Device removed successfully', type: 'success' });
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to remove device', message: error.message, type: 'error' });
    },
  });

  const { mutate: updateDeviceMutate } = useMutation({
    mutationFn: (payload) => updateDevice({
      server: activeServer, group: payload.group, deviceId: payload.deviceId,
      payload: payload.payload,
    }, {
      success: () => {
        setDevicesList((prevState) => {
          return prevState.map((d) => {

            // Return edit and mode flags for edited value
            if (d.ID == payload.deviceId) {              
              _.extend(d, { isEditMode: false , isUpdated: false });
            }

            return d;
          });
        });
      }
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['deviceList']);
      uiNotificationService.show({ title: 'Device updated successfully', type: 'success' });
    },
    onError: (error) => {
      uiNotificationService.show({ title: 'Failed to update device', message: error.message, type: 'error' });
    },
  });

  const [devicesList, setDevicesList] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState(null);

  // Track device list init
  const hasInitialized = useRef(false);
  useEffect(() => {
    // Initialize devices list (updates on device list response changes)
    
    // Only run if we have a response _and_ haven't initialized yet
    if (deviceListResponse?.length && !hasInitialized.current) {
      
      // Update initialized flag
      hasInitialized.current = true;
      setDevicesList(deviceListResponse);
    }
  }, [deviceListResponse]);

  useEffect(() => {
    // Update device list response and display list

    // Clear initialized flag when group is reset to allow for the device list to reload
    if (hasInitialized.current && !selectedGroup) {
      hasInitialized.current = false;
      setDevicesList(deviceListResponse);
    }
  }, [selectedGroup]);

  const addListItem = () => {
    // Add new list item to the table

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

    if (type === 'existing') {
      
      // Remove from local state immediately
      setDevicesList((prevState) => {
        return prevState.filter((device) => device.ID !== id);
      });
      
      // Remove from server
      removeDeviceMutate({ group: selectedGroup, deviceId: id });
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

  useEffect(() => {
    // Toggle changes pending based on the state of the results list

    const _pending = (devicesList && devicesList.length > 0 && !_.every(devicesList, (d) => !d.isEditMode && !d.isUpdated)) ?? false;
    setChangesPending(_pending);
  }, [devicesList]);

  const handleChange = (index, fieldType, value) => {
    // Update device data field

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
    // Persist changes to the database

    // Filter new and updated devices for persistence
    const newDevices = devicesList.filter(({ ID, InstitutionName, Manufacturer, ManufacturerModelName }) =>
      !ID && (InstitutionName || Manufacturer || ManufacturerModelName)
    );
    const updatedDevices = devicesList.filter(({ isUpdated }) => isUpdated);

    if (newDevices.length) {
      newDevices.forEach(({ InstitutionName, Manufacturer, ManufacturerModelName, SoftwareVersions, DcmTag, DcmTagValue }) => {
        createDeviceMutate({
          group: selectedGroup,
          payload: {
            InstitutionName,
            Manufacturer,
            ManufacturerModelName,
            SoftwareVersions,
            DcmTag,
            DcmTagValue,
          }
        });
      });
    }

    if (updatedDevices.length) {
      updatedDevices.forEach((device) => {
        updateDeviceMutate({
          group: selectedGroup,
          deviceId: device.ID,
          payload: _.pick(device, 
            'InstitutionName', 'Manufacturer', 'ManufacturerModelName', 'SoftwareVersions', 'DcmTag', 'DcmTagValue'),
        });
      });
    }
  };

  const handleEdit = (index) => {
    // Toggle editing for the device row

    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {

        if (deviceIndex === index && device.ID) {

          // Toggle edit mode of the device row
          return {
            ...device,
            isEditMode: !device.isEditMode,
          };
        }

        return device;
      });
    });
  };

  const handleCancelRowEdit = (index) => {
    // Cancel editing and restore the previous data    

    setDevicesList((prevState) => {
      return prevState.map((device, deviceIndex) => {

        if (deviceIndex === index && device.ID) {

          // Retrieve response device
          const device0 = deviceListResponse.find(d => d.ID == device.ID);
          if (device0) {
            return device0;
          }
        }

        return device;
      });
    });
  }

  const handleCancel = () => {
    // Clear pending items and restore list to previous state

    setDevicesList(deviceListResponse);
  };

  // Row-number column + data columns + the action column (only rendered with modify permission)
  const columnCount = headers.length + 1 + (aclDeviceListModify ? 1 : 0);

  
  return (
    <>

    <div>
      <div className={styles.header} >
        <h2 className={styles.tabTitle}>Distortion Filter Device List</h2>
        {selectedGroup && aclDeviceListModify && (
          <button className={styles.addNewBtn} onClick={addListItem}>
            <AddCircleIcon />
            <span>Add Row</span>
          </button>
        )}
      </div>
      <hr className={styles.divider} style={{ marginBottom: '1rem' }} />

    </div>

    {/* Group Search */}
    <div className={styles.inputGroup}>
      <label htmlFor="group-search">Select Group</label>
      <input id="group-search" type="text" value={groupSearchTerm} 
        onChange={handleGroupInputChange} onFocus={() => setShowGroupSearchResponse(true)}
        placeholder="Search for group" className={styles.input} />

        {showGroupSearchResponse && groupSearch.length > 0 && (
          <ul className={groupSearchStyles.dropdown}>
            {groupSearch.map((group) => (
              <li key={group.id} className={groupSearchStyles.dropdownItem} 
                onClick={() => handleSelectGroup(group)}>
                {group.name}
              </li>
            ))}
          </ul>
        )}
    </div>

    {selectedGroup && aclDeviceList && (
        <>        
        <div className={styles.devicesList}>
          <div className={styles.tableScroll}>
            <table>
              <thead>
              <tr>
                <th className={settingsPanelTableStyles.listHeaderFirstItem} />
                {headers.map(({ id, label }) => {
                  return <th key={id}>{label}</th>;
                })}
                {aclDeviceListModify && (
                  <th className={classNames(settingsPanelTableStyles.listHeaderLastItem,
                    settingsPanelTableStyles.stickyActions)} />
                )}
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
                  onCancelEdit={handleCancelRowEdit}
                  onRemove={removeListItem}
                  aclModify={aclDeviceListModify}
                />
              ))}
              {(devicesList?.length == 0) && (
                <tr><td colSpan={columnCount}>
                  <p className={globalTableStyles.noMatchingResults}>
                    {t('No devices defined for distortion filter.')}
                  </p>
                </td></tr>
              )}
              </tbody>
            </table>
          </div>


          {changesPending && (
            <div className={styles.footer}>
              <button className={styles.cancel} onClick={handleCancel}>
                Cancel
              </button>
              <button className={styles.save} onClick={handleSave}>
                Save
              </button>
            </div>
          )}
          

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
    )}
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
     onCancelEdit,
     onRemove,
     aclModify=false,
   }) {
    // Table row for displaying distortion filter rows

  return (
    <tr className={settingsPanelTableStyles.listItem}>
      <td className={settingsPanelTableStyles.listItemNumber}>{index + 1}</td>
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

      {aclModify && <td className={settingsPanelTableStyles.stickyActions}>
        <div className={settingsPanelTableStyles.rowActions}>
          {ID && !isEditMode && (
            <button onClick={() => onEdit(index)}>
              <EditIcon />
            </button>
          )}
          {ID && isEditMode && (
            <button onClick={() => onCancelEdit(index)}>
              <CancelIcon />
            </button>
          )}
          <button onClick={() => onRemove(ID || index, ID ? 'existing' : 'new')}>
            <RemoveIcon />
          </button>
        </div>
      </td>}
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
  onCancelEdit: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  aclModify: PropTypes.bool.isRequired,
};
