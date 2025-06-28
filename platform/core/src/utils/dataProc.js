// Data processing utiliites which can be used for cleaning data and schema transforms.
import _ from 'lodash';


function firstDefinedValue(...args) {
	// Retrieve the first defined value from the provided argument. Excludes both undefined and null values.

	// @returns first defined value from the provided list of arguments. If a value cannot be found
	// 	undefined is returned.
	return _.find(Array.from(args), val =>  !_.isNil(val));
}


const dataProc = {
	firstDefinedValue,
}

export default dataProc;
export { firstDefinedValue, }