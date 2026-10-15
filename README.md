# PERRINN

PERRINN is a member collaboration app for profiles and member discovery, conversations, account settings, PRN wallet and membership flows, and community information.

## What’s in the app

- **Profiles and directory** for viewing members and finding people.
- **Chat** for conversations and community activity.
- **Account settings** for profile and account details.
- **PRN and membership** pages for wallet-related information, membership, and payment flows.
- **Community information** and links to related resources.

The main client routes are `/home`, `/profile/:id`, `/directory`, `/apps`, `/chat/:id`, `/settings`, `/login`, and `/buyPRN/:id`. The root route redirects to `/home`. Both desktop and mobile PERRINN brand controls open Home. The home dashboard preserves the home prototype’s shared-image mosaic with full-screen viewing, four upcoming events linking to conversations, and ten recently active users linking to profiles. Touch-device visitors outside standalone mode also see a subtle home-screen tip above the banner; dismissing it hides it for the current tab session. The PERRINN profile banner appears above the headline using the already-loaded profile image; unavailable or failed images are omitted. It adapts to available width without prototype navigation or manual resizing.

Signed-in Home shows a full-width mention list below the headline with up to three unread mentioned chats, chat images, one-line previews and relative times. The panel has no visible heading or chat count and retains an accessible “Mentioned you” label. When there are no unread mentions, the panel shows a compact, muted “You're all caught up.” line. It reuses the sidebar’s loaded conversations and read cursors (initially 30 chats; “Load more” expands the scope), and opens the existing chat route.

The sidebar separates chats according to their latest verified message. Chats with `isBackendMessage: true` appear in a separate list between the main conversation list and account controls: up to 15 chats, in a fixed 192px space for three rows before scrolling. The list has no visible heading or status text and keeps that space when empty, loading or unavailable. They do not contribute to unread dots, manual-flag summaries or Home mentions. Unflagged legacy records stay in the main list; no backfill is performed. Release the updated message creation/verification Functions and the new Firestore composite index before the client. Cloud Functions changes require the explicit explanation and approval described in [AGENTS.md](AGENTS.md).

Home event countdowns show days from 24 hours, hours from three hours, and hours plus minutes below three hours (only minutes below one hour). Days and standalone hours round to the nearest whole number; the detailed countdown rounds up to the next minute. The final minute shows “Starting now”, then “In progress” from the start time. The exact start date and time remain visible above the countdown.

Home also shows a compact event notice above the banner from one hour before an event starts until its scheduled end. It displays the earliest-starting active event and the nearest upcoming event within that hour, with “Starts in …”, “Starting now” in the final minute, and “In progress” from the start. Each notice opens the existing event conversation; joining remains available there from five minutes before the start. Dates and times use the viewer’s local timezone. The notice has no dismissal and disappears when an event ends or its cancellation reaches the verified feed. Events without valid start/end times or a conversation link are omitted from the notice. A local clock refreshes timing while Home is visible and on tab return, without additional Firestore reads. Loading or unavailable event data does not show a notice; the existing events panel retains its loading/error/empty feedback.

All pages, including prototypes, share a conversation sidebar with PERRINN, Directory, Discover and Apps navigation. The sidebar uses a scrollable, single-line conversation list with icons, truncated subjects, unread/flag dots, chat options (Add flag / Remove flag) and Load more. The main profile feed retains its existing presentation. The account area below it shows Login when signed out, or a flat clickable row with avatar, name, PRN balance and membership indicator that opens your profile and wallet. User profile headers show Buy PRN before the PRN balance; Settings remain accessible from your profile page. Below 900px, use the header menu button to open navigation; Escape or the backdrop dismisses it, and page navigation closes it automatically. Prototype pages retain their own preview controls within the shared shell. The main chat interface and existing route URLs are unchanged.

The `/apps` page replaces the Apps popup with a responsive grid linking to Google Drive (when the existing team public link is available), WhatsApp, YouTube, LinkedIn, GitHub and Prototyping. External links open in a new tab; Prototyping opens within the app. The page reads the existing team profile through `UserInterfaceService` and introduces no new persisted data.

