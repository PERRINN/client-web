# PERRINN UI Specification

This is the design authority for new and rebuilt PERRINN components. It reflects the product direction established with the product owner and the existing Angular client. If existing UI or CSS conflicts with these rules, follow this specification for new work. Do not redesign unrelated legacy screens as part of a component change.

## Legacy CSS boundary

- Treat the existing global stylesheet and existing screens as legacy implementation, not as examples of the intended design. Reuse a rule only after confirming that it agrees with this specification.
- The legacy universal selector in `src/styles.css` applies `overflow: hidden` and a fixed `line-height: 21px` to all elements. Scoped component styles must reset those inherited global declarations where they clip text; for page headings, use `overflow: visible` and a suitable proportional line height (the existing prototype pattern is `:host h1, :host h2, :host h3 { overflow: visible; line-height: 1.35; }`).
- For new or rebuilt UI, follow this specification even when global CSS or nearby legacy UI conflicts with it. Keep new styling scoped to the relevant component or page where the existing Angular setup allows it.
- Follow the UI inspection and global CSS review workflow in [AGENTS.md](AGENTS.md) when a legacy rule blocks this specification.
- The approved Night Signal Dark rollout is a global stylesheet reconciliation. Migrate production colors to shared palette and semantic tokens, including color bindings in templates and services. Keep dynamic values dynamic, and retain component or page rules only where they express screen-specific behavior. Avoid unrelated layout or behavior changes during this rollout.

## Styling ownership and migration

- `src/styles.css` owns production colour tokens, the legacy base/reset, shared controls and unmigrated screen rules. Shell layout belongs in `src/app/app.component.css`; Home, Chat, Profile, Settings, Login, Directory and Buy PRN presentation belongs in their respective component stylesheets.
- Keep shell viewport sizing, `#main_container` scroll ownership, sidebar and mobile drawer rules in the App component. Preserve `main_container` and `secondary_container` IDs: legacy pages use them for scrolling and chat positioning.
- Component styles own their typography, layout, responsive rules and states. Use inherited typography within each migrated component, with explicit icon-font exceptions. The global reset still applies to legacy screens; do not remove it as part of an isolated migration.
- Profile owns its sidebar embedding through `:host.sidebar-profile` and the compact conversation-list rules in `profile.component.css`. The shell owns the scroll region and row-height token; it must not reach into Profile through `::ng-deep`.
- Settings, Login, Directory and Buy PRN retain their existing layouts and interactions during CSS ownership migration. Their local styles preserve legacy typography and states; this migration is not a screen redesign. Buy PRN owns its currency-selector layout, including its mobile breakpoint. Shared progress, control and table utilities remain global while other components consume them.
- Before moving global rules, inspect template and runtime consumers, preserve effective styles, then verify the scoped replacement and remove superseded rules. Shared classes still used across screens remain global until their consumers are migrated.
- Night Signal Dark is the approved production palette. `/prototypes/night-signal-dark` remains available for comparison with the original `/prototypes/night-signal` study. Keep the original study’s local palette values for comparison.

## Design character

- Make the interface understated, engineered and calm, with a balanced information hierarchy.
- Keep useful information visible and organized; avoid both overcrowding and unnecessary whitespace.
- Make intent and available actions clear through layout, hierarchy, familiar controls and concise labels. Avoid descriptions, instructions and repeated wording when the interface already makes the meaning obvious. Add explanatory text only when it provides necessary information, such as an unfamiliar action, a consequential choice or an error; preserve accessible names for controls.
- Use a dark-mode language inspired by current ChatGPT: deep neutral backgrounds, subtly differentiated dark surfaces and light neutral typography. Keep cards and panels borderless by default.
- Use panels to group most sections, but distinguish them subtly. Keep spacing compact and functional.

- Do not brand or label user-facing product UI as AI-driven. Use neutral terms such as “Assistant” where a conversational assistant needs a label; do not add AI badges, headings, navigation labels, or promotional copy unless the user explicitly requests that branding.

## Colour

