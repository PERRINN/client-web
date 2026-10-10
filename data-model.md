# Data and workflow map

This is a source-based map of the data currently used by the client and Cloud Functions. It is an orientation guide, not a complete schema or a promise that every historical document has the fields listed here. Documents in `PERRINNMessages` are polymorphic and their shape depends on the workflow. Before changing a field or path, search all readers and writers and check the Firebase rules and Functions.

## Main data paths

| Path | Purpose and common fields | Main readers and writers |
| --- | --- | --- |
| `PERRINNMessages/{messageId}` | Shared message/event/profile/member/payment ledger. Common fields include `user`, `chain`, `text`, `serverTimestamp`, `verified`, and `verifiedTimestamp`. Depending on message type, also includes `membership`, `purchaseCOIN`, `transactionIn`/`transactionOut`, `fund`, event fields, recipient data, and image references/URLs. | Client writes through `UserInterfaceService.createMessage`; chat, directory, profile, settings and PRN pages read it. `dbMessagesOnCreate` and `verifyMessage` mark and enrich records. Payment and scheduled Functions can create records through `createMessageAFS`. Image finalization updates image URL fields. |
| `lastSeen/{userId}/chats/{chain}` | Per-user read cursor: `messageId`, `serverTimestamp`, `updatedAt`. | Chat reads and advances the current user's cursor; profile reads cursors to calculate unread state. |
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
- The Home prototype at `/prototypes/home` listens to verified image messages, current event messages, and `lastSeen/*/chats` documents ordered by `updatedAt`. It uses the latest chat read per user as an approximation of recent activity; these records do not represent app visits.
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