## Technology

- Angular 21, TypeScript, and Angular CLI.
- Angular NgModules and the Angular Router.
- AngularFire compatibility APIs with Firebase Authentication, Cloud Firestore, Realtime Database, and Storage.
- Firebase Cloud Functions v2, written in JavaScript and configured for Node.js 20.
- Firebase Hosting, with the production client build output served from `dist/`.

## Get started

Install a Node.js and npm version supported by the Angular CLI and install the workspace dependencies:

```sh
npm install
```

Start the development server:

```sh
npm start
```

The app is served at `http://localhost:4200/`. The development configuration uses `src/environments/environment.dev.ts`.

## Common commands

For safe public network/configuration checks, current findings, the enterprise IT allowlist and CI usage, see [ENTERPRISE_ACCESSIBILITY_AUDIT.md](ENTERPRISE_ACCESSIBILITY_AUDIT.md). Run `npm run audit:enterprise:test` and `npm run audit:enterprise -- --output /tmp/perrinn-enterprise-audit.json`; no credentials or production changes are required.

| Command | Purpose |
| --- | --- |
| `npm start` | Run the Angular development server with the `dev` configuration. |
| `npm run start:prod` | Run the Angular development server with the production configuration. |
| `npm run build` | Create an optimized production build in `dist/`. |
| `npm run lint` | Lint the client TypeScript and HTML files. |

The root `package.json` does not currently define `test` or end-to-end test scripts. The Functions package provides `npm start` for its Firebase Functions shell, `npm run serve` for the Firebase Functions serve command, and `npm run logs` for viewing deployed Functions logs. Firebase emulator ports are configured in `firebase.json`; run `firebase emulators:start` to start the configured emulators when the Firebase CLI and a suitable project configuration are available.

## Configuration and secrets

The client Firebase web app configuration is selected through Angular environment files:

- `src/environments/environment.dev.ts` for local development.
- `src/environments/environment.prod.ts` for production builds.

Browser environment values are included in the client bundle and must be treated as public configuration, not secrets. Do not put service account credentials, payment provider keys, or other privileged values in client files. Cloud Functions read privileged integration credentials through Firebase Functions secrets. Keep those values in the project's approved secret management setup and never add them to this README or source control.

## Project layout

```text
src/
  app/                 Angular app shell, routed pages, services, pipes, and directive
  environments/        Development and production Firebase client configuration
  styles.css           Global styles and design tokens
functions/             Firebase Cloud Functions v2 handlers and utilities
firebase.json          Hosting, Functions, rules, and emulator configuration
firestore.rules        Cloud Firestore security rules
firestore.indexes.json Cloud Firestore indexes
database.rules.json    Realtime Database rules
storage.rules          Firebase Storage security rules
```

The root app component provides the shared navigation and layout. The router renders the page components; on chat routes, the app shell also displays a profile side panel. Most app-wide data and shared behavior are handled by `UserInterfaceService`.

## Firebase backend

