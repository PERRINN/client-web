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
2. `dbMessagesOnCreate` invokes `verifyMessage` for each created message. Verification may link user timeline messages, resolve profile/image data, update the latest message for a chat, normalize financial and membership subobjects, and set `verified` plus `verifiedTimestamp`. New backend messages created by `createMessageAFS` have `isBackendMessage: true`; verification retains an explicit `true` and otherwise writes `false` on the newly processed record. This classification is not inherited from preceding messages. The existing “(Backend message)” suffix is retained. No historical records are backfilled, and no Firebase access rules change. The classification is a presentation field, not an authorization or trusted-origin guarantee; the existing rules do not restrict client values for it.
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

- `firestore.indexes.json` tracks all required composite indexes for the current client and Functions, including the backend-message sidebar query. See the [Firestore index audit](#firestore-index-audit) for query coverage, cleanup decisions, the original live export, and the maintenance workflow. Deploy required additions and wait for readiness before releasing dependent queries.
- Home at `/home` listens to verified image messages, current event messages, and the latest eleven `userPresence` documents ordered by `lastActiveAt` descending, regardless of age. It excludes the real Firebase Auth user and displays up to ten others; signed-out visitors see the latest ten users. The list reacts to sign-in, sign-out and account changes. Profile queries are bounded to those ten users; missing/unavailable profiles use a neutral fallback. Chat read cursors remain independent.
- Production Home uses `HomeFeedService`: the image query reads at most 50 verified messages ordered by `chatImageTimestamp` and displays up to 25 with image URLs. Event queries retain the existing `lastMessage`, `verified` and future `eventDateEnd` filters, using live pages of 50 with document cursors until exhausted. Home sorts the results by start time and displays the first four still-current events, preserving the original Home selection across page boundaries. Leaving Home unsubscribes from its feed and presence listeners. These are read-only queries; persisted fields, rules and indexes are unchanged.
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

The sidebar profile publishes the dot state of its currently loaded conversation rows to `MessageActivityService`. The summary and Home’s mentioned-chat list perform no additional Firebase queries. Home shows the three newest distinct loaded chats whose latest message has an unread name match, with the message preview and propagated chat profile image. Missing or failed chat images use a title initial. The panel is hidden when signed out, shows a compact, muted “You're all caught up.” line when the loaded chats have no unread mentions, and shows loading or unavailable states while account/profile/cursor state is pending or on conversation/cursor errors. Opening a row uses the existing chat route and read-cursor behavior. “Load more” expands its scope; conversations outside the loaded list do not contribute. Cursor, profile and authentication changes recalculate the summary using the same conditions as the row template.

`SidebarConversationsService` retains unflagged legacy records and excludes only latest messages with `isBackendMessage === true` from the main sidebar. It traverses live pages of 30 verified latest messages ordered by descending `serverTimestamp`, using document cursors until it fills the requested human-chat count (initially 30, increasing by 15 on Load more) or exhausts the query. Each page is bounded; total reads depend on the number of intervening automatic records. Page boundary changes replace downstream subscriptions, and destroying the sidebar unsubscribes all pages. Filtering happens before read-cursor listeners are attached. `MessageActivityService` also excludes flagged backend records defensively, including manual flags. Existing profile feeds and full chat history retain their previous behavior.

Automatic updates use a separate live query for verified latest messages with `isBackendMessage == true`, descending `serverTimestamp`, limited to 15. The sidebar reserves a fixed 192px space for exactly three 64px rows before independent scrolling, including when fewer results exist or the query is loading, empty or unavailable. It has no visible heading or loading/empty/error text; its accessible region label and loading state remain available to assistive technology. Query states are independent of human activity tracking. Each chat belongs to the list selected by its latest message; a human reply moves it back to the main list. Existing unflagged backend messages stay in the main list until a newly flagged message becomes the latest. The query has no additional read-cursor listeners and contributes no activity dots or Home mentions. The new Functions and index must be deployed before the client; this change does not deploy or backfill anything.

The PERRINN desktop/mobile navigation shows only the highest-priority unread dot: red for a latest-message name match, otherwise green for an unread latest message addressed to the user, otherwise grey for other unread activity. Gold independently indicates a manually flagged loaded conversation. Reading the final conversation in a category removes that summary dot or reveals the next priority. Signed-out users see no dots. No persisted data or rules change is required.

`ReadCursorService` creates a cursor session per profile and for the open chat. The chat header provides a subtle flag toggle beside the subject, replacing the conversation-list flag menu. It merges the existing `blueFlag` and `updatedAt` fields into the current user’s cursor document, preserving read position; the sidebar continues to show flagged conversations. Sessions reuse document listeners for loaded chains, add listeners on “Load more,” and remove listeners for departed chains. Account changes replace all listeners; component destruction unsubscribes them. Missing documents mean no read cursor or flag. Pending reads suppress dot calculations; failures remain unavailable rather than being treated as missing cursors. No cursor collection query is used.

## Firestore index audit

The 2026-10-13 audit exported all 65 live composite indexes from `perrinn-d5fc1` (default database), inspected the client and Functions at commit `f21536e`, and checked 23 distinct query shapes across 40 source call sites with Firestore Query Explain. All 23 planned successfully and returned zero documents. The user confirmed that there are no older clients and authorized cleaning up unused indexes.

[firestore.indexes.json](firestore.indexes.json) now declares the **18 retained composite indexes**. The **47 removed definitions** comprise 45 that contain fields absent from current query filters/orderings and two alternatives not selected by the planner. The authorized cleanup was deployed to production on 2026-10-13: all 47 obsolete indexes were deleted, a fresh live export exactly matched the 18 retained definitions, and all 23 query shapes planned successfully again after deletion. Rules, stored records, field overrides, and Functions implementation are unchanged.

The full original export is preserved in [audits/firestore-indexes-2026-10-13.json](audits/firestore-indexes-2026-10-13.json), including density and document-name ordering. The [query inventory and planner responses](audits/firestore-query-plans-2026-10-13.json) retain reproducible evidence without user data. Audit IDs below refer to the original export's order; they are not Firestore resource IDs.

The audit used planning-only `documents:runQuery` requests with `explainOptions.analyze: false`, synthetic identifiers, and the source queries' filter operators and ordering. Limits were set to one for planning; source limits and cursors do not change the index shape. These requests do not execute the query or retrieve its documents. See [Firebase Query Explain](https://firebase.google.com/docs/firestore/query-explain). This verifies index coverage, not rules authorization or end-to-end UI behavior. It covers queries in this repository; external tools are outside the source audit.

Firestore combines I35 + I42 for Q11 and I53 + I55 for Q16. Both members of each pair are retained. Single-field indexes also satisfy five shapes and remain under Firestore's default automatic indexing.

### Current query coverage

Filters below show operators; parameter values remain in the evidence JSON. All queries use `PERRINNMessages` except Q23 (`userPresence`).

| Query | Filters | Ordering | Selected composite indexes | Source call sites |
| --- | --- | --- | --- | --- |
| Q01 | `chain ==`, `lastMessage ==` | None | Automatic single-field | [functions/utils/verifyMessage.js:116](functions/utils/verifyMessage.js) |
| Q02 | `chain ==` | `chatImageTimestamp` DESC | I01 | [src/app/chat.component.ts:452](src/app/chat.component.ts) |
| Q03 | `chain ==` | `serverTimestamp` DESC | I02 | [src/app/chat.component.ts:393](src/app/chat.component.ts) |
| Q04 | `chatImageTimestamp ==` | None | Automatic single-field | [functions/storageOnFinalise.f.js:18](functions/storageOnFinalise.f.js) |
| Q05 | `chatProfileImageTimestamp ==` | None | Automatic single-field | [functions/storageOnFinalise.f.js:19](functions/storageOnFinalise.f.js) |
| Q06 | `eventDateEnd >`, `lastMessage ==`, `recipientList array-contains-any`, `verified ==` | `eventDateEnd` ASC | I44 | [src/app/profile.component.ts:299](src/app/profile.component.ts) |
| Q07 | `eventDateEnd >`, `lastMessage ==`, `verified ==` | `eventDateEnd` ASC | I30 | [src/app/homeFeed.service.ts:54](src/app/homeFeed.service.ts)<br>[src/app/profile.component.ts:229](src/app/profile.component.ts) |
| Q08 | `fund.active ==`, `lastMessage ==`, `recipientList array-contains-any`, `verified ==` | `fund.daysLeft` ASC | I41 | [src/app/profile.component.ts:308](src/app/profile.component.ts) |
| Q09 | `fund.active ==`, `lastMessage ==`, `verified ==` | `fund.daysLeft` ASC | I18 | [src/app/profile.component.ts:237](src/app/profile.component.ts) |
| Q10 | `isBackendMessage ==`, `lastMessage ==`, `verified ==` | `serverTimestamp` DESC | I33 | [src/app/sidebarConversations.service.ts:19](src/app/sidebarConversations.service.ts) |
| Q11 | `lastMessage ==`, `recipientList array-contains-any`, `verified ==` | `serverTimestamp` DESC | I35 + I42 | [src/app/profile.component.ts:327](src/app/profile.component.ts) |
| Q12 | `lastMessage ==`, `verified ==` | `fund.daysLeft` DESC | I32 | [src/app/buy-prn.component.ts:321](src/app/buy-prn.component.ts) |
| Q13 | `lastMessage ==`, `verified ==` | `serverTimestamp` DESC | I35 | [src/app/profile.component.ts:254](src/app/profile.component.ts)<br>[src/app/sidebarConversations.service.ts:38](src/app/sidebarConversations.service.ts) |
| Q14 | `nameLowerCase <=`, `nameLowerCase >=`, `userChain.nextMessage ==`, `verified ==` | `nameLowerCase` ASC | I57 | [src/app/chat.component.ts:965](src/app/chat.component.ts) |
| Q15 | `recipientList array-contains-any`, `verified ==` | `chatImageTimestamp` DESC | I47 | [src/app/profile.component.ts:319](src/app/profile.component.ts) |
| Q16 | `user ==`, `userChain.newMonth ==`, `verified ==` | `serverTimestamp` DESC | I53 + I55 | [src/app/profile.component.ts:275](src/app/profile.component.ts) |
| Q17 | `user ==`, `userChain.nextMessage ==`, `verified ==` | `serverTimestamp` DESC | I54 | [functions/utils/verifyMessage.js:43](functions/utils/verifyMessage.js) |
| Q18 | `user ==`, `verified ==` | `serverTimestamp` DESC | I55 | [src/app/buy-prn.component.ts:257](src/app/buy-prn.component.ts)<br>[src/app/presence.service.ts:103](src/app/presence.service.ts)<br>[src/app/profile.component.ts:172](src/app/profile.component.ts)<br>[src/app/profile.component.ts:286](src/app/profile.component.ts)<br>[src/app/settings.component.ts:45](src/app/settings.component.ts)<br>[src/app/userInterface.service.ts:91](src/app/userInterface.service.ts)<br>[src/app/userInterface.service.ts:115](src/app/userInterface.service.ts)<br>[src/app/userInterface.service.ts:127](src/app/userInterface.service.ts)<br>[functions/scheduledDailyMembership.f.js:61](functions/scheduledDailyMembership.f.js)<br>[functions/utils/verifyMessage.js:17](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:29](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:155](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:189](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:201](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:355](functions/utils/verifyMessage.js) |
| Q19 | `user ==` | `serverTimestamp` DESC | I50 | [functions/scheduledDailyMembership.f.js:33](functions/scheduledDailyMembership.f.js) |
| Q20 | `userChain.nextMessage ==`, `verified ==`, `wallet.balance >` | `wallet.balance` DESC | I59 | [src/app/directory.component.ts:68](src/app/directory.component.ts) |
| Q21 | `userImageTimestamp ==` | None | Automatic single-field | [functions/storageOnFinalise.f.js:17](functions/storageOnFinalise.f.js) |
| Q22 | `verified ==` | `chatImageTimestamp` DESC | I62 | [src/app/homeFeed.service.ts:30](src/app/homeFeed.service.ts)<br>[src/app/profile.component.ts:247](src/app/profile.component.ts) |
| Q23 | None | `lastActiveAt` DESC | Automatic single-field | [src/app/presence.service.ts:78](src/app/presence.service.ts) |

### Original index inventory and cleanup decisions

All indexes have collection scope. Fields appear in index order; implicit `__name__` ordering is omitted from this table but preserved in the JSON files. “Remove” means omitted from the desired deployment configuration, not already deleted in production.

| Audit ID | Collection | Indexed fields | Decision and evidence |
| --- | --- | --- | --- |
| I01 | `PERRINNMessages` | `chain` ASC, `chatImageTimestamp` DESC | Keep: selected by Q02 |
| I02 | `PERRINNMessages` | `chain` ASC, `serverTimestamp` DESC | Keep: selected by Q03 |
| I03 | `PERRINNMessages` | `channel` ASC, `lastMessage` ASC, `verified` ASC, `eventDate` ASC | Remove: no current query uses `channel`, `eventDate` |
| I04 | `PERRINNMessages` | `channel` ASC, `lastMessage` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `channel` |
| I05 | `PERRINNMessages` | `channel` ASC, `lastMessage` ASC, `verified` ASC, `survey.expiryTimestamp` ASC | Remove: no current query uses `channel`, `survey.expiryTimestamp` |
| I06 | `PERRINNMessages` | `channelLastMessage` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `channelLastMessage` |
| I07 | `PERRINNMessages` | `domain` ASC, `lastMessage` ASC, `serverTimestamp` DESC | Remove: no current query uses `domain` |
| I08 | `PERRINNMessages` | `domain` ASC, `lastMessage` ASC, `timestamp` DESC | Remove: no current query uses `domain`, `timestamp` |
| I09 | `PERRINNMessages` | `domain` ASC, `pin` ASC, `serverTimestamp` DESC | Remove: no current query uses `domain`, `pin` |
| I10 | `PERRINNMessages` | `domain` ASC, `pin` ASC, `timestamp` DESC | Remove: no current query uses `domain`, `pin`, `timestamp` |
| I11 | `PERRINNMessages` | `domain` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `domain` |
| I12 | `PERRINNMessages` | `emailNotificationsStatus` ASC, `lastMessage` ASC, `verified` ASC, `createdTimestamp` ASC | Remove: no current query uses `emailNotificationsStatus`, `createdTimestamp` |
| I13 | `PERRINNMessages` | `emailNotificationsStatus` ASC, `lastMessage` ASC, `verified` ASC, `serverTimestamp.seconds` ASC | Remove: no current query uses `emailNotificationsStatus`, `serverTimestamp.seconds` |
| I14 | `PERRINNMessages` | `emailNotificationsStatus` ASC, `lastMessage` ASC, `verified` ASC, `verifiedTimestamp` ASC | Remove: no current query uses `emailNotificationsStatus`, `verifiedTimestamp` |
| I15 | `PERRINNMessages` | `emailNotificationsStatus` ASC, `lastMessage` ASC, `verified` ASC, `verifiedTimestamp.seconds` ASC | Remove: no current query uses `emailNotificationsStatus`, `verifiedTimestamp.seconds` |
| I16 | `PERRINNMessages` | `fund.active` ASC, `lastMessage` ASC, `tag` ASC, `verified` ASC, `fund.daysLeft` ASC | Remove: no current query uses `tag` |
| I17 | `PERRINNMessages` | `fund.active` ASC, `lastMessage` ASC, `verified` ASC, `fund.amountGBPTarget` DESC | Remove: no current query uses `fund.amountGBPTarget` |
| I18 | `PERRINNMessages` | `fund.active` ASC, `lastMessage` ASC, `verified` ASC, `fund.daysLeft` ASC | Keep: selected by Q09 |
| I19 | `PERRINNMessages` | `lastMessage` ASC, `emailNotifications` ASC | Remove: no current query uses `emailNotifications` |
| I20 | `PERRINNMessages` | `lastMessage` ASC, `PERRINN.emailNotifications` ASC | Remove: no current query uses `PERRINN.emailNotifications` |
| I21 | `PERRINNMessages` | `lastMessage` ASC, `serverTimestamp` DESC | Remove: unselected alternative to I35 (Q13) |
| I22 | `PERRINNMessages` | `lastMessage` ASC, `tag` ASC, `verified` ASC, `eventDate` ASC | Remove: no current query uses `tag`, `eventDate` |
| I23 | `PERRINNMessages` | `lastMessage` ASC, `tag` ASC, `verified` ASC, `eventDateEnd` ASC | Remove: no current query uses `tag` |
| I24 | `PERRINNMessages` | `lastMessage` ASC, `tag` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `tag` |
| I25 | `PERRINNMessages` | `lastMessage` ASC, `tag` ASC, `verified` ASC, `survey.expiryTimestamp` ASC | Remove: no current query uses `tag`, `survey.expiryTimestamp` |
| I26 | `PERRINNMessages` | `lastMessage` ASC, `tagLastMessage` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `tagLastMessage` |
| I27 | `PERRINNMessages` | `lastMessage` ASC, `tagLastMessage` ASC, `verified` ASC, `tag` ASC | Remove: no current query uses `tagLastMessage`, `tag` |
| I28 | `PERRINNMessages` | `lastMessage` ASC, `timestamp` DESC | Remove: no current query uses `timestamp` |
| I29 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `eventDate` ASC | Remove: no current query uses `eventDate` |
| I30 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `eventDateEnd` ASC | Keep: selected by Q07 |
| I31 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `fund.amountGBPTarget` ASC | Remove: no current query uses `fund.amountGBPTarget` |
| I32 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `fund.daysLeft` DESC | Keep: selected by Q12 |
| I33 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `isBackendMessage` ASC, `serverTimestamp` DESC | Keep: selected by Q10 |
| I34 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `PERRINN.emailNotifications` ASC | Remove: no current query uses `PERRINN.emailNotifications` |
| I35 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `serverTimestamp` DESC | Keep: selected by Q11, Q13 |
| I36 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `survey.createdTimestamp` ASC | Remove: no current query uses `survey.createdTimestamp` |
| I37 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `survey.createdTimestamp.seconds` ASC | Remove: no current query uses `survey.createdTimestamp.seconds` |
| I38 | `PERRINNMessages` | `lastMessage` ASC, `verified` ASC, `survey.expiryTimestamp` ASC | Remove: no current query uses `survey.expiryTimestamp` |
| I39 | `PERRINNMessages` | `recipientList` CONTAINS, `auto` ASC, `serverTimestamp` DESC | Remove: no current query uses `auto` |
| I40 | `PERRINNMessages` | `recipientList` CONTAINS, `auto` ASC, `timestamp` DESC | Remove: no current query uses `auto`, `timestamp` |
| I41 | `PERRINNMessages` | `recipientList` CONTAINS, `fund.active` ASC, `lastMessage` ASC, `verified` ASC, `fund.daysLeft` ASC | Keep: selected by Q08 |
| I42 | `PERRINNMessages` | `recipientList` CONTAINS, `lastMessage` ASC, `serverTimestamp` DESC | Keep: selected by Q11 |
| I43 | `PERRINNMessages` | `recipientList` CONTAINS, `lastMessage` ASC, `verified` ASC, `eventDate` ASC | Remove: no current query uses `eventDate` |
| I44 | `PERRINNMessages` | `recipientList` CONTAINS, `lastMessage` ASC, `verified` ASC, `eventDateEnd` ASC | Keep: selected by Q06 |
| I45 | `PERRINNMessages` | `recipientList` CONTAINS, `lastMessage` ASC, `verified` ASC, `survey.expiryTimestamp` ASC | Remove: no current query uses `survey.expiryTimestamp` |
| I46 | `PERRINNMessages` | `recipientList` CONTAINS, `timestamp` DESC | Remove: no current query uses `timestamp` |
| I47 | `PERRINNMessages` | `recipientList` CONTAINS, `verified` ASC, `chatImageTimestamp` DESC | Keep: selected by Q15 |
| I48 | `PERRINNMessages` | `statistics.PRN.verified` ASC, `user` ASC, `verified` ASC, `serverTimestamp` DESC | Remove: no current query uses `statistics.PRN.verified` |
| I49 | `PERRINNMessages` | `tag` ASC, `verified` ASC, `chatImageTimestamp` DESC | Remove: no current query uses `tag` |
| I50 | `PERRINNMessages` | `user` ASC, `serverTimestamp` DESC | Keep: selected by Q19 |
| I51 | `PERRINNMessages` | `user` ASC, `timestamp` DESC | Remove: no current query uses `timestamp` |
| I52 | `PERRINNMessages` | `user` ASC, `userChain.newDay` ASC, `serverTimestamp` DESC | Remove: no current query uses `userChain.newDay` |
| I53 | `PERRINNMessages` | `user` ASC, `userChain.newMonth` ASC, `serverTimestamp` DESC | Keep: selected by Q16 |
| I54 | `PERRINNMessages` | `user` ASC, `userChain.nextMessage` ASC, `verified` ASC, `serverTimestamp` DESC | Keep: selected by Q17 |
| I55 | `PERRINNMessages` | `user` ASC, `verified` ASC, `serverTimestamp` DESC | Keep: selected by Q16, Q18 |
| I56 | `PERRINNMessages` | `userChain.nextMessage` ASC, `verified` ASC, `name` ASC | Remove: no current query uses `name` |
| I57 | `PERRINNMessages` | `userChain.nextMessage` ASC, `verified` ASC, `nameLowerCase` ASC | Keep: selected by Q14 |
| I58 | `PERRINNMessages` | `userChain.nextMessage` ASC, `verified` ASC, `searchName` ASC | Remove: no current query uses `searchName` |
| I59 | `PERRINNMessages` | `userChain.nextMessage` ASC, `verified` ASC, `wallet.balance` DESC | Keep: selected by Q20 |
| I60 | `PERRINNMessages` | `userChain.nextMessage` ASC, `verified` ASC, `wallet.shareBalance` DESC | Remove: no current query uses `wallet.shareBalance` |
| I61 | `PERRINNMessages` | `userChain.nextMessage` ASC, `wallet.balance` DESC | Remove: unselected alternative to I59 (Q20) |
| I62 | `PERRINNMessages` | `verified` ASC, `chatImageTimestamp` DESC | Keep: selected by Q22 |
| I63 | `PERRINNTeams` | `isUser` ASC, `lastMessageBalance` ASC | Remove: no current query uses `isUser`, `lastMessageBalance` |
| I64 | `PERRINNTeams` | `isUser` ASC, `lastMessageBalance` DESC | Remove: no current query uses `isUser`, `lastMessageBalance` |
| I65 | `PERRINNTeams` | `isUser` ASC, `searchName` ASC | Remove: no current query uses `isUser`, `searchName` |

### Maintaining indexes

- Treat `firestore.indexes.json` as the desired configuration for every composite index. Update it alongside client or Functions queries and update this coverage map when a query shape changes. Sync any intentional Firebase Console additions back into the file. Firebase documents this workflow in [Managing indexes](https://firebase.google.com/docs/firestore/query-data/indexing).
- Recheck query plans when filters/orderings change. Keep indexes used through index merging as well as direct selections; a missing exact composite match does not prove that a query is unsupported.
- Before deployment, export live indexes and compare them with the desired file. Review additions and deletions explicitly; an index deployment may prompt to delete live definitions absent from the file. The dated audit exports are evidence only and are not deployment configuration.
- Deploy required additions and wait for readiness before releasing dependent queries. Deploy obsolete-index deletions only within an explicitly authorized cleanup/deployment scope. Preserve a live export for recovery; recreating deleted indexes can take time.
