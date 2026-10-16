# Data and workflow map

This is a source-based map of the data currently used by the client and Cloud Functions. It is an orientation guide, not a complete schema or a promise that every historical document has the fields listed here. Documents in `PERRINNMessages` are polymorphic and their shape depends on the workflow. Before changing a field or path, search all readers and writers and check the Firebase rules and Functions.

## Main data paths

| Path | Purpose and common fields | Main readers and writers |
| --- | --- | --- |
| `PERRINNMessages/{messageId}` | Shared message/event/profile/payment ledger. Common fields include `user`, `chain`, `text`, `serverTimestamp`, `verified`, and `verifiedTimestamp`. Depending on message type, also includes `purchaseCOIN`, `transactionIn`/`transactionOut`, `fund`, event fields, recipient data, and image references/URLs. | Client writes through `UserInterfaceService.createMessage`; chat, team, profile, settings and PRN pages read it. `dbMessagesOnCreate` and `verifyMessage` mark and enrich records. Payment and scheduled Functions can create records through `createMessageAFS`. Image finalization updates image URL fields. |
| `userPresence/{userId}` | Public recent app activity: `lastActiveAt` (Firestore server timestamp). One document per authenticated user. | App-wide `PresenceService` writes the current user’s timestamp; Home displays the latest ten other users and resolves only their profiles; profile pages and chat side profiles listen to the focused user’s presence document. |
| `lastSeen/{userId}/chats/{chain}` | Per-user read cursor: `messageId`, `serverTimestamp`, `updatedAt`. | Chat reads and advances the current user's cursor; profile uses per-document listeners only for loaded conversation chains to calculate unread state and flags. |
| `PERRINNTeams/{userId}/payments/{orderId}` | Revolut order/payment tracking. Includes provider/order/reference/user, currency and charge/PRN amounts, normalized `status`, provider payload in `source`, and processing timestamps/flags such as `purchaseMessageCreated`. | PRN page observes a payment doc. `revolutWebhook` and `syncRevolutOrderStatus` write status. `dbTeamPaymentsOnCreate` creates a purchase message once a successful payment is observed. |
| `Images/{imageId}` | Image metadata and generated `imageUrlThumb` / `imageUrlMedium` values. Message records point at images by timestamp-like ID. | `verifyMessage` reads image metadata; `storageOnFinalise` writes resized URLs and patches linked messages. |
| `Integrations/googleDriveActivityState` and `Integrations/githubActivityState` | Scheduler cursors/state for external activity polling. | `driveFolderActivity` and `githubActivity` Functions. |

Cloud Storage uploads currently use `images/...` object names. Chat and account settings upload there; the storage finalization Function derives image metadata and updates Firestore. The client has no Realtime Database reads or writes found in the current source scan; `database.rules.json` is empty, so the database is default-deny unless configured elsewhere.

## Important workflows

### Message creation and verification

1. The client calls `UserInterfaceService.createMessage`, adds the authenticated user, profile defaults, and a server timestamp, then writes to `PERRINNMessages`.
2. `dbMessagesOnCreate` invokes `verifyMessage` for each created message. Verification may link user timeline messages, resolve profile/image data, update the latest message for a chat, normalize financial subobjects, and set `verified` plus `verifiedTimestamp`. New backend messages created by `createMessageAFS` have `isBackendMessage: true`; verification retains an explicit `true` and otherwise writes `false` on the newly processed record. This classification is not inherited from preceding messages. The existing “(Backend message)” suffix is retained. No historical records are backfilled, and no Firebase access rules change. The classification is a presentation field, not an authorization or trusted-origin guarantee; the existing rules do not restrict client values for it.
3. Team, profile, chat and wallet UI query these verified records. Chat uses `chain` plus `serverTimestamp`; profiles use the user's latest verified message; Team queries latest contributor records using `userChain.nextMessage` and `wallet.balance`.

Do not assume all message documents are plain chat text. `PERRINNMessages` is also used for user profile snapshots, chat state, events, funds, transactions and PRN purchase credits.