The Functions code in `functions/` handles trusted server-side workflows, including message and payment processing, membership scheduling, storage events, and Drive/GitHub activity integrations. Firebase rules and indexes are maintained at the repository root. `firestore.indexes.json` is the desired composite-index configuration; see the [query coverage audit and index maintenance workflow](data-model.md#firestore-index-audit). Changes to Firestore paths, stored data, rules, or Functions can affect existing client and server workflows, so review the related readers, writers, and access policies together.

Firebase Hosting is configured to serve the production client from `dist/` and rewrite application routes to `index.html`. Production builds enable the service worker; the development build disables it.

For the current Firestore paths, message lifecycle, payment flow, image handling, and rule summary, see [data-model.md](data-model.md). Treat it as a source map; inspect the referenced code and rules before changing persisted data or authorization.

## Agent and UI guidance

- `AGENTS.md` contains repository-specific instructions for coding agents, including architecture, component size, implementation preferences, and security-sensitive changes.
- `ui-spec.md` is the design authority for new and rebuilt components. Read it before building or redesigning a component.

The former Home prototype and Layouts gallery category have been retired. Old `/prototypes/home` links return to `/prototypes`. The five mosaic experiments remain available through their existing routes and use a dedicated `ImageMosaicComponent`; production Home at `/home` remains independent.

The `/prototypes/home-mentions` UX prototype explores a full-width “Mentioned you” panel below the Home headline, with up to three chat titles, one-line mention previews and relative times. It uses sample content and local conversation previews, with controls for loading, empty and error states and a keyboard-accessible resize handle. It is listed under Home in the prototype gallery; the preview remains independent of the production Home mention list and never changes persisted mention/read state.

The colour gallery includes `/prototypes/night-signal-dark`, the approved production palette with direct comparison to the original Night Signal study. For CSS ownership and the incremental legacy migration process, see [ui-spec.md](ui-spec.md#styling-ownership-and-migration).


### Unity live link prototype

`/prototypes/unity-live-link` connects directly to `ws://127.0.0.1:42480/live` on this machine; Firebase is not involved. In the Unity project, enter Play Mode and choose **PERRINN → Enable Unity Live Link in Play Mode**, then copy the pairing token from the car's Unity Live Link inspector. Paste it into the page and connect. Start the client with `npm start` (port 4200); Chrome may request local-network access. The hosted HTTPS page must also be tested against Chrome's localhost WebSocket policy before relying on production access.

The prototype records 31 channels and displays 29 analysis charts with session-wide vertical scales (fixed 0–100% for balances). It refreshes the Angular display at 10 Hz. Missing channels remain unavailable. Front spring rate sets both front wheels in N/m; autopilot position offset is in metres. Controls show Unity-confirmed values and command results. Prototype bounds are 10,000–1,000,000 N/m and −10–10 m; these are input guards, not validated vehicle operating limits.

Changes last until the bridge stops, when original settings are restored. Disconnecting the browser does not restore settings. Reconnection reads current parameters and never replays commands; a new Unity session requires its new token. Simulation pause through time scale/vehicle pause allows commands, while the Editor Pause button suspends update handling. Unity now records the full bridge session locally in `Application.persistentDataPath/LiveLink/<timestamp>-<session ID>/`, including data collected before pairing. The folder appears in the inspector and browser. Each session contains `session.json`, `samples.bin` and `changes.jsonl`; normal bridge shutdown flushes the recording and marks it complete. No recordings are uploaded to Firebase. Browser memory retains all samples while this page is open; reconnect catches up from the active Unity session.

Use the full-session speed overview, Full session, Zoom in/out and dragging the selected overview window to inspect history; Follow live returns to the newest 30 seconds. Hover any channel chart for a shared cursor and original-sample time/value readouts across all channels; click a chart to pin the selected sample while scrolling, drag horizontally to move the pinned time, and use Unpin cursor or Escape to return to hover mode. Arrow keys step through samples when a chart is focused. Pinning stops automatic live-window following while recording continues. Capture gaps show no sample and unavailable values remain blank. Connected first/min/max/last sample reduction preserves spikes and flat sections at overview scale. Resolution follows the rendered chart width and display pixel density; only actual nulls and capture gaps break the trace. Gold markers show applied parameter changes, red spans show capture gaps over 100 ms, and null channel values break detailed traces. After stopping Unity, choose its timestamped folder with Open a saved session folder to review every final sample. Those files are parsed locally. The generated 30-minute test (90,000 rows) used about 5.6 MB of binary data and 5.3 MB of browser telemetry buffers. See the Unity project's `Assets/Features/Unity Live Link/README.md` for protocol and build setup.

The Unity Live Link page automatically loads a bundled copy of the completed 22,409-sample driving recording, including all analysis and world-position channels, from `src/assets/unity-live-link/sample/`. It works without Unity or access to local session folders, including from another machine serving the built web app. The same charts, zoom and cursor tools apply; parameter writes stay disabled. Only the machine-specific recording path was replaced in the bundled metadata. Sample assets are fetched when this page opens and included in the existing service-worker asset cache after first use.

Telemetry charts learn each channel’s minimum/maximum from all loaded session samples. Zoom and pan keep this full-session Y range; new live extremes expand it, and a new session resets it. Missing values do not affect the learned range. The overview and cursor dots use the same ranges.

Channel charts form one aligned vertical stack, with a shared elapsed-time axis at the bottom of the sticky session navigation, aligned with the channel plot area and no per-chart time/range captions. Names and values sit to the right on wide screens and above full-width charts on mobile. The overview retains its own time labels. Both views include session-range Y labels and subtle grids. Saved folders and the bundled sample open at full-session duration; live connections start in follow mode. Units appear in the chart headings; axis labels remain readable when the plot resizes. Time grids use round elapsed-second intervals anchored to session zero, with whole-second labels by default and fractional seconds when zoomed in. Tick density adapts to plot width, and grid lines match the labels. Cursor/drag coordinates use the plot area, excluding the Y-label gutter.

Telemetry display precision is learned per channel from its full-session min/max: normally one decimal place, with extra decimals for ranges below one unit. Live/cursor values use this formatter. Y-axis labels normally show whole numbers, adding decimals only when needed to represent small grid steps accurately (for example 0.05 or 0.025). Constant channels use their value magnitude; very small ranges use scientific notation. Zoom does not change precision, and stored data remains untouched. Timestamps retain hundredths of a second to distinguish 50 Hz samples.

Chart Y axes expand the learned session range to rounded bounds and uniform 1/2/2.5/5-based intervals, with at most five labeled levels. Meaningfully bipolar channels are symmetric about zero; mostly positive channels keep an asymmetric useful range, and constant channels receive padding. The zero grid line has subtle extra emphasis. Zoom preserves these session-derived axes. Sample-rate diagnostics are omitted from the page.

The Live Link session navigation area stays visible above scrolling charts and groups an X/Z trajectory map, draggable speed overview and four view controls. Clicking the map pins the nearest recorded sample and brings it into the chart window. At repeated laps, equally close positions prefer the current cursor time. Map geometry preserves world proportions and recording gaps; the dot follows the shared cursor or the latest live sample. The bundled sample includes position channels and displays its recorded trajectory. PositionX/PositionZ are used only by the map; PositionY appears as Altitude in the charts, retaining its original recording index and world elevation in metres. Older recordings without position channels show a placeholder. New Unity captures append world PositionX/PositionY/PositionZ in metres, with Y as elevation; ten-, thirteen- and thirty-one-channel archives are accepted using each binary header’s channel count. Full session remains the initial view for imports. The shell’s content wrappers allow sticky positioning specifically for this prototype.

The expanded Unity Live Link catalogue records 31 channels. The 29 visible charts are ordered as inputs, accelerations, chassis, individual tire vertical loads, axle left-minus-right wheel rpm differences, motor speeds, electrical power and front shares, aero coefficients/balance, then altitude. `chartChannels.ts` owns display names/order and preserves raw recording indices. Power/torque shares use front divided by the signed total in percent, with undefined totals left blank. Aero SCx/SCz are area-weighted coefficients (m²), matching the model. The bundled sample includes all 31 channels. Older archives show only their available recorded channels; a new Unity session is required to capture missing measurements.

Balance display ranges are configured in `chartChannels.ts`: electrical power balance, wheel torque balance and aero balance use fixed 0–100% axes with 25% grid intervals. Other charts keep learned session scales. Out-of-range samples are drawn at the relevant boundary with red ticks pointing outside the plot; the cursor point is also red and held at that edge. Edge marks are collected before trace reduction and bounded to one per pixel bucket per edge, so isolated extremes remain visible at overview scale. Raw history, learned extrema, recordings and numeric cursor readouts retain original values. Nulls and recording gaps keep their existing breaks.

Drag either side of the speed overview’s selected window to resize its time range while keeping the opposite boundary fixed; drag the middle to pan. Small grips identify the edges, with larger invisible hit areas for touch. Resizing clamps to session bounds and a minimum duration of 0.2 seconds (or the available duration for shorter sessions). Pointer capture keeps resizing active beyond the plot until release/cancel. Chart/map/overview pointer interactions suppress browser focus borders; keyboard focus indicators and existing arrow/zoom controls remain available.
