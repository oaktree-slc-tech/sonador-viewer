import * as _ from 'lodash';

const defaultState = {
  studyData: {},
};

const servers = (state = defaultState, action) => {
  switch (action.type) {
    case 'SET_STUDY_DATA': {
      const updatedStudyData = _.cloneDeep(state.studyData);
      updatedStudyData[action.StudyInstanceUID] = _.cloneDeep(action.data);

      return Object.assign({}, state, { studyData: updatedStudyData });
    }
    default:
      return state;
  }
};

export default servers;
