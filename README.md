# PERRINN

PERRINN is a member collaboration app for profiles and member discovery, conversations, account settings, PRN wallet and membership flows, and community information.

## What’s in the app

- **Profiles and directory** for viewing members and finding people.
- **Chat** for conversations and community activity.
- **Account settings** for profile and account details.
- **PRN and membership** pages for wallet-related information, membership, and payment flows.
- **Community information** and links to related resources.

The main client routes are `/profile/:id`, `/directory`, `/chat/:id`, `/settings`, `/login`, and `/buyPRN/:id`. The root route redirects to `/profile/all`.

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

The Functions code in `functions/` handles trusted server-side workflows, including message and payment processing, membership scheduling, storage events, and Drive/GitHub activity integrations. Firebase rules and indexes are maintained at the repository root. Changes to Firestore paths, stored data, rules, or Functions can affect existing client and server workflows, so review the related readers, writers, and access policies together.

Firebase Hosting is configured to serve the production client from `dist/` and rewrite application routes to `index.html`. Production builds enable the service worker; the development build disables it.

For the current Firestore paths, message lifecycle, payment flow, image handling, and rule summary, see [DATA_MODEL.md](DATA_MODEL.md). Treat it as a source map; inspect the referenced code and rules before changing persisted data or authorization.

## Agent and UI guidance

- `AGENTS.md` contains repository-specific instructions for coding agents, including architecture, component size, implementation preferences, and security-sensitive changes.
- `UI_SPEC.md` is the design authority for new and rebuilt components. Read it before building or redesigning a component.