The Bubbles prototype uses the same chain identity, bounded history query and message creation/upload contract as production chat. It advances the authenticated user’s existing cursor when messages are reached in the visible, focused conversation, using a transaction and merge to preserve manual flags and prevent older updates from moving it backwards. Successful local sends and chat/event actions publish their confirmed message IDs to the open chat’s read session. Once the existing history snapshot resolves their server timestamps, these own messages can advance the cursor even while Chat details hides the conversation, but only in the focused, visible app and without skipping unread incoming messages or a gap outside the loaded history window. Pending timestamps, cursor failures and concurrent writes retain acknowledgements for retry; changing account/chat clears them. Closing an image preview triggers another viewport scan. The unread divider captures an incoming message at entry and stays fixed for the visit; subsequent own actions cannot create it. Its event editor uses the same `eventDescription`, `eventDateStart`/`eventDateEnd` epoch milliseconds, `eventDuration` hours and `eventLocation` fields as production chat. Scheduled event messages include the description, date/time with the author’s local timezone, duration and location. Edit messages include only changed fields and their new values; cancellation messages identify the event by description. Long description/location text is shortened to respect the existing 500-character message limit; event fields retain their full values. Cancellation uses equal start/end values in the past, preserving the existing propagation contract. Dates/times are edited in the viewer’s local timezone; no timezone field is added. Its own-message verification tick reflects the existing `verified` processing field only. See [prototypes.md](prototypes.md) for its live-data behavior.

### PRN Contribution Credits

PRN records and recognises contributions to PERRINN projects. Client copy uses **PRN Contribution Credits**, **PRN Credits** or **PRN**, and calls participants contributors. Contributions may include time, funds, hardware, services or software from individuals and companies. This terminology change covers existing flows; it does not add structured in-kind declarations or credit valuation/approval workflows.

Participation is open and independent of PRN balances or payments. The accounting calculations for `wallet.balance`, `purchaseCOIN`, `transactionIn`/`transactionOut`, `contract`, `interest` and `locking` remain unchanged. `verifyMessage` no longer computes, writes or returns `membership`. Historical membership fields and messages are retained without backfill and ignored by the client. Daily statistics omit `membersCount`; displays use the existing `statistics.userCount`, which counts processed profiles, not all Authentication accounts. The daily wallet refresh retains its deployed `scheduledDailyMembership` export and file name for operational compatibility, but no longer reads thresholds or publishes membership counts. It enumerates all Authentication pages (1,000 users per page), including a single page with no continuation token. Reverification of a historical document does not delete its old fields. No legacy field is used as an access signal.

The Team queries latest verified contributor profiles with `wallet.balance > 0`, ordered by balance descending, in cursor-paginated reads of up to 200 profiles. This is a team filter, not a participation or access requirement. Name-and-bio search filters loaded profiles and preserves the balance-descending order; Load more fetches the next page using the unchanged balance-ordered cursor. Both card and list views open the existing profile route. Each visit starts a fresh snapshot; pages are fetched on demand rather than keeping live subscriptions to every loaded profile. This uses the existing I59 index; no indexes are added or deleted. Funding presets are 10, 25, 50, 100 and 250 in the selected currency, independent of historical thresholds. Existing currency rates convert the selected payment into PRN credits. Authentication, payment metadata, Firebase rules and independent contract approval checks remain unchanged. These backend changes require a Functions deployment; local changes do not update the live scheduled job.

The [Team performance investigation](audits/team-performance-2026-10-16.md) records measurements and validation for issue #83. The tested smaller batch was reverted; the original 200-profile limit remains, and the reported delay's cause is unconfirmed.

Profiles show existing credited hours (`contract.hoursTotal`) and funding-credit provenance (`purchaseCOIN.amountCummulate`) where present. History labels distinguish funding credits, transfers, balance adjustments and time credits; the time agreement/signature mechanism and declaration validation remain unchanged. Historical message text is not rewritten. Public visibility is unchanged; see the access-policy findings below rather than assuming privacy from the contribution-ledger terminology.

