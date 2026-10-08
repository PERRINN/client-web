# PERRINN UI Specification

This is the design authority for new and rebuilt PERRINN components. It reflects the product direction established with the product owner and the existing Angular client. If existing UI or CSS conflicts with these rules, follow this specification for new work. Do not redesign unrelated legacy screens as part of a component change.

## Legacy CSS boundary

- Treat the existing global stylesheet and existing screens as legacy implementation, not as examples of the intended design. Reuse a rule only after confirming that it agrees with this specification.
- For new or rebuilt UI, follow this specification even when global CSS or nearby legacy UI conflicts with it. Keep new styling scoped to the relevant component or page where the existing Angular setup allows it.
- Do not change global CSS or redesign unrelated screens as part of a feature task. If a global rule prevents the specified UI or interaction, describe the affected rule and its visible impact, then propose the smallest focused CSS change for review.
- The approved Night Signal rollout is a global stylesheet reconciliation. Migrate production colors to shared palette and semantic tokens, including color bindings in templates and services. Keep dynamic values dynamic, and retain component or page rules only where they express screen-specific behavior. Avoid unrelated layout or behavior changes during this rollout.

## Design character

- Make the interface understated, engineered and calm, with a balanced information hierarchy.
- Keep useful information visible and organized; avoid both overcrowding and unnecessary whitespace.
- Use a dark-mode language inspired by current ChatGPT: deep neutral backgrounds, subtly differentiated dark surfaces, restrained borders and light neutral typography.
- Use panels to group most sections, but distinguish them subtly. Keep spacing compact and functional.

## Colour

- Use the **Night Signal** palette as the production colour direction. Its core tokens are:

  | Role | Token | Value |
  | --- | --- | --- |
  | Page background | `--color-page` | `#121923` |
  | Surface | `--color-surface` | `#1D2835` |
  | Raised surface | `--color-raised` | `#2A3745` |
  | Border | `--color-border` | `#435263` |
  | Primary text | `--color-text` | `#F4F6F8` |
  | Secondary text | `--color-text-secondary` | `#CBD4DE` |
  | Muted text | `--color-text-muted` | `#AAB7C5` |
  | Primary action accent | `--color-accent` | `#E5C477` |
  | Accent text | `--color-accent-ink` | `#2A2417` |
  | Selected surface | `--color-selected` | `#34404A` |
  | Error text | `--color-danger-text` | `#FCA5A5` |

- Use the page, surface and raised tokens to distinguish the canvas, grouped content, and controls or nested emphasis. Use the border token for subtle separation.
- Use light neutral primary text, cool secondary text and muted text for clear hierarchy. Keep text readable; do not use muted text for essential content when contrast is insufficient.
- Use gold for primary actions and restrained emphasis. Keep green for success, use the selected-surface token for selected controls, and use restrained red for errors. Use `--color-danger` for error fills and `--color-danger-text` for readable error text. Do not use gold as the sole indication of status.
- Never use pure black as a page or component background. Avoid gradients, shadows, and unrelated saturated accents.
- Use restrained red for errors. Keep destructive actions neutral and make their consequence clear in the label and confirmation.
- Define shared production colour tokens in `src/styles.css` and use them in global rules and components where the style is genuinely shared. Legacy tokens remain for existing prototypes; production rules must use the Night Signal and semantic tokens. Do not add palette hex values to individual component styles when a shared token represents the role.
- Existing `--bg-black` is pure black and conflicts with this specification; do not use it for new or migrated page backgrounds. Keep component-specific layout and one-off styling scoped to components when it is not a shared design rule.
- Keep accent color sparse. Avoid gradients and high-contrast decorative color treatments.

## Typography

- Use a clean system sans stack: `'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`.
- Keep headings quietly distinct from body text through modest size and weight changes, not display styling.
- Use the same typeface for text and numbers. Emphasize important values through size and weight, not a separate monospace face.
- Maintain readable contrast and concise labels. Use the existing page-level type sizes as references, not the conflicting global Verdana reset.

