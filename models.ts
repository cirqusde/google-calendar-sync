export interface SourceTargetConfiguration {
    id: string;
    sourceCalendar: string;
    targetCalendar: string;
    futureDays?: number;
    pastDays?: number;
}