The existing `interest` calculation is presented as a balance adjustment. The profile's balance illustration retains the current formula and states that rates may change; it promises no investment return. PRN grants no ownership or profit entitlement; future profit sharing is only a possibility, not a current right or promise. No historical data migration, rule change or index change is required. `/buyPRN/:id`, payment metadata, pending-payment storage and transfer links remain compatible.

### Project funding and PRN credits

1. The PRN page calls the `createRevolutOrder` HTTPS Function and receives an order/checkout URL.
2. The page tracks `PERRINNTeams/{userId}/payments/{orderId}` and periodically requests a status sync through `syncRevolutOrderStatus`.
3. Revolut's `revolutWebhook` also writes payment status to the same payment document.
4. When `dbTeamPaymentsOnCreate` sees a successful transition, it creates a `PERRINNMessages` record with `purchaseCOIN`, then marks the payment with `purchaseMessageCreated`.
5. The message verification path processes that record; the PRN page watches for the verified purchase message before showing completion.

When changing this flow, trace the client, both status writers, the payment trigger, and message verification together. The order document is not the only record involved in a completed credit.

### Chat fund updates

Bubbles uses the existing `PERRINNMessages.fund` contract: client commands contain `description`, `amountGBPTarget` and `daysLeft`. `amountGBPRaised` and derived fields are inherited/enriched by `functions/utils/verifyMessage.js`; the Bubbles editor does not write raised totals. Targets convert from the viewer’s configured currency to GBP using the existing `currencyList.*.toCOIN` rates, with an explicitly labelled GBP fallback if rates are unavailable. An unchanged target preserves its stored GBP value across display-currency rounding.

Cancellation preserves the legacy nonzero marker (`amountGBPTarget: 0.0001`, `daysLeft: 0.1`, description `add a description`) because zero values fall back to prior state in the verifier. Existing fund views and Bubbles hide targets below £0.01; the verifier may still mark this sentinel active. Days remaining reflect the verifier’s recorded `daysLeft`, including its elapsed-days subtraction and rounding on message verification; this client change does not introduce a new deadline or change that calculation. Funds and totals are read from the already-loaded chat snapshot without additional queries. Existing authorization and public-read policy remain unchanged.

### Images

Client uploads go to Cloud Storage under `images/`. Legacy chat and Settings use `ImageUploadService` for transport/progress reporting, preserving their timestamp-prefixed object names and message fields; upload progress is local UI state and is never persisted. Message fields such as `userImageTimestamp`, `chatImageTimestamp`, and `chatProfileImageTimestamp` associate an upload with a message/profile role. `storageOnFinalise` writes thumbnail/medium URLs into `Images/{imageId}` and patches matching `PERRINNMessages` documents. Keep those identifiers and role-specific URL fields aligned across client and Function code.

## Access policy as currently written

- Firestore has a recursive `allow read;` rule in `firestore.rules`, so reads are currently public across Firestore documents. The narrower `lastSeen` read/write clauses do not override that broad grant. Message creation has a separate owner/timestamp/text-length check; there is no matching client update/delete grant in the shown rules.
- Storage rules allow public reads and authenticated writes to every object.
- Realtime Database rules are empty (default deny).
- Cloud Functions use Admin SDK access, which bypasses client Firestore rules; authorization and validation for their HTTPS endpoints must be evaluated in the Function itself.

These are observations of the checked-in rules, not a recommendation to change access. Treat any rules or authorization change as security-sensitive and review its user impact before implementation.

### Proposed least-privilege read policy — 2026-10-15

**Investigation and proposal only. Not implemented or approved for deployment.** No production documents or deployed rules were read during this investigation. Findings below follow the checked-in readers, writers and rules; they establish a source-level exposure, not a confirmed production breach. `firestore.rules`, Functions, application code, indexes and persisted data remain unchanged.

#### Why narrowing the wildcard alone is insufficient

The recursive `allow read;` makes all document reads and queries public, including per-user cursors, provider payment payloads and scheduler state. An overlapping owner rule cannot revoke this permission. The `lastSeen/{userId}/payments/{payment}` clause is also misplaced: real orders live under `PERRINNTeams/{userId}/payments/{orderId}`, and its `team` identifier is not defined. No current client/server reader or writer for the misplaced path was found.

