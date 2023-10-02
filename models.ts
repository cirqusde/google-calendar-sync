export interface SourceTargetConfiguration {
    id: string;
    sourceCalendar?: string;
    sourceIcalLink?: string;
    targetCalendar: string;
    futureDays?: number;
    pastDays?: number;
    label?: string;
}

export interface SourceEvent {
    id: string;
    status: EventStatus;
    transparency?: EventTransparency;
    summary: string;
    start: Date;
    end: Date;
}

export enum EventStatus {
    CANCELLED = 'cancelled',
    CONFIRMED = 'confirmed',
    TENTATIVE = 'tentative',
}

export enum EventTransparency {
    TRANSPARENT = 'transparent',
    OPAQUE = 'opaque',
}
