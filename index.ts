#!/usr/bin/node
import { calendar_v3, google } from 'googleapis';
import { JWT } from 'google-auth-library/build/src/auth/jwtclient';
import { readFileSync } from 'fs';
import { SourceTargetConfiguration } from './models';
import moment = require('moment');

const calendar: calendar_v3.Calendar = google.calendar('v3');

const key = JSON.parse(readFileSync('google_calendar_key.json', 'utf8'));


const scopes = ['https://www.googleapis.com/auth/calendar'];
const auth: JWT = new google.auth.JWT(key.client_email, undefined, key.private_key, scopes, undefined);

const syncCalendar = async (): Promise<{
    createCounter: number,
    updateCounter: number,
    removeCounter: number,
}> => {
    let createCounter = 0;
    let updateCounter = 0;
    let removeCounter = 0;

    const config: SourceTargetConfiguration[] = JSON.parse(readFileSync('config.json', 'utf8'));

    for (const configEntry of config) {
        const pastDays = configEntry.pastDays || 7;
        const futureDays = configEntry.futureDays || 14;

        const earliestDate = moment(new Date()).subtract(pastDays, 'days');
        const latestDate = moment(new Date()).add(futureDays, 'days');


        const sourceEventsResponse = await calendar.events.list({
            auth,
            calendarId: configEntry.sourceCalendar,
            timeMin: earliestDate.toISOString(),
            timeMax: latestDate.toISOString(),
        });
        let sourceEvents: calendar_v3.Schema$Event[] = sourceEventsResponse.data.items || [];

        // Do not include events with transparency === transparent as they do not block the time
        sourceEvents = sourceEvents.filter(t => !(t.transparency && t.transparency === 'transparent'));

        const targetEventsResponse = await calendar.events.list({
            auth,
            calendarId: configEntry.targetCalendar,
            timeMin: earliestDate.toISOString(),
            timeMax: latestDate.toISOString(),
        });
        const targetEvents = targetEventsResponse.data.items;

        let eventsToRemove = targetEvents?.filter(t => t.description?.includes(`google-sync-calendar-config-id: ${configEntry.id}`)) || [];

        for (const sourceEvent of sourceEvents) {
            const sourceEventId = sourceEvent.id || sourceEvent.iCalUID;
            if (!sourceEventId) {
                console.warn(`Skipping event ${sourceEvent.summary} because no id is available`);
                continue;
            }

            if (sourceEvent.status === 'cancelled') {
                // Will be removed later, if it was synced before
                continue;
            }

            const targetEvent = targetEvents.filter(t => t.description?.includes(`google-sync-calender-source-id: ${sourceEventId}`))[0];
            if (!targetEvent) {
                try {
                    await createEvent(sourceEvent, sourceEventId, configEntry);
                    createCounter++;
                } catch (e) {
                    console.error('Error while creating event', e);
                }
                continue;
            }

            // Event still exists -> Should not be removed
            eventsToRemove = eventsToRemove.filter(t => t.description !== targetEvent.description);

            if (areEventsEqual(sourceEvent, targetEvent)) {
                // Nothing to do
                continue;
            }

            // Something got changed
            try {
                await updateEvent(sourceEvent, sourceEventId, targetEvent, configEntry);
                updateCounter++;
            } catch (e) {
                console.error('Error while updating event', e);
            }
        }

        // Remove events which no longer exist in source
        for (const eventToRemove of eventsToRemove) {
            try {
                await calendar.events.delete({
                    auth,
                    calendarId: configEntry.targetCalendar,
                    eventId: eventToRemove.id || eventToRemove.iCalUID,
                });
                removeCounter++;
            } catch (e) {
                console.error('Error while deleting event', e);
            }
        }
    }

    return {
        createCounter,
        updateCounter,
        removeCounter,
    };
}

const areEventsEqual = (a: calendar_v3.Schema$Event, b: calendar_v3.Schema$Event): boolean => {
    return  (a.start?.date === b.start?.date && a.start?.dateTime === b.start?.dateTime && a.start?.timeZone === b.start?.timeZone) &&
            (a.end?.date === b.end?.date && a.end?.dateTime === b.end?.dateTime && a.end?.timeZone === b.end?.timeZone);
}

const createEvent = async (sourceEvent: calendar_v3.Schema$Event, sourceEventId: string, configEntry: SourceTargetConfiguration): Promise<void> => {
    await calendar.events.insert({
        auth,
        calendarId: configEntry.targetCalendar,
        requestBody: getRequestBody(sourceEvent, sourceEventId, configEntry),
    });
}

const updateEvent = async (sourceEvent: calendar_v3.Schema$Event, sourceEventId: string, targetEvent: calendar_v3.Schema$Event,  configEntry: SourceTargetConfiguration): Promise<void> => {
    await calendar.events.update({
        auth,
        calendarId: configEntry.targetCalendar,
        eventId: targetEvent.id || targetEvent.iCalUID,
        requestBody: getRequestBody(sourceEvent, sourceEventId, configEntry),
    });
}

const getRequestBody = (sourceEvent: calendar_v3.Schema$Event, sourceEventId: string, configEntry: SourceTargetConfiguration): calendar_v3.Schema$Event => {
    return {
        summary: 'Private event',
            description: `This is a private event synced by google-calendar-sync.
            
Do not update/remove this event manually - changes will be overwritten!
            
google-sync-calender-source-id: ${sourceEventId}
google-sync-calendar-config-id: ${configEntry.id}
`,
        start: sourceEvent.start,
        end: sourceEvent.end,
    }
}

syncCalendar().then((res) => {
    console.log(`Everything synced (${res.createCounter} created, ${res.updateCounter} updated, ${res.removeCounter} removed)`);
});