More seriously, public feed documents already mix public content and private account data:

- [verifyMessage.js](functions/utils/verifyMessage.js) lines 82–87 obtains or inherits `emails.auth` and can use it to update the user's Authentication email; line 305 writes `emails` onto the message. This runs for ordinary chat/profile/payment messages, not only account-setting commands. A `verified == true` public-read condition would still disclose the email.
- The same verifier stores `transactionPending.code` and `reference` (lines 181–186), plus financial and contract state. [dbTeamPaymentsOnCreate.f.js](functions/dbTeamPaymentsOnCreate.f.js) writes `source.email` on payment records and writes an order identifier as `purchaseCOIN.chargeID` on the shared ledger. Removing public payment-document access alone does not hide the ledger's copy of that identifier. The verifier also puts a transaction reference into generated message text (around line 324), so deleting nested fields alone is insufficient.
- Settings sends email-change commands through the shared collection and reads `emails.auth` back from the latest user message. Public pages consume many of the same documents. Merely removing an email field would break that private account workflow and the verifier's inherited state unless its readers/writers are migrated together.

Firestore grants reads at document granularity; it cannot redact selected fields. Queries must satisfy the rules for their potential results, rather than relying on client-side filtering. See [field access](https://firebase.google.com/docs/firestore/security/rules-fields), [query rules](https://firebase.google.com/docs/firestore/security/rules-query), and [overlapping matches](https://firebase.google.com/docs/firestore/security/rules-structure#overlapping_match_statements).

#### Compatibility inventory

| Workflow | Current access that must be accounted for | Proposed boundary |
| --- | --- | --- |
| Home images/events/funds and sidebar/automatic updates | Public `PERRINNMessages` queries in `homeFeed.service.ts` and `sidebarConversations.service.ts`; image limit 50, event/fund pages 50, human sidebar pages 30, automatic list 15 | Anonymous access to approved public documents; retain ordering, pagination and live updates |
| Public profile, histories, team and recipient search | `profile.component.ts`, `team.service.ts`, `presence.service.ts` and `chat.component.ts`; latest user records, `userChain`, name, wallet, recipient and event/fund filters | Public projection retains explicitly approved displayed fields and query keys; public wallet/contract fields need the decision below |
| Chat history and image gallery | `chat.component.ts` queries by `chain`, without a `verified` constraint; pagination and read markers use original message IDs | Public history reads sanitized public messages; retain IDs and timestamps. Sender-only pending feedback must be handled separately if needed |
| Shared app configuration | `userInterface.service.ts` reads latest PERRINN profile/admin records while signed out; currency conversion uses admin message fields | Public projection must include approved team profile, currency/rate and aggregate configuration; never expose the entire raw admin snapshot |
| Account state/settings and purchase-credit completion | Latest authenticated user's raw messages in `userInterface.service.ts`, `settings.component.ts`, `buy-prn.component.ts` | Owner-only raw account/message reads constrained by `user == request.auth.uid`; preserve private email and order linkage there |
| Read cursors and flags | Only own `lastSeen/{uid}/chats/{chain}` document listeners/writes in chat and `readCursor.service.ts` | Owner-only access; no recursive grant to arbitrary future subcollections |
| Payment tracking | `buy-prn.component.ts` listens to one known `PERRINNTeams/{uid}/payments/{orderId}` doc | Owner-only document get/listen; deny client list and writes because neither is required by this reader |
| Transaction link `/buyPRN/:id` | Direct raw-message read in `buy-prn.component.ts`, potentially for another author's pending transaction | Must design an authenticated, validated claim/details path before restricting raw reads; document ID knowledge and a client-controlled recipient list are not authorization |
| Image metadata and integration state | `Images/{id}` is read/written by Admin code; `Integrations/*` holds poll cursors. No direct browser access found | Deny all client access; Admin workflows continue through IAM |
| Recent activity | Public `userPresence` list/direct reads; owner writes only `lastActiveAt` | Explicit public reads and existing timestamp-only owner writes; this intentionally keeps recent activity public |

No current collection-group query was found. Client rendering, TypeScript interfaces, hidden settings controls and `recipientList` do not provide a security boundary. The existing recipient list selects and displays conversations; this proposal does not reinterpret it as private-chat membership or make public chats private.

#### Recommended implementation in two independently reviewed stages

**Stage A: narrow collection access without changing feed queries.** Remove the database-wide public grant. Add exact public reads for top-level `PERRINNMessages/{messageId}` and `userPresence/{uid}` only. Retain existing message-create and presence-write behavior for this containment step. Keep owner access to the current `lastSeen` root/chats paths, add owner-only `get` on the real payment path, and deny all other client paths by absence of a grant. Remove the unused misplaced payment clause after checking deployed/other-client compatibility. Do not use recursive public or owner matches that automatically include unknown subcollections.

The essential proposed read clauses are:

```text
PERRINNMessages/{id}:                  public get/list (temporary residual risk)
userPresence/{uid}:                    public get/list
lastSeen/{uid}:                        owner read/write (existing intent)
lastSeen/{uid}/chats/{chain}:          owner read/write
PERRINNTeams/{uid}/payments/{orderId}: owner get only; no client list/write
Images/*, Integrations/*, all others:  no client grant
```

Here “owner” means `request.auth != null && request.auth.uid == uid`, using the authenticated UID and the path, never a request-body `user` value. Document listeners must be tested with the get-only payment rule. Admin SDK processing bypasses these client rules, so this stage requires no Functions/schema change and should preserve current public feed behavior. It closes unnecessary cross-user/payment/state reads, but **does not solve embedded emails or other private values in the message ledger**. Do not describe Stage A as complete least privilege or make its residual exposure permanent. A temporary `verified` predicate is not recommended: chat lacks that filter, and verified documents themselves contain private fields.

**Stage B: separate public feed documents from the private ledger.** Recommended design: retain `PERRINNMessages` as the canonical private workflow ledger and publish a server-produced, explicitly allowlisted public projection. `PublicMessages/{originalMessageId}` is a proposed name, not an established or approved path. Keeping source records private avoids destroying historical ledger/account inputs while public reads move to sanitized documents. This stays within Angular/Firebase and needs no new infrastructure service.

- Only trusted server code publishes or removes public documents. Never spread a raw record into a public object or recursively copy financial objects. Map approved fields individually, including nested fields. Preserve original IDs, `chain`, timestamps, approved profile/media/event/fund fields, `userChain`/recipient query keys, and the approved public financial/configuration values required by existing views.
- Exclude emails, raw provider `source`, order IDs/charge IDs, redemption codes/references, private command payloads and unapproved account state. For generated administrative/payment text, construct a safe public summary; raw `text` and `chatSubject` can themselves contain sensitive references. User-authored public chat remains intentionally public. Do not publish private account commands simply because their text is short or the message is verified.
- Define trusted publication eligibility and a typed public DTO. Current client creation permits extra fields, including `verified` and `isBackendMessage`; neither flag is currently proof of server processing or safe disclosure. A public/private flag supplied by a client must not determine authorization. Tighten workflow submission contracts and prevent clients from assigning server-owned processing/publication/financial result fields before using them as trust signals. Existing command inputs such as `transactionOut` must be distinguished from computed results rather than banned indiscriminately.
- Keep anonymous reads for the new public projection and public presence. Deny client writes to projections. Restrict raw ledger reads to approved private needs, initially the author/owner for account state and credit tracking, with matching `user == auth.uid` query constraints. A recipient does not automatically gain access to an author's complete raw record and email. Resolve transaction-link access separately before cutover.
- Move public readers behind focused service contracts while retaining existing Angular routes and templates' required inputs. Update Home, profile, sidebar, team/search, chat/gallery, presence profile lookup, and shared team/admin configuration reads. Keep Settings/current-user private state and purchase-credit lookup on owner-authorized records. Do not point all `UserInterfaceService` reads at one public collection: it currently serves both public and private purposes.
- Publication must react to source changes after verification, including later image URL patches, daily reverification, latest-chat flips and deletions. A proposed new `publicMessageProjection.f.js` handler plus export in `functions/main.js` could isolate this responsibility; choose the exact mechanism only after backend review. Handle duplicate/out-of-order events by reconciling current authoritative state, remove no-longer-public documents, and never publish unverified raw values between lifecycle steps. Projection lag must not lose latest-chat rows or restore stale versions.
- Backfill only approved safe public fields using idempotent bounded batches, preserving IDs/history. Do not delete raw history to sanitize it. New projection queries need matching indexes, explicit result limits and pagination; existing unbounded event/fund/history queries must be paginated without truncating required results. Compare live/repository indexes before deployment and do not delete old ones until all old readers retire.

This stage changes persisted paths, client contracts and trusted server behavior. AGENTS.md requires approval of the schema/rules change **and a separate concrete explanation/approval of the affected Functions implementation before editing it**. None has been implemented here. Existing verifier, scheduler, payment trigger and storage writers need regression coverage even if a separate publisher leaves their business calculations unchanged. Payment HTTPS handlers must independently authorize identity/ownership and webhook authenticity; Firestore rules do not protect Admin-backed endpoints.

#### Product decisions required before Stage B

1. Keep the current public wallet balances, financial/contract summaries and histories, or deliberately reduce their visibility? **Recommended compatibility baseline:** retain currently displayed summaries only, subject to explicit confirmation; hide emails, provider details, identifiers and redemption secrets. These are nested field decisions, not approval to publish entire financial objects.
2. Are all current chat chains intended to remain public? The current implementation permits public reads; it has no trusted private-chat ACL. Keep that behavior for approved public content. Private chats, including historical access decisions, would be a separate authorized design.
3. What are the intended recipients/expiry/claim rules for pending transaction links? Preserve the supported claim workflow through a separately authorized details/claim contract; do not silently replace it with a broken owner-only raw-document read.

Historical private command text and arbitrary message bodies cannot be perfectly classified from this source inspection. Exact public-history parity cannot be promised until representative records are reviewed securely. Unknown or sensitive types should be withheld from publication pending review, with the public-content preservation criteria agreed before rollout.

#### Validation and rollout gates

No emulator tests or live authorization checks were run for this proposal: there is no changed ruleset or backend implementation to validate. The current root package has no Firestore rules test suite; use synthetic emulator fixtures for the approved implementation, never production customer records. Existing public audit self-tests are not rules authorization tests.

| Test category | Required expected result |
| --- | --- |
| Anonymous public compatibility | Home images/events, team, profile/history, chat/gallery, sidebar/automatic updates, team currency/config and recent activity remain available with pagination and live changes |
| Anonymous private paths | Cursor get/list, payment get/list, integration/image-metadata reads and unknown/subcollection paths denied; in Stage B raw ledger reads denied too |
| Two real auth identities | Each can access own cursors and known payment document; other user's get/list/listen and writes denied, including forged body UID. Payment list stays denied even for owner unless a new use is approved |
| Anonymous and cross-user writes | No cursor/presence/private/projection writes by non-owner; no client payment/projection writes at all. Existing owner timestamp-only presence behavior retained |
| Publication integrity | Client-spoofed processing flags do not publish; private values in nested fields, text and subjects do not appear; unknown fields cannot leak through copying |
| Query compatibility | Full actual query shapes, limits, pagination, missing/legacy fields, direct document reads and document listeners pass as intended. Query denial is not treated as an empty feed |
| Workflow compatibility | Email update and private Settings values, purchase status/idempotency/credit lookup, pending claim workflow, image finalization and daily reverification work against synthetic data |
| Publisher lifecycle | Duplicate/reordered updates, delayed verification, deletes/unpublishing, source changes during backfill, latest-message flips and image updates converge without stale disclosure |

Rollout order after approvals: inspect the currently deployed rules/IAM without data reads; verify other consumers; test Stage A in emulators/staging; review/deploy Stage A on its own. For Stage B, approve the publication/field policy and specific backend plan; deploy/test publisher and safe backfill, build required indexes, switch public readers, verify anonymous/owner/cross-user behavior, then remove public raw-ledger access. The period before final lockdown retains the old email exposure and must be an explicit, short transition. Do not promise zero exposure during that overlap.

Verify deployed rules and query behavior after each authorized release. Plan for stale clients and service-worker caches: they must update or show an explicit upgrade state after raw reads close. IndexedDB may retain previously downloaded records and any earlier public downloads cannot be recalled. A rollback must keep private boundaries closed, using the safe public projection or a compatible safe client; never restore the global wildcard to recover a feed. Historical backfill volume/cost, privacy response, cache cleanup and deployment scheduling need operational approval rather than being executed by this proposal.

## Query and maintenance notes

- `firestore.indexes.json` tracks all required composite indexes for the current client and Functions, including the backend-message sidebar query. See the [Firestore index audit](#firestore-index-audit) for query coverage, cleanup decisions, the original live export, and the maintenance workflow. Deploy required additions and wait for readiness before releasing dependent queries.
- Home at `/home` listens to verified image messages, current event messages, and the latest eleven `userPresence` documents ordered by `lastActiveAt` descending, regardless of age. It excludes the real Firebase Auth user and displays up to ten others; signed-out visitors see the latest ten users. The list reacts to sign-in, sign-out and account changes. Profile queries are bounded to those ten users; missing/unavailable profiles use a neutral fallback. Chat read cursors remain independent.
- Production Home uses `HomeFeedService`: the image query reads at most 50 verified messages ordered by `chatImageTimestamp` and displays up to 25 with image URLs. Event queries retain the existing `lastMessage`, `verified` and future `eventDateEnd` filters, using live pages of 50 with document cursors until exhausted. Home sorts the results by start time and displays the first four still-current events, preserving the original Home selection across page boundaries. Home funds reuse the Q09/I18 active-fund query (`lastMessage == true`, `verified == true`, `fund.active == true`, ordered by `fund.daysLeft` ascending) in bounded live pages of 50. Cancelled sub-penny markers, ended funds and missing conversation links are filtered; cursor pages continue only until enough valid funds are found or the query is exhausted. Home initially displays four funds and loads four more on request, using one additional valid result to determine whether Load more is needed. Rows project only fund display fields and conversation links; currency display uses the same conversion and zero-decimal formatting as Bubbles. Leaving Home unsubscribes from its feed and presence listeners. These are read-only queries; persisted fields, rules and indexes are unchanged.
- `PresenceService` starts in the app shell and follows real Firebase Auth (not prototype login overrides). It writes on authenticated app opening and when visible, with a five-minute per-tab throttle; visibility and reconnect events can also trigger an update after that interval. Hidden/offline tabs skip new updates. Logout stops future updates and retains the last timestamp. This is approximate recent activity, not online/offline status or an audit of explicit sign-ins; a write already queued during a connection loss may complete later.
- Profile activity reads `userPresence/{userId}` directly, with loading, unavailable and no-record states. It does not fall back to chat cursors. Home and profiles share `formatLastSeen`: “Seen today”, “Seen this week”, “Seen this month”, then “Seen longer ago”, in that order. Boundaries use the viewer's local calendar, with weeks starting Monday; a week spanning a month/year boundary takes precedence over the month bucket. Missing/invalid timestamps show “No activity recorded”; future timestamps are treated as today for clock skew. Existing client clocks refresh labels without polling Firestore.
- Presence records contain only `lastActiveAt`; UID comes from the document ID. Reads are public under the existing broad read grant. Rules allow only owner creates/updates with the server request timestamp and no extra fields; client deletes are denied. No Functions or message schema changes are needed. Deploy the new Firestore rules before releasing the client. No backfill is performed: users appear on their next authenticated visit. The simple presence ordering uses the default single-field index.
- There is no single typed schema for `PERRINNMessages`; the client uses `any` in several places and Functions mutate records after creation. Search exact field names across `src/app`, `functions`, and the rules before changing message fields.
- `PERRINNTeams/{userId}/payments/{orderId}` is written from multiple server-side paths. Preserve idempotency flags and status transition handling when editing payment processing.

## Source map

- Client routing and page composition: `src/app/app-routing.module.ts`, `src/app/app.module.ts`.
- Visual orientation maps for client wiring, persisted record relationships, and key workflows are available at `/prototypes/app-wiring`, `/prototypes/data-model-map`, and `/prototypes/workflow-map`.
- Shared message creation and current-user snapshots: `src/app/userInterface.service.ts`.
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
| Q09 | `fund.active ==`, `lastMessage ==`, `verified ==` | `fund.daysLeft` ASC | I18 | [src/app/profile.component.ts:237](src/app/profile.component.ts)<br>[src/app/homeFeed.service.ts](src/app/homeFeed.service.ts) |
| Q10 | `isBackendMessage ==`, `lastMessage ==`, `verified ==` | `serverTimestamp` DESC | I33 | [src/app/sidebarConversations.service.ts:19](src/app/sidebarConversations.service.ts) |
| Q11 | `lastMessage ==`, `recipientList array-contains-any`, `verified ==` | `serverTimestamp` DESC | I35 + I42 | [src/app/profile.component.ts:327](src/app/profile.component.ts) |
| Q12 | `lastMessage ==`, `verified ==` | `fund.daysLeft` DESC | I32 | [src/app/buy-prn.component.ts:321](src/app/buy-prn.component.ts) |
| Q13 | `lastMessage ==`, `verified ==` | `serverTimestamp` DESC | I35 | [src/app/profile.component.ts:254](src/app/profile.component.ts)<br>[src/app/sidebarConversations.service.ts:38](src/app/sidebarConversations.service.ts) |
| Q14 | `nameLowerCase <=`, `nameLowerCase >=`, `userChain.nextMessage ==`, `verified ==` | `nameLowerCase` ASC | I57 | [src/app/chat.component.ts:965](src/app/chat.component.ts) |
| Q15 | `recipientList array-contains-any`, `verified ==` | `chatImageTimestamp` DESC | I47 | [src/app/profile.component.ts:319](src/app/profile.component.ts) |
| Q16 | `user ==`, `userChain.newMonth ==`, `verified ==` | `serverTimestamp` DESC | I53 + I55 | [src/app/profile.component.ts:275](src/app/profile.component.ts) |
| Q17 | `user ==`, `userChain.nextMessage ==`, `verified ==` | `serverTimestamp` DESC | I54 | [functions/utils/verifyMessage.js:43](functions/utils/verifyMessage.js) |
| Q18 | `user ==`, `verified ==` | `serverTimestamp` DESC | I55 | [src/app/buy-prn.component.ts:257](src/app/buy-prn.component.ts)<br>[src/app/presence.service.ts:103](src/app/presence.service.ts)<br>[src/app/profile.component.ts:172](src/app/profile.component.ts)<br>[src/app/profile.component.ts:286](src/app/profile.component.ts)<br>[src/app/settings.component.ts:45](src/app/settings.component.ts)<br>[src/app/userInterface.service.ts:91](src/app/userInterface.service.ts)<br>[src/app/userInterface.service.ts:115](src/app/userInterface.service.ts)<br>[src/app/userInterface.service.ts:127](src/app/userInterface.service.ts)<br>[functions/utils/verifyMessage.js:17](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:29](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:155](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:189](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:201](functions/utils/verifyMessage.js)<br>[functions/utils/verifyMessage.js:355](functions/utils/verifyMessage.js) |
| Q19 | `user ==` | `serverTimestamp` DESC | I50 | [functions/scheduledDailyMembership.f.js:33](functions/scheduledDailyMembership.f.js) |
| Q20 | `userChain.nextMessage ==`, `verified ==`, `wallet.balance >` | `wallet.balance` DESC | I59 | [src/app/team.service.ts](src/app/team.service.ts) |
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
