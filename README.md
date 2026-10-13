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
