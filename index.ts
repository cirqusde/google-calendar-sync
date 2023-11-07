#!/usr/bin/node
import { calendar_v3, google } from 'googleapis';
import { JWT } from 'google-auth-library/build/src/auth/jwtclient';
import { readFileSync } from 'fs';
import { EventStatus, EventTransparency, SourceEvent, SourceTargetConfiguration } from './models';
import moment = require('moment');
import { parseIcalFile } from './ical-parser';

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

        let sourceEvents: SourceEvent[];
        if (configEntry.sourceCalendar) {
            sourceEvents = await getGoogleCalendarSourceEvents(configEntry);
        } else if (configEntry.sourceIcalLink) {
            sourceEvents = await parseIcalFile(configEntry.sourceIcalLink);
        } else {
            console.warn(`Either sourceCalendar or sourceIcalLink has to be present for ConfigEntry`);
            continue;
        }

        // Do not include without title (description)
        sourceEvents = sourceEvents.filter(t => t.description);

        // Do not include events that were before earliest date (because ical might include old events)
        sourceEvents = sourceEvents.filter(t => t.start.getTime() > earliestDate.toDate().getTime());

        // Do not include events that were after lates date (because ical might include never events)
        sourceEvents = sourceEvents.filter(t => t.start.getTime() < latestDate.toDate().getTime());

        // Do not include events with transparency === transparent as they do not block the time
        sourceEvents = sourceEvents.filter(t => !(t.transparency && t.transparency === EventTransparency.TRANSPARENT));

        const targetEventsResponse = await calendar.events.list({
            auth,
            calendarId: configEntry.targetCalendar,
            timeMin: earliestDate.toISOString(),
            timeMax: latestDate.toISOString(),
            singleEvents: true,
        });
        const targetEvents = targetEventsResponse.data.items;

        let eventsToRemove = targetEvents?.filter(t => t.description?.includes(`google-sync-calendar-config-id: ${configEntry.id}`)) || [];

        for (const sourceEvent of sourceEvents) {
            const sourceEventId = sourceEvent.id;
            if (!sourceEventId) {
                console.warn(`Skipping event ${sourceEvent.summary} because no id is available`);
                continue;
            }

            if (sourceEvent.status === EventStatus.CANCELLED) {
                // Will be removed later, if it was synced before
                continue;
            }

            const targetEvent = targetEvents.filter(t => t.description?.includes(`google-sync-calender-source-id: ${sourceEventId}`))[0];
            if (!targetEvent) {
                try {
                    await createEvent(sourceEvent, configEntry);
                    createCounter++;
                } catch (e) {
                    console.error('Error while creating event', e);
                }
                continue;
            }

            // Event still exists -> Should not be removed
            eventsToRemove = eventsToRemove.filter(t => t.description !== targetEvent.description);

            if (areEventsEqual(sourceEvent, mapGoogleEventToSourceEvent(targetEvent))) {
                // Nothing to do
                continue;
            }

            // Something got changed
            try {
                await updateEvent(sourceEvent, targetEvent, configEntry);
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

const areEventsEqual = (a: SourceEvent, b: SourceEvent): boolean => {
    return  (a.start.getTime() === b.start.getTime()) &&
            (a.end.getTime() === b.end.getTime());
}

const createEvent = async (sourceEvent: SourceEvent, configEntry: SourceTargetConfiguration): Promise<void> => {
    await calendar.events.insert({
        auth,
        calendarId: configEntry.targetCalendar,
        requestBody: getRequestBody(sourceEvent, configEntry),
    });
}

const updateEvent = async (sourceEvent: SourceEvent, targetEvent: calendar_v3.Schema$Event,  configEntry: SourceTargetConfiguration): Promise<void> => {
    await calendar.events.update({
        auth,
        calendarId: configEntry.targetCalendar,
        eventId: targetEvent.id || targetEvent.iCalUID,
        requestBody: getRequestBody(sourceEvent, configEntry),
    });
}

const getRequestBody = (sourceEvent: SourceEvent, configEntry: SourceTargetConfiguration): calendar_v3.Schema$Event => {
    return {
        summary: configEntry.label || 'Private event',
            description: `This is a private event synced by google-calendar-sync.
            
Do not update/remove this event manually - changes will be overwritten!
            
google-sync-calender-source-id: ${sourceEvent.id}
google-sync-calendar-config-id: ${configEntry.id}
`,
        start: {dateTime: sourceEvent.start.toISOString()},
        end: {dateTime: sourceEvent.end.toISOString()},
    }
}

const mapGoogleEventToSourceEvent = (event: calendar_v3.Schema$Event): SourceEvent => {
    let status = EventStatus.CONFIRMED;
    if (event.status === 'cancelled') {
        status = EventStatus.CANCELLED;
    } else if (event.status === 'tentative') {
        status = EventStatus.TENTATIVE;
    }

    let transparency: EventTransparency;
    if (event.transparency === 'transparent') {
        transparency = EventTransparency.TRANSPARENT;
    } else if (event.transparency === 'opaque') {
        transparency = EventTransparency.OPAQUE;
    }

    return {
        id: event.id || event.iCalUID,
        status,
        summary: event.summary,
        description: event.description,
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime),
        transparency,
    }
}

const getGoogleCalendarSourceEvents = async (configEntry: SourceTargetConfiguration): Promise<SourceEvent[]> => {
    const pastDays = configEntry.pastDays || 7;
    const futureDays = configEntry.futureDays || 14;

    const earliestDate = moment(new Date()).subtract(pastDays, 'days');
    const latestDate = moment(new Date()).add(futureDays, 'days');

    const sourceEventsResponse = await calendar.events.list({
        auth,
        calendarId: configEntry.sourceCalendar,
        timeMin: earliestDate.toISOString(),
        timeMax: latestDate.toISOString(),
        singleEvents: true,
    });
    const googleEvents: calendar_v3.Schema$Event[] = sourceEventsResponse.data.items || [];
    return googleEvents.map(e => mapGoogleEventToSourceEvent(e));
}

syncCalendar().then((res) => {
    console.log(`Everything synced (${res.createCounter} created, ${res.updateCounter} updated, ${res.removeCounter} removed)`);
});
