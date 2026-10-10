# PERRINN prototypes

The `/prototypes` area, labeled **Prototyping** in the app, is a visual lab for trying and comparing UI ideas before building production components. Prototypes use local or mock data and remain independent of production behavior and services.

## Structure and naming

Each prototype lives in its own folder under `src/app/prototypes/`, with a routed Angular component and a `metadata.md` containing `Name`, `Type`, `Description`, and `Status`. Add each prototype to the Prototyping catalog and routing when creating one.

Give each prototype a descriptive name based on its subject or design direction, such as `chat-input-bar` or `clear-slate`. Do not add sequence numbers. Use the name and description to distinguish alternatives. Use descriptive folder names, component names, and route paths as well.

Keep each experiment small, focused on one design or interaction question, self-contained, and ideally at or below 300 lines of code. Use scoped styles and local state so a prototype can be changed or removed without affecting production components.

Statuses are `EXPERIMENT`, `CANDIDATE`, `SELECTED`, `REJECTED`, and `ARCHIVED`. Update the metadata status as an idea is evaluated. A selected prototype is a design reference: implement the approved behavior in the appropriate production component and service, then keep or archive the prototype as a reference. Do not import prototype code into production as a shortcut.

## Prototypes

The catalog groups prototypes into **Architecture maps**, **Inputs**, **Layouts**, and **Colour palettes**, with jump links for moving directly between categories. Colour palette previews include previous/next controls to move through their category without returning to the catalog.

Layout prototypes are low-level structural wireframes for deciding page composition. Use a few standard UI labels for regions and components, such as Primary Navigation, Search, Page Title, Content Panel, and Composer. Represent content with neutral placeholder shapes; avoid realistic product data, names, dates, counts, and explanatory copy. Do not add responsive behavior descriptions: users inspect reflow by dragging the preview's right edge. Each layout preview should have keyboard width adjustment and container-based breakpoints so its layout responds to the simulated width independently of the browser window. Keep the layout easy to read, with clear grouping from the app UI specification's dark page and surface contrast, sparse borders, and enough space to distinguish hierarchy and component placement.

- **Inputs:** `chat-input-bar` explores a bottom-pinned message composer with local-only message sending and attachment previews.
- **Architecture maps:** `app-wiring`, `data-model-map`, and `workflow-map` show the current source structure, persisted record relationships, and major client-to-server workflows.
- **Layouts:** `conversation-sidebar` is a chat-first workspace with app links above recent chats and a bottom message composer.
- **Colour palettes:** `clear-slate`, `warm-graphite`, `deep-tide`, `quiet-plum`, `clay-ember`, and `night-signal` compare distinct surface and accent combinations using the same mock member-home screen.
