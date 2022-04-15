# google-calendar-sync
[![npm version](https://badge.fury.io/js/@cirqusde%2Fgoogle-calendar-sync.svg)](https://www.npmjs.com/package/@cirqusde/google-calendar-sync)

Sync your private google calendar with your work google calendar.  
Details of the event will be left out - it will only be visible as 'Private event' in your work calendar.


## Setup
- Create a google cloud project (https://console.cloud.google.com/)
- Create a service account (https://console.cloud.google.com/iam-admin/serviceaccounts/create)
- Download a key for the service account (as JSON) and place it in `google_calendar_key.json`
- Create a file `config.json` and add the source and target calendar adresses
  - Add the email of your service account (`client_email` within your downloaded key) to both the source and target calendar
    - For the source calendar, read-only access is sufficient
    - For the target calendar, write access is required (your administrator might have to enable this in the Google Admin console)
  - Add a unique id to each source-target combination (this is used when multiple sources sync into the same target)
  - `futureDays` defaults to `14`, `pastDays` to `7`.
  - Example config:
  ```json
  [
    {
    "id": "sync-id-1",
    "sourceCalendar": "simon@gmail.com",
    "targetCalendar": "simon@cirqus.de",
    "futureDays": 180,
    "pastDays": 14
    }
  ]
  ```
- Run it with `npx -y @cirqusde/google-calendar-sync` (or even better: Add a cronjob to run it repeatedly)

## Publish to npm
- Bump version in `package.json`
- Run `npm install`
- Run `npm publish --access public`
