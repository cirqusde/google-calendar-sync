import ical from 'node-ical';
import { EventStatus, EventTransparency, SourceEvent } from './models';

export const parseIcalFile = async (url: string): Promise<SourceEvent[]> => {
    const response = await ical.fromURL(url);
    const events = Object.values(response) as ical.VEvent[];
    return events.map(e => mapIcalEventToSourceEvent(e)).filter(e => e.start && e.end && e.summary);
}

const mapIcalEventToSourceEvent = (event: ical.VEvent): SourceEvent => {
    let status = EventStatus.CONFIRMED;
    if (event.status === 'CANCELLED') {
        status = EventStatus.CANCELLED;
    } else if (event.status === 'TENTATIVE') {
        status = EventStatus.TENTATIVE;
    }

    let transparency: EventTransparency;
    if (event.transparency === 'TRANSPARENT') {
        transparency = EventTransparency.TRANSPARENT;
    } else if (event.transparency === 'OPAQUE') {
        transparency = EventTransparency.OPAQUE;
    }

    return {
        id: event.uid,
        summary: event.summary,
        description: event.description,
        status,
        transparency,
        start: new Date(event.start),
        end: new Date(event.end),
    }
}
