import _ from 'lodash';
import { uiNotificationService, NotificationLogSources } from '@ohif/core';

// This helper originally existed because reporting one VTK failure meant writing to three
// unrelated places by hand: the console, the OHIF logger, and the per-study error store, plus a
// notification. Those are now one pathway (ohif-viewers#84) -- the notification and logger
// services both record into the NotificationLogService -- so this is a thin adapter that keeps
// the existing call sites and their flags working.

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
	//	@option studyError (bool): toggles whether the error should be scoped to the
	//		study, which is what makes it appear in that study's Issues list
	//	@option studyId (str, default=undefined): study the error belongs to
	//	@option loggerService (bool): toggles whether the error should be registered
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

	const { LoggerService } = servicesManager.services;

	// The user message, falling back to the title.
	const message = options.message || errorTitle;

	// Scoping the entry to a study is what files it under that study in the Issues panel.
	const studyInstanceUID = options.studyError ? options.studyId : undefined;

	// Write error to the console for debugging
	console.error(errorTitle, options.message || '', options.err || '');

	if (options.userNotification) {
		// A notification records its own log entry, so this single call covers both surfaces.
		// Presentation extras supplied by the caller -- the action button, autoClose -- ride along.
		uiNotificationService.show(
			_.defaults(
				{
					title: errorTitle,
					message,
					studyInstanceUID,
					error: options.err,
					source: NotificationLogSources.VIEWPORT,
					log: true,
				},
				options.userNotificationOptions || {},
				{ type: 'error', autoClose: false }
			)
		);

		return;
	}

	if (options.loggerService || options.studyError) {
		// No toast: recorded in the Issues list and the console only.
		LoggerService.error({
			error: options.err,
			title: errorTitle,
			message,
			studyInstanceUID,
		});
	}
}