- Use the **Night Signal Dark** palette as the production colour direction. Its core tokens are:

  | Role | Token | Value |
  | --- | --- | --- |
  | Page background | `--color-page` | `#0B1118` |
  | Surface | `--color-surface` | `#17212C` |
  | Raised surface | `--color-raised` | `#263443` |
  | Border | `--color-border` | `#7A8CA0` |
  | Keyboard focus | `--color-focus` | `var(--color-text-secondary)` |
  | Primary text | `--color-text` | `#F4F6F8` |
  | Secondary text | `--color-text-secondary` | `#CBD4DE` |
  | Muted text | `--color-text-muted` | `#AAB7C5` |
  | Primary action accent | `--color-accent` | `#E5C477` |
  | Accent text | `--color-accent-ink` | `#2A2417` |
  | Selected surface | `--color-selected` | `#344552` |
  | Error text | `--color-danger-text` | `#FCA5A5` |

- For translucent production colours, use `color-mix(in srgb, var(--color-…) N%, transparent)` so they follow the shared palette. Do not repeat palette RGB values. PWA theme and launch backgrounds in `src/index.html` and `src/manifest.json` mirror the page token; chart backgrounds read the surface token.
- Use the page, surface and raised tokens to distinguish the canvas, grouped content, and controls or nested emphasis. Use the focus token for keyboard outlines. Reserve the border token for controls, or states where a border materially improves clarity or accessibility.
- Use light neutral primary text, cool secondary text and muted text for clear hierarchy. Keep text readable; do not use muted text for essential content when contrast is insufficient.
- Use gold for primary actions and restrained emphasis. Keep green for success, use the selected-surface token for selected controls, and use restrained red for errors. Use `--color-danger` for error fills and `--color-danger-text` for readable error text. Do not use gold as the sole indication of status.
- Never use pure black as a page or component background. Avoid gradients, shadows, and unrelated saturated accents.
- Use restrained red for errors. Keep destructive actions neutral and make their consequence clear in the label and confirmation.
- Define shared production colour tokens in `src/styles.css` and use them in global rules and components where the style is genuinely shared. Legacy tokens remain for existing prototypes; production rules must use the Night Signal Dark and semantic tokens. Do not add palette hex values to individual component styles when a shared token represents the role.
- Existing `--bg-black` is pure black and conflicts with this specification; do not use it for new or migrated page backgrounds. Keep component-specific layout and one-off styling scoped to components when it is not a shared design rule.
- Keep accent color sparse. Avoid gradients and high-contrast decorative color treatments.

## Typography

- Use the shared `--font-family-ui` token in `src/styles.css`: `'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`. The document sets this family and the shared `--font-weight-body` token (medium 500); the universal reset inherits both so routed components, sidebar lists, forms and nested text use the same family. Component rules should reference the token rather than repeat the stack. Exclude Material Icons and Material Symbols from local text-family resets so their glyph fonts remain intact. Canvas charts must read the document font family for their titles, axes and legends because canvas text does not inherit CSS.
- Use the approved Home typography scale for all new and rebuilt UI, including prototypes:

  | Text role | Font size |
  | --- | --- |
  | Page headline | 23px |
  | Section heading | 17px |
  | Primary body text, names and row/event titles | 16px |
  | Supporting text, dates, durations, timestamps and loading/error/empty messages | 15px |
  | Minor labels, section kickers, hints and helper text | 14px |

