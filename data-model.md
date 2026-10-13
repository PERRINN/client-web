# Data and workflow map

This is a source-based map of the data currently used by the client and Cloud Functions. It is an orientation guide, not a complete schema or a promise that every historical document has the fields listed here. Documents in `PERRINNMessages` are polymorphic and their shape depends on the workflow. Before changing a field or path, search all readers and writers and check the Firebase rules and Functions.

## Main data paths

| Path | Purpose and common fields | Main readers and writers |
| --- | --- | --- |
| `PERRINNMessages/{messageId}` | Shared message/event/profile/member/payment ledger. Common fields include `user`, `chain`, `text`, `serverTimestamp`, `verified`, and `verifiedTimestamp`. Depending on message type, also includes `membership`, `purchaseCOIN`, `transactionIn`/`transactionOut`, `fund`, event fields, recipient data, and image references/URLs. | Client writes through `UserInterfaceService.createMessage`; chat, directory, profile, settings and PRN pages read it. `dbMessagesOnCreate` and `verifyMessage` mark and enrich records. Payment and scheduled Functions can create records through `createMessageAFS`. Image finalization updates image URL fields. |
| `userPresence/{userId}` | Public recent app activity: `lastActiveAt` (Firestore server timestamp). One document per authenticated user. | App-wide `PresenceService` writes the current user’s timestamp; Home displays the latest ten other users and resolves only their profiles; profile pages and chat side profiles listen to the focused user’s presence document. |
| `lastSeen/{userId}/chats/{chain}` | Per-user read cursor: `messageId`, `serverTimestamp`, `updatedAt`. | Chat reads and advances the current user's cursor; profile uses per-document listeners only for loaded conversation chains to calculate unread state and flags. |
| `PERRINNTeams/{userId}/payments/{orderId}` | Revolut order/payment tracking. Includes provider/order/reference/user, currency and charge/PRN amounts, normalized `status`, provider payload in `source`, and processing timestamps/flags such as `purchaseMessageCreated`. | PRN page observes a payment doc. `revolutWebhook` and `syncRevolutOrderStatus` write status. `dbTeamPaymentsOnCreate` creates a purchase message once a successful payment is observed. |
| `Images/{imageId}` | Image metadata and generated `imageUrlThumb` / `imageUrlMedium` values. Message records point at images by timestamp-like ID. | `verifyMessage` reads image metadata; `storageOnFinalise` writes resized URLs and patches linked messages. |
| `Integrations/googleDriveActivityState` and `Integrations/githubActivityState` | Scheduler cursors/state for external activity polling. | `driveFolderActivity` and `githubActivity` Functions. |

Cloud Storage uploads currently use `images/...` object names. Chat and account settings upload there; the storage finalization Function derives image metadata and updates Firestore. The client has no Realtime Database reads or writes found in the current source scan; `database.rules.json` is empty, so the database is default-deny unless configured elsewhere.

## Important workflows

### Message creation and verification

1. The client calls `UserInterfaceService.createMessage`, adds the authenticated user, profile defaults, and a server timestamp, then writes to `PERRINNMessages`.
2. `dbMessagesOnCreate` invokes `verifyMessage` for each created message. Verification may link user timeline messages, resolve profile/image data, update the latest message for a chat, normalize financial and membership subobjects, and set `verified` plus `verifiedTimestamp`.
3. Directory, profile, chat, membership and wallet UI query these verified records. Chat uses `chain` plus `serverTimestamp`; profile and membership use the user's latest verified message; directory searches `userChain.nextMessage` and `nameLowerCase`.

Do not assume all message documents are plain chat text. `PERRINNMessages` is also used for user profile snapshots, chat state, events, funds, transactions and PRN purchase credits.

### PRN purchase

1. The PRN page calls the `createRevolutOrder` HTTPS Function and receives an order/checkout URL.
2. The page tracks `PERRINNTeams/{userId}/payments/{orderId}` and periodically requests a status sync through `syncRevolutOrderStatus`.
3. Revolut's `revolutWebhook` also writes payment status to the same payment document.
4. When `dbTeamPaymentsOnCreate` sees a successful transition, it creates a `PERRINNMessages` record with `purchaseCOIN`, then marks the payment with `purchaseMessageCreated`.
5. The message verification path processes that record; the PRN page watches for the verified purchase message before showing completion.

When changing this flow, trace the client, both status writers, the payment trigger, and message verification together. The order document is not the only record involved in a completed credit.

### Images

Client uploads go to Cloud Storage under `images/`. Message fields such as `userImageTimestamp`, `chatImageTimestamp`, and `chatProfileImageTimestamp` associate an upload with a message/profile role. `storageOnFinalise` writes thumbnail/medium URLs into `Images/{imageId}` and patches matching `PERRINNMessages` documents. Keep those identifiers and role-specific URL fields aligned across client and Function code.

## Access policy as currently written

- Firestore has a recursive `allow read;` rule in `firestore.rules`, so reads are currently public across Firestore documents. The narrower `lastSeen` read/write clauses do not override that broad grant. Message creation has a separate owner/timestamp/text-length check; there is no matching client update/delete grant in the shown rules.
- Storage rules allow public reads and authenticated writes to every object.
- Realtime Database rules are empty (default deny).
- Cloud Functions use Admin SDK access, which bypasses client Firestore rules; authorization and validation for their HTTPS endpoints must be evaluated in the Function itself.