## Layout & spacing

- Adapt content width and columns to the content. Use a readable maximum width for focused forms and detail views; allow data-heavy or workspace layouts to use more of the viewport when that improves scanning.
- Stack multi-column layouts into one column on mobile and keep key actions visible. On tablet, adapt to content and available space; retain columns only when they remain readable.
- Use distinct panels for most meaningful sections, with restrained surface contrast and borders. Avoid splitting a single task or closely related information across unnecessary panels.
- Keep spacing compact and functional. Use consistent gaps within a component and stronger separation between sections; do not add whitespace for decoration.
- Align related labels, values and actions. Choose grids, lists or tables according to the information rather than forcing one layout onto every data set.

## Components

- **Buttons:** use one filled gold primary style per task area, with accent ink for legible text. Secondary actions should have less visual weight. Destructive actions remain neutral; use clear wording and confirmation for consequential operations. Selected controls use the selected-surface token.
- **Inputs:** use dark filled fields with the surface or raised token, a subtle border, clear text and a restrained neutral focus outline. Keep labels and validation associated with their field.
- **Cards and panels:** use the surface or raised token and restrained borders to group related content. Do not use shadows or gradients.
- **Navigation:** prefer visible labels, adding icons where they improve recognition. Keep hierarchy clear and selected state restrained.
- **Tabs and selections:** make the selected state clear using the selected-surface token. Do not make every tab or option visually prominent.
- **Tables and data:** choose between aligned compact rows and cards based on the content. Align comparable values and use consistent number emphasis; do not add decorative containers around every value.
- **Dialogs:** prefer inline panels when they can handle the task. Use a modal only when a focused interruption or confirmation is needed; keep it plain, compact and easy to dismiss.
- **Notifications:** show field errors inline. Use a toast for broader success or error updates. Keep success green and errors restrained red.
- **Data displays:** establish hierarchy through alignment, labels, size and weight. Avoid color as the only way to communicate meaning.

## Interaction

- Keep hover changes subtle and neutral, such as a small surface or border change. Use a subtle neutral focus outline for keyboard users.
- Show disabled controls with lower contrast and prevent interaction. Keep their labels legible.
- Keep layouts stable while loading. Where useful, show both a concise loading label and a small spinner or progress indicator.
- Avoid animations and transitions. Do not animate routine navigation, hover, panel changes or feedback.
- Make selected, success, error and disabled states distinguishable without relying on color alone. Support keyboard use and preserve visible focus.

## Responsive

- Design for desktop, tablet and mobile from the content outward; do not treat existing breakpoints as a required system.
- On mobile, use a single column, adapt navigation and controls to the available width, and keep primary actions reachable.
- On tablet, choose columns and navigation based on actual content fit. On desktop, use additional width for useful comparison or workspace layouts, not decorative empty space.
- Preserve readable text, usable controls, and clear scroll ownership at every size.

## Do / Don't

**Do**

- Use dark neutral surfaces, light neutral typography and restrained borders.
- Keep hierarchy clear, information balanced and spacing functional.
- Use green sparingly for selected and success states, and red for errors.
- Prefer inline feedback and content-appropriate data layouts.

**Don't**

- Use pure-black backgrounds, excessive colored elements or high-contrast decoration.
- Add gradients, shadows, animation or transitions.
- Make the interface generic SaaS, overly spacious, or needlessly dense.
- Create excessive panel subdivisions, inconsistent button styles, or arbitrary typography and colors.
- Treat legacy styling as intentional when it conflicts with these rules.

## Rules for new components

1. Read and follow `UI_SPEC.md` before building or rebuilding a component.
2. Reuse existing tokens and shared patterns where they fit this specification; where they conflict, follow this specification for new work.
3. Follow these typography, colour, spacing, layout, interaction and responsive rules. Existing global CSS is not an exception to the spec; use the legacy CSS boundary above when rules conflict.
4. Do not introduce a new visual pattern without a clear product reason.
5. Extend the PERRINN design system rather than creating a parallel one.