- Production text sizes were increased by 1px for readability; compact sidebar labels use 14px. Keep icon dimensions independent of text sizes.
- Keep these sizes on mobile. Resolve limited space through wrapping, layout and spacing rather than shrinking text. Do not use 9–12px text for ordinary labels or information users need to read.
- Use the shared `--font-weight-body` token (medium 500) for body text, metadata, navigation and form controls, weight around 550 for row titles, and semibold around 600 for headings and emphasized labels. Set emphasis in scoped component styles; let nested text inherit the intended weight instead of resetting every descendant. Component-wide descendant rules must not override their own heading and emphasis weights; the global reset already supplies weight inheritance.
- Use proportional line heights: about 1.45 for body text and metadata, and 1.35 for headings. Let rows grow when names or titles wrap; avoid fixed heights that clip larger text. Keep compact numeric date blocks legible with enough space for both lines.
- Keep headings quietly distinct from body text through modest size and weight changes, not display styling.
- Use the same typeface for text and numbers. Emphasize important values through size and weight, not a separate monospace face.
- Keep text within the same line consistent in font size, weight, family, and style, including inline dates, durations, units, and metadata. Do not vary typography within a line for routine emphasis. Set nested inline elements to inherit these properties explicitly when legacy global styles override inheritance.
- Maintain readable contrast and concise labels. Use this approved scale as the reference, not older compact prototypes or legacy typography overrides. Apply it incrementally to the requested screen; do not restyle unrelated legacy pages.

## Layout & spacing

- Adapt content width and columns to the content. Use a readable maximum width for focused forms and detail views; allow data-heavy or workspace layouts to use more of the viewport when that improves scanning.
- Stack multi-column layouts into one column on mobile and keep key actions visible. On tablet, adapt to content and available space; retain columns only when they remain readable.
- Use distinct panels for most meaningful sections, separated through background contrast, spacing, and alignment. Avoid splitting a single task or closely related information across unnecessary panels.
- Keep spacing compact and functional. Use consistent gaps within a component and stronger separation between sections; do not add whitespace for decoration.
- Align related labels, values and actions. Choose grids, lists or tables according to the information rather than forcing one layout onto every data set.

## Components

- **Buttons:** use one filled gold primary style per task area, with accent ink for legible text. Secondary actions should have less visual weight. Destructive actions remain neutral; use clear wording and confirmation for consequential operations. Selected controls use the selected-surface token.
- **Inputs:** use dark filled fields with the surface or raised token, a subtle border, clear text and a restrained neutral focus outline. Keep labels and validation associated with their field.
- **Cards and panels:** use borderless surfaces by default, with the surface or raised token. Separate them through background contrast, spacing, and alignment. Do not add outline borders for decoration or routine grouping. Reserve borders for controls, focus indicators, or states where they materially improve clarity or accessibility. Do not use shadows or gradients.
- **Navigation:** prefer visible labels, adding icons where they improve recognition. Keep hierarchy clear and selected state restrained. PERRINN’s conversation activity summary repeats the conversation indicators as small red, green, grey and gold dots, with accessible names and hover titles; gold here denotes a manual flag, not an action.
- **Tabs and selections:** make the selected state clear using the selected-surface token. Do not make every tab or option visually prominent.
- **Lists within panels:** keep routine event, user and similar list rows transparent at rest. Use spacing and alignment to separate items; do not give every row a card, raised surface or decorative container. Keep supporting date blocks transparent too. Subtle hover backgrounds and visible keyboard focus indicators are appropriate for interactive rows.
- **Tables and data:** choose between aligned compact rows and cards based on the content. Align comparable values and use consistent number emphasis; do not add decorative containers around every value.
- **Dialogs:** prefer inline panels when they can handle the task. Use a modal only when a focused interruption or confirmation is needed; keep it plain, compact and easy to dismiss.
- **Notifications:** show field errors inline. Use a toast for broader success or error updates. Keep success green and errors restrained red.
- **Data displays:** establish hierarchy through alignment, labels, size and weight. Avoid color as the only way to communicate meaning.

## Interaction

- Keep hover changes subtle and neutral, such as a small surface change. For controls that already have borders, a subtle border change is also appropriate. Use a subtle neutral focus outline for keyboard users.
- Show disabled controls with lower contrast and prevent interaction. Keep their labels legible.
- Keep layouts stable while loading. When showing a loading label, use “Loading”; the surrounding UI supplies context. Where useful, include a small spinner or progress indicator.
- Avoid animations and transitions. Do not animate routine navigation, hover, panel changes or feedback.
- Make selected, success, error and disabled states distinguishable without relying on color alone. Support keyboard use and preserve visible focus.
- Include loading and error states, and empty states where relevant.

