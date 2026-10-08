# PERRINN prototypes

The `/prototypes` area, labeled **Prototyping** in the app, is a visual lab for trying and comparing UI ideas before building production components. Prototypes use local or mock data and remain independent of production behavior and services.

## Structure and naming

Each prototype lives in its own folder under `src/app/prototypes/`, with a routed Angular component and a `metadata.md` containing `Name`, `Type`, `Description`, and `Status`. Add each prototype to the Prototyping catalog and routing when creating one.

Give each prototype a descriptive name based on its subject or design direction, such as `MEMBER-TEXT-FIELD` or `CLEAR-SLATE`. Do not add sequence numbers. Use the name and description to distinguish alternatives. Use descriptive folder names, component names, and route paths as well.

Keep each experiment small, focused on one design or interaction question, self-contained, and ideally at or below 300 lines of code. Use scoped styles and local state so a prototype can be changed or removed without affecting production components.

Statuses are `EXPERIMENT`, `CANDIDATE`, `SELECTED`, `REJECTED`, and `ARCHIVED`. Update the metadata status as an idea is evaluated. A selected prototype is a design reference: implement the approved behavior in the appropriate production component and service, then keep or archive the prototype as a reference. Do not import prototype code into production as a shortcut.

## Prototypes

The catalog groups prototypes into **Inputs**, **Layouts**, and **Colour palettes**, with jump links for moving directly between categories. Layout and colour palette previews include previous/next controls to move through their own category without returning to the catalog.

- **Inputs:** `MEMBER-TEXT-FIELD` is available at `/prototypes/MEMBER-TEXT-FIELD`. It demonstrates the Prototyping-to-preview workflow with an interactive, local-only text field.
- **Layouts:** `CLASSIC-SOCIAL-FEED`, `COMMUNITY-DASHBOARD`, and `MOBILE-FIRST-SOCIAL` explore community feed, dashboard, and mobile-first arrangements.
- **Colour palettes:** `CLEAR-SLATE`, `WARM-GRAPHITE`, `DEEP-TIDE`, `QUIET-PLUM`, `CLAY-EMBER`, and `NIGHT-SIGNAL` compare distinct surface and accent combinations using the same mock member-home screen.