These are observations of the checked-in rules, not a recommendation to change access. Treat any rules or authorization change as security-sensitive and review its user impact before implementation.

## Query and maintenance notes

- `firestore.indexes.json` currently declares no composite indexes. Queries in the client and Functions may need indexes created/managed separately; check the Firebase error and deployment process before adding or changing a query.
- Home at `/home` and the Home prototype at `/prototypes/home` listen to verified image messages, current event messages, and the latest eleven `userPresence` documents ordered by `lastActiveAt` descending, regardless of age. It excludes the real Firebase Auth user and displays up to ten others; signed-out visitors see the latest ten users. The list reacts to sign-in, sign-out and account changes. Profile queries are bounded to those ten users; missing/unavailable profiles use a neutral fallback. Chat read cursors remain independent.
- Production Home uses `HomeFeedService`: the image query reads at most 50 verified messages ordered by `chatImageTimestamp` and displays up to 25 with image URLs. Event queries retain the existing `lastMessage`, `verified` and future `eventDateEnd` filters, using live pages of 50 with document cursors until exhausted. Home sorts the results by start time and displays the first four still-current events, preserving the prototype’s selection across page boundaries. Leaving Home unsubscribes from its feed and presence listeners. These are read-only queries; persisted fields, rules and indexes are unchanged.
- `PresenceService` starts in the app shell and follows real Firebase Auth (not prototype login overrides). It writes on authenticated app opening and when visible, with a five-minute per-tab throttle; visibility and reconnect events can also trigger an update after that interval. Hidden/offline tabs skip new updates. Logout stops future updates and retains the last timestamp. This is approximate recent activity, not online/offline status or an audit of explicit sign-ins; a write already queued during a connection loss may complete later.
- Profile “Last active” reads `userPresence/{userId}` directly, with loading, unavailable and no-record states. It does not fall back to chat cursors. The shared minute clock updates relative-time labels without polling Firestore.
- Presence records contain only `lastActiveAt`; UID comes from the document ID. Reads are public under the existing broad read grant. Rules allow only owner creates/updates with the server request timestamp and no extra fields; client deletes are denied. No Functions or message schema changes are needed. Deploy the new Firestore rules before releasing the client. No backfill is performed: users appear on their next authenticated visit. The simple presence ordering uses the default single-field index.
- There is no single typed schema for `PERRINNMessages`; the client uses `any` in several places and Functions mutate records after creation. Search exact field names across `src/app`, `functions`, and the rules before changing message fields.
- `PERRINNTeams/{userId}/payments/{orderId}` is written from multiple server-side paths. Preserve idempotency flags and status transition handling when editing payment processing.

## Source map

- Client routing and page composition: `src/app/app-routing.module.ts`, `src/app/app.module.ts`.
- Visual orientation maps for client wiring, persisted record relationships, and key workflows are available at `/prototypes/app-wiring`, `/prototypes/data-model-map`, and `/prototypes/workflow-map`.
- Shared message creation and current-user/member snapshots: `src/app/userInterface.service.ts`.
- Chat messages and read cursors: `src/app/chat.component.ts`; profile unread state: `src/app/profile.component.ts`.
- Message verification and backend message creation: `functions/dbMessagesOnCreate.f.js`, `functions/utils/verifyMessage.js`, `functions/utils/createMessage.js`.
- Payment UI and server handlers: `src/app/buy-prn.component.ts`, `functions/createRevolutOrder.f.js`, `functions/revolutWebhook.f.js`, `functions/syncRevolutOrderStatus.f.js`, `functions/dbTeamPaymentsOnCreate.f.js`.
- Image processing: `functions/storageOnFinalise.f.js`; applicable access rules: `firestore.rules`, `storage.rules`, `database.rules.json`.
- Function exports and scheduled integrations: `functions/main.js`, `functions/scheduledDailyMembership.f.js`, `functions/driveFolderActivity.f.js`, `functions/githubActivity.f.js`.

### Message activity indicators

The sidebar profile publishes the dot state of its currently loaded conversation rows to `MessageActivityService`. The summary performs no additional Firebase queries. “Load more” expands its scope; conversations outside the loaded list do not contribute. Cursor, profile and authentication changes recalculate the summary using the same conditions as the row template.

The PERRINN desktop/mobile navigation shows only the highest-priority unread dot: red for a latest-message name match, otherwise green for an unread latest message addressed to the user, otherwise grey for other unread activity. Gold independently indicates a manually flagged loaded conversation. Reading the final conversation in a category removes that summary dot or reveals the next priority. Signed-out users see no dots. No persisted data or rules change is required.

`ReadCursorService` creates a cursor session per profile and for the open chat. The chat header provides a subtle flag toggle beside the subject, replacing the conversation-list flag menu. It merges the existing `blueFlag` and `updatedAt` fields into the current user’s cursor document, preserving read position; the sidebar continues to show flagged conversations. Sessions reuse document listeners for loaded chains, add listeners on “Load more,” and remove listeners for departed chains. Account changes replace all listeners; component destruction unsubscribes them. Missing documents mean no read cursor or flag. Pending reads suppress dot calculations; failures remain unavailable rather than being treated as missing cursors. No cursor collection query is used.
