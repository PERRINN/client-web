# PERRINN prototypes

The `/prototypes` area, labeled **Prototyping** in the app, is a visual lab for trying and comparing UI ideas before building production components. Visual studies use local or mock data. Explicitly approved functional pilots such as Team Radio use isolated Firebase paths documented in data-model.md. The former chat-bubbles experiment has been promoted to production chat.

## Structure and naming

Each prototype lives in its own folder under `src/app/prototypes/`, with a routed Angular component and a `metadata.md` containing `Name`, `Type`, `Description`, and `Status`. Add each prototype to the Prototyping catalog and routing when creating one.

Give each prototype a descriptive name based on its subject or design direction, such as `chat-bubbles` or `clear-slate`. Do not add sequence numbers. Use the name and description to distinguish alternatives. Use descriptive folder names, component names, and route paths as well.

Keep each experiment small, focused on one design or interaction question, self-contained, and ideally at or below 300 lines of code. Use scoped styles and local state so a prototype can be changed or removed without affecting production components.

Statuses are `EXPERIMENT`, `CANDIDATE`, `SELECTED`, `REJECTED`, and `ARCHIVED`. Update the metadata status as an idea is evaluated. A selected prototype is a design reference: implement the approved behavior in the appropriate production component and service, then keep or archive the prototype as a reference. Do not import prototype code into production as a shortcut.

## Prototypes

The catalog groups prototypes into **Team tools**, **Engineering pilots**, **Architecture maps**, **Mosaics**, and **Colour palettes**. Colour palette previews include previous/next controls to move through their category without returning to the catalog.

Layout prototypes are low-level structural wireframes for deciding page composition. Use a few standard UI labels for regions and components, such as Primary Navigation, Search, Page Title, Content Panel, and Composer. Represent content with neutral placeholder shapes; avoid realistic product data, names, dates, counts, and explanatory copy. Do not add responsive behavior descriptions: users inspect reflow by dragging the preview's right edge. Each layout preview should have keyboard width adjustment and container-based breakpoints so its layout responds to the simulated width independently of the browser window. Keep the layout easy to read, with clear grouping from the app UI specification's dark page and surface contrast, sparse borders, and enough space to distinguish hierarchy and component placement.

- **Architecture maps:** `app-wiring`, `data-model-map`, and `workflow-map` show the current source structure, persisted record relationships, and major client-to-server workflows.
- **Colour palettes:** `clear-slate`, `warm-graphite`, `deep-tide`, `quiet-plum`, `clay-ember`, and `night-signal` compare distinct surface and accent combinations using the same mock team home screen.

## Promoted designs

The former **chat-bubbles** experiment is now the production chat at `/chat/:id`, with implementation under `src/app/chat/`. `/chat` opens the latest conversation. Old `/prototypes/chat-bubbles` and `/prototypes/chat-bubbles/:id` bookmarks redirect to the canonical routes, preserving query parameters. The gallery tile and prototype-only navigation have been removed; archived metadata records the promotion.

See [ui-spec.md → Production chat](ui-spec.md#production-chat) for the approved conversation experience and known feature differences, and [data-model.md](data-model.md) for message, read-cursor and transfer contracts. The implementation no longer imports chat code from the prototype tree.

## 424 rear-wing pilot

`/prototypes/rear-wing-pilot` is a single engineering brief for Lewis Valentine’s NativeCAD/FeatureBoard pilot (#84). It covers the development scope, fixed geometry, two-pillar load path, loads and stiffness, preliminary pneumatic sizing, composite construction, required deliverables and open decisions. It is a read-only handoff with no tabs, forms, browser-local drafts or Firebase writes. The approved scope targets a manufacturing-ready assembly; release still depends on resolving open requirements and engineering validation.

A rendered view captured directly from the public Onshape assembly (DRS closed, 17 October 2026) provides context below the title; the image links to the exact source assembly. It represents the conceptual baseline, not the completed manufacturing design.

A typed source (`rearWingBrief.ts`) supplies both the page and its complete Markdown/JSON downloads. JSON includes numeric values and units in field names, provisional status, unresolved CAD metadata and the derived strength loads. No backend, Firebase rules, persisted production contracts or dependencies change.

The exact Onshape assembly opens anonymously as **PERRINN 424 architecture | rear wing**, with DRS closed selected (checked 17 October 2026). Anonymous CAD export and supported formats remain unverified; obtain a public downloadable package if login is required. The workspace link is mutable: agree a fixed version and source date. Nico permits open reuse and Lewis’s public demonstration, with the formal CAD licence and scope still to be confirmed. Later unpublished inputs require approval before external sharing.

Validation: `npm run test:rear-wing` checks strength-load derivation, provisional and unresolved inputs, and complete Markdown/JSON handoff content. Also run `npm run build` and `npm run lint`; verify the gallery graphic, route and mobile/desktop layouts. Engineering calculations and manufacturing readiness require Lewis’s review.


## Team Radio

`/prototypes/team-radio` is a functional team-wide push-to-talk experiment (#87), not specific to Greenpower. It uses existing sign-in, Realtime Database coordination and browser WebRTC audio. The gallery includes a radio graphic tile and the page links back to Prototyping. UI is intentionally limited to participants, connection state, Join/Leave, speaking permission, mute, key selection and Talk; no introductory descriptions or user guide appear on the page.

Ten account reservations include three optional speaking reservations. Users join as listeners, then claim Enable talking first come, first served. No queue. Places never expire on disconnect/page close; only the owner releases them. List statuses distinguish Listening, Talking, Offline, Muted and Connecting. Reconnect resumes an existing reservation, with microphone activation separate from the preserved speaking permission. The newest tab controls an account's audio.

Hold Talk or the chosen keyboard key to transmit; release, lost pointer capture, tab blur, hidden page, disconnect, lost authorization or the 30-second cap stops transmission. A busy press never queues; release and press again. The sender emits a 100ms start beep into the actual outgoing stream and local playback only after successful floor acquisition. A 180ms microphone delay buffers the opening syllable behind the beep. Normal release drains that short buffer before releasing the floor. Playback mute suppresses incoming audio, including received beeps. Key preferences are stored on that browser only; text inputs, links, buttons, modifier shortcuts and repeated keydown events do not trigger the global binding. The Talk button itself supports held Space/Enter.

### Run and validate

1. For hosted use, deploy **only the approved Realtime Database rules** (`firebase deploy --only database`) before releasing the client through the normal authorized deployment workflow. Implementation alone does not deploy anything. The existing RTDB instance/configuration must be reachable. No Functions deployment or Firestore index change is required. Rule-emulator checks are local and do not prove production configuration.
2. Run `npm start`; open the route in three or more signed-in devices/accounts. Use localhost or HTTPS for microphone access. Join, enable talking on up to three accounts, and leave the others listening. Keep the pages active; background and lock-screen audio are out of scope.
3. Verify participant identities/statuses, denied microphone permission, mute, custom keyboard key, touch/mouse holds, release/cancel and focus loss. Test speaking-seat contention separately from transmission contention. Hold for over 30 seconds: transmission stops and a fresh press is required. Fill ten participant places and three speaking places; extra claims must fail. Release/reclaim both kinds of place.
4. Interrupt connectivity and close/reopen tabs: audio must stop, reservations must remain, and reconnect must restore the same account's places. Test two tabs for one account: only the latest session stays active and the old disconnect must not mark it offline. Sign out and use a different account to verify no prior account's places/audio carry over.
5. Run `npm run test:radio` for state/input/audio and acquisition/release race tests. Start `firebase emulators:start --only database --project demo-team-radio` with Java 21+, then run `npm run test:radio:rules`. The latter loads the repository rules into an isolated `demo-team-radio-rules-*` namespace on `127.0.0.1:9001` and tests unauthenticated/cross-user denial, reservation limits/uniqueness, simultaneous claims, session takeover, lease recovery and private bounded signaling. It refuses non-local emulator targets. No test dependency is added.

### Connectivity, performance and limits

Peer connections are prepared before Talk is enabled; only pairs involving a speaking reservation connect. At the full three-speaker/ten-person room this is at most 24 bidirectional peer connections across the room; each active speaker sends up to nine audio copies. Listeners do not need microphone permission. Each speaker browser keeps its microphone stream open only while microphone-enabled and gates outgoing speech at the audio graph; disabling talking or closing the radio stops the capture tracks. Silent negotiated tracks can remain open to avoid reconnecting on every press.

The prototype uses Google's public STUN endpoint and has no user-facing connection settings or relay credentials. Joining uses the existing PERRINN sign-in session. Some mobile networks, firewalls and NATs require TURN; a managed relay and automatic short-lived credential delivery would need a separate infrastructure/backend proposal and approval. No relay service or credential issuer is provisioned by this prototype. Relay coverage and costs remain unverified.

Database region, network round trips and WebRTC routing affect responsiveness. The start beep and 180ms microphone buffer add a deliberate short lead-in. Validate press-to-beep and speech-to-heard latency on real desktop/mobile devices over Wi-Fi and mobile data, including TURN, before increasing capacity or relying on this trackside. This prototype does not promise Zello's background operation, locked-screen reliability, managed relay infrastructure, offline messages or delivery guarantees. Same-machine synthetic browser checks are functional checks, not a measured field latency/audio-quality result.


Validation on 17 October 2026: production build and lint, 13 focused unit tests and 9 tests against the actual RTDB emulator. A temporary local-only browser harness ran the real component/services/rules with three synthetic accounts and generated audio (no physical microphone or production database). Both initiating and answering peers transmitted to the other two accounts; receiver RTP energy and waveform levels were non-zero. Checked persistent reservations on reload, reconnect, session takeover, custom key persistence, denied microphone permission without consuming a speaking place, explicit Leave, and database disconnect stopping outgoing/incoming audio while retaining reservations. Inspected desktop and exact 390px iframe/mobile layouts (no horizontal overflow), signed-out entry and the gallery graphic/route. Temporary identities/media instrumentation were removed. Real mobile/desktop device combinations, ten-device load, observed field latency/quality and TURN/mobile-data operation remain unverified.
