# PERRINN agent instructions

## Purpose

PERRINN is being built as a home for a large, distributed digital team. Everyone is welcome to participate and contribute to the team's shared missions. The first is 424: designing and building an electric hypercar with the ambition of one day breaking the Nürburgring lap record and racing at the 24 Hours of Le Mans.

PERRINN.com should help the team stay aligned on its mission, share updates, and collaborate. The experience is conversation first, familiar like a messaging or AI chat app, so people can interact and contribute without information feeling trapped in disconnected tools. The product aims to make participation and information flow more fluid and open while keeping team data secure.

AI is intended to help people find information in PERRINN's knowledge base and act as a conversational interface to the application. The longer-term direction is for people to ask for actions in chat instead of navigating forms, with the app's actions and state updated through that interaction. This describes product intent; it does not define AI message access, data handling, or authorization behavior, which must follow the security requirements below and be designed explicitly.

The application currently includes profiles and a directory, chat, account settings, a PRN wallet, and community information. These are existing product areas, not a statement that PERRINN is primarily a membership recruitment or payment product.

## Current architecture

- The client is an Angular CLI/TypeScript app in `src/`, using NgModules (`src/app/app.module.ts`), routed template-backed components, and AngularFire compatibility APIs.
- Firebase provides Authentication, Cloud Firestore, Realtime Database, and Storage. Client configuration is in `src/environments/`.
- Firestore documents and message records are coupled to client workflows and Cloud Functions. Before changing data shapes, inspect their readers, writers, rules, and functions.
- `functions/` is a separate Node.js 20 codebase using JavaScript, Firebase Admin, and Functions v2. It contains Firestore, Storage, scheduled, and Revolut payment handlers.
- Firebase configuration and policies are in `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, and `database.rules.json`. Hosting serves `dist/`; production enables the service worker.
- Root scripts provide `npm start`, `npm run build`, and `npm run lint`. Functions scripts are in `functions/package.json`. Confirm test coverage before relying on the initial observation that no maintained automated suite exists.
- These are observed implementation details; do not assume other services, layers, data models, or deployment processes exist.

## Working in this repository

- Modernise the app incrementally, one component or cohesive workflow at a time. Before changing a component, inspect its current implementation, callers, dependencies, routes, and relevant data or security boundaries. Keep unrelated components out of scope.
- Define clear inputs, outputs, and service contracts for new or rebuilt components. Avoid coupling a replacement to another component's private implementation details; preserve existing integration behavior unless the task explicitly changes it.
- Before UI work, read and follow [ui-spec.md](ui-spec.md), the authority for visual and interaction rules, including prototypes and legacy CSS handling. Inspect the relevant templates and matching rules in `src/styles.css`. Keep unrelated screens out of scope. If a global rule blocks the requested UI, identify its impact and propose the smallest focused global CSS change for review before editing it.
- Preserve compatibility with existing routes, authentication behavior, Firestore data, and other persisted contracts. Treat schema or authorization changes as deliberate migrations: inspect all affected readers and writers, then ask before making the change, as required below.
- Before replacing an implementation, identify its essential behavior and integration points and validate that the replacement preserves them. Use the narrowest relevant checks available and report coverage gaps; do not remove the old implementation until the replacement is verified and no callers depend on it.
- Once a replacement is verified, remove obsolete implementation code and dependencies that are no longer used. Keep each step focused and reviewable so changes can be reverted through version control; do not create branches or commits unless explicitly requested.
- Use kebab-case for Angular component files and camelCase for service and Cloud Functions files. Keep a component's TypeScript, template, and style filenames consistent, such as `buy-prn.component.ts` and `buy-prn.component.html`.
- Update documentation when a change affects a documented route, user workflow, data contract, security behavior, shared UI pattern, or development process. For new components, update the relevant guide when the component introduces or changes one of those things; a routine component that follows existing patterns does not need its own documentation entry. Keep `readme.md` focused on app-wide orientation and setup, `data-model.md` on persisted paths and data workflows, and `ui-spec.md` on shared visual and interaction rules. Update this file when agent-facing repository conventions change. Keep each instruction in its authoritative guide and reference it from other documents instead of duplicating it.
- When creating Angular components, keep each component small and reusable. Limit a component to 500 lines total across its TypeScript, template, and component-specific style files. If a component would exceed that limit, split cohesive UI or behavior into additional reusable components rather than concentrating it in one component. Keep each component focused and avoid splitting code into components that have no meaningful reuse or responsibility of their own.
- Name prototypes descriptively from their subject or design direction. Do not use sequence numbers; distinguish alternatives through their names and descriptions, and carry the descriptive name through folders, component identifiers, routes, metadata, and the gallery.
- Before implementing a request to create Angular components, interview the user to clarify the requirements. Ask one question at a time, wait for the answer, and give multiple-choice options (while allowing a free-form answer). Ask no more than 20 questions total; stop earlier once the requirements are clear. After the interview, implement based on the answers and make any remaining assumptions explicit.
- Prioritize small, maintainable changes. Follow existing app patterns and ask for clarification only when blocked by an important unknown. Refactor nearby code when it clearly improves maintainability, while keeping the change focused.
- Give every new or changed client collection query an explicit result limit. Reuse already loaded data when possible and paginate additional results. Before any exception, explain its scope and expected read volume and obtain user approval. Do not apply arbitrary limits to existing flows without checking that required records and behavior remain available.
- Put data access and substantial business logic in services; keep components focused on UI. Prefer concise code over unnecessary explicit typing, while retaining clear types at data and API boundaries.
- Ask the user before changing persisted data shapes or Firebase security rules/authorization behavior. Inspect the affected readers, writers, rules, and server handlers before proposing those changes.
- Add a dependency only when its benefit is clear, and explain why. Preserve or change the current architecture based on the task, and explain the choice. Deployments and production changes should follow the task's scope and authorization.
- Do not create branches or commits unless the user explicitly asks. A small, low-risk unrelated bug may be fixed while working; mention it in the final summary.
- A user request to "publish" explicitly authorizes validating and committing the changes in the requested scope, then pushing the commit to the current branch's configured GitHub remote. "Publish" does not authorize deploying the app. A user request to "deploy" authorizes those same steps followed by app deployment. Complete the authorized steps in that order and report their results. These conventions do not authorize creating branches, force-pushing, or expanding deployment scope; clarify the remote or deployment target only when it cannot be established from the request or repository configuration. If a step fails, report the blocker and do not claim subsequent steps succeeded.
- Keep final updates brief and include the summary and changed files. Use judgment about documentation and comments; add them when they help users or maintainers.
- Before editing, inspect relevant components, templates, services, routes, Firebase rules, Functions, and package scripts. Follow suitable existing patterns; explain when a different approach is needed.
- Keep changes focused and readable. Avoid unnecessary dependencies, broad refactors, and new architectural layers. For significant changes, outline affected client, data, security, and deployment areas first.
- Preserve Angular routing, component/template, and AngularFire compatibility conventions unless the task explicitly scopes a migration. Keep UI behavior in Angular and privileged operations in Cloud Functions; never use client checks as authorization.
- Prefer clear, typed interfaces for changed data while accounting for existing Firestore records and readers. Keep related documentation current.
- Do not silently make significant product, data-model, security-policy, or architectural decisions. State assumptions and trade-offs in the change summary; raise decisions that change product behavior or create lasting commitments before locking them in.
- Treat authentication, authorization, payment, membership, wallet, and private user data as security-sensitive. Read applicable rules and server handlers before changing related flows.
- Preserve least privilege. Check ownership and authorization in rules or trusted server code. Do not expose secrets, credentials, personal data, or payment details in client code, logs, or documentation. Browser environment configuration is public; keep privileged credentials in the project's approved server-side mechanism.
- Changes to Firestore paths, message fields, indexes, retention, or access rules can affect existing users and Functions. Keep client and server behavior aligned, and explain compatibility or migration implications.
- Never weaken or bypass Firebase rules to make a feature work. Review rule changes for unintended access and describe existing policy assumptions rather than silently expanding them.

## Validation and testing

- Run the narrowest relevant checks, then `npm run build` and/or `npm run lint` when appropriate. Run Functions checks only when its package defines a relevant check. Report what ran and any failures; do not claim unrun checks passed.
- Use judgment about adding or updating automated tests when a suitable setup exists. Describe validation performed and any meaningful coverage gaps. For UI changes, check mobile and desktop layouts, relevant loading/error/empty states, and accessibility; report meaningful gaps.
- For Firestore, Storage, or Realtime Database rule/schema changes, validate relevant authenticated, unauthenticated, and cross-user access. Consider emulator checks when available.