## Responsive

- Design for desktop, tablet and mobile from the content outward; do not treat existing breakpoints as a required system.
- The app shell occupies the dynamic viewport, with `#main_container` owning page scrolling. Avoid creating a second, document-level scroll surface around it.
- All pages, including prototypes, use a 320px conversation sidebar on desktop. Its conversation list scrolls independently, with navigation above and account/wallet controls below. Below 900px, the sidebar becomes a dismissible navigation drawer with focus containment and a header menu button. Prototype preview controls sit inside the shared app shell.
- The conversation scrollbar track matches the sidebar surface. Its thumb appears during scrolling and hides after 800ms without scrolling, including when the list remains hovered or focused; retain scrollbar space to avoid layout shifts.
- Main sidebar conversation rows and Load more use a consistent 42px height. The main list rounds its remaining available space down to a whole number of rows using CSS `round()`; unused space remains below it. Both sidebar lists snap scrolling to row boundaries so they settle on complete rows. Browsers without CSS `round()` retain the available-height fallback.
- Automatic updates sit between the main conversation list and account controls, in an independently scrolling list with a fixed 126px height for three 42px rows, including when empty. Give the surrounding raised surface 8px padding on all sides, for a total section height of 142px. Match the main conversation rows' padding, spacing, round 24px avatars and single-line title typography; omit message previews. Use the shared raised surface for the list and its scrollbar track. Omit its visible heading and loading/empty/error text; retain accessible region labels and loading state. Apply the same scrollbar visibility behavior. These rows open the existing conversations and carry no activity dots.
- On mobile, use a single column, adapt navigation and controls to the available width, and keep primary actions reachable.
- On tablet, choose columns and navigation based on actual content fit. On desktop, use additional width for useful comparison or workspace layouts, not decorative empty space.
- Preserve readable text, usable controls, and clear scroll ownership at every size.

## Prototypes

- Give every standalone prototype page a visible, keyboard-accessible link back to `/prototypes`, following the existing “← Prototyping” pattern.
- Do not add design question prompts or sections to prototypes unless the user explicitly requests them.
- Layout prototypes are structural wireframes, not populated product mockups. Label only key regions with standard UI terms (for example, Primary Navigation, Search, Page Title, Content Panel, Feed Item, and Composer); use simple placeholder shapes instead of realistic names, copy, metrics, dates, or records. Do not add responsive behavior descriptions: users inspect responsiveness by resizing the preview width. Give each layout prototype a draggable right-edge width control, keyboard adjustment, and a width-constrained container so its own breakpoints respond independently of the browser window. Keep the wireframe visually clear and quiet, using the app UI specification's dark page, surface, and raised-surface contrast. Prefer surface contrast, spacing, and alignment over borders; keep labels sparse so the component hierarchy is immediately legible.

## Do / Don't

**Do**

- Use dark neutral surfaces, light neutral typography and borderless cards and panels separated through contrast, spacing, and alignment.
- Keep hierarchy clear, information balanced and spacing functional.
- Use neutral surfaces for selected states, green sparingly for success, and red for errors.
- Prefer inline feedback and content-appropriate data layouts.

**Don't**

- Use pure-black backgrounds, excessive colored elements or high-contrast decoration.
- Add gradients, shadows, animation or transitions.
- Make the interface generic SaaS, overly spacious, or needlessly dense.
- Create excessive panel subdivisions, inconsistent button styles, or arbitrary typography and colors.
- Treat legacy styling as intentional when it conflicts with these rules.

## Rules for new components

1. Read and follow `ui-spec.md` before building or rebuilding a component.
2. Reuse existing tokens and shared patterns where they fit this specification; where they conflict, follow this specification for new work.
3. Follow these typography, colour, spacing, layout, interaction and responsive rules. Existing global CSS is not an exception to the spec; use the legacy CSS boundary above when rules conflict.
4. Do not introduce a new visual pattern without a clear product reason.
5. Extend the PERRINN design system rather than creating a parallel one.
