import _ from 'lodash';
import { useViewerStudyErrors } from "@ohif/core/src/store/useViewerStudyErrors";


export function logVtkError(servicesManager, errorTitle, options) {
	// 	Log error and provide methods for routing user actions.
	//
	//	@input servicesManager: OHIF services manager
	//	@input errorTitle (str): title to use for the error
	//	@input options (object): options for logging
	//
	//	@option err (JavaScript error): JavaScript error instance to log
	//	@option message (str, default=undefined): user message to be displayed in
	//		log and notifications.
	//	@option studyError (bool): toggles whether the error should be added
	//		to the study list
	//	@option studyId (str, default=undefined): studyId to be used for writing
	//		error details to study error list.
	//	@option loggerService (bool): toggles whether the error should be registere
	//		with the OHIF logging service
	//	@option userNotification (bool): toggles whether a user notification should
	//		be triggered.
	//	@option userNotificationOptions (object): options passed to the user 
	//		notification service.

	// Default options
	options = options || {};
	_.defaults(options, {
		studyError: false,
		loggerService: true,
		userNotification: false,
	});

	// Retrieve UI notification and logging service
    const { UINotificationService, LoggerService } = servicesManager.services;

	// Write error to the console for debugging
	console.error(errorTitle, options.message || '', options.err || '');

	if (options.loggerService) {
		
		// Write error to OHIF logger service	
		LoggerService.error({ 
			
			// err provides system details of the issue, message is the human readable version
			// for system details err is used if provided with message and errorTitle used as fallbacks.
			// For message, the user message is provided (if defined) with errorTitle used as a fallback.
			err: options.err || options.message || errorTitle, 
			message: options.message || errorTitle
		});
	}

	if (options.studyError && options.studyId) {

		// Add error to study errors list
		useViewerStudyErrors.getState().addError(_.extend(
			_.pick(options, 'studyId', 'message'), { title: errorTitle }));
	}

	// Display user notification
	if (options.userNotification) {

		// Options are passed the user notification service via userNotificationOptions
		// with an override of title and message, which are taken from the title and message
		// properties of the global options.
		const userNotificationOptions = _.extend(options.userNotificationOptions || {}, {
			title: errorTitle,
			message: options.message
		})
		_.defaults(userNotificationOptions, {
			type: 'error',
			autoClose: false,
		});

		UINotificationService.show(userNotificationOptions);
	}
}