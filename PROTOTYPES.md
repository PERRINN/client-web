# PERRINN prototypes

The `/prototypes` area, labeled **Prototyping** in the app, is a visual lab for trying and comparing UI ideas before building production components. Prototypes use local or mock data. The former chat-bubbles experiment has been promoted to production chat.

## Structure and naming

Each prototype lives in its own folder under `src/app/prototypes/`, with a routed Angular component and a `metadata.md` containing `Name`, `Type`, `Description`, and `Status`. Add each prototype to the Prototyping catalog and routing when creating one.

Give each prototype a descriptive name based on its subject or design direction, such as `chat-bubbles` or `clear-slate`. Do not add sequence numbers. Use the name and description to distinguish alternatives. Use descriptive folder names, component names, and route paths as well.

Keep each experiment small, focused on one design or interaction question, self-contained, and ideally at or below 300 lines of code. Use scoped styles and local state so a prototype can be changed or removed without affecting production components.

Statuses are `EXPERIMENT`, `CANDIDATE`, `SELECTED`, `REJECTED`, and `ARCHIVED`. Update the metadata status as an idea is evaluated. A selected prototype is a design reference: implement the approved behavior in the appropriate production component and service, then keep or archive the prototype as a reference. Do not import prototype code into production as a shortcut.

## Prototypes

The catalog groups prototypes into **Engineering pilots**, **Architecture maps**, **Mosaics**, and **Colour palettes**. Colour palette previews include previous/next controls to move through their category without returning to the catalog.

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
