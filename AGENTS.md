# PERRINN agent instructions

## Purpose

PERRINN is a member collaboration application with profiles and a directory, chat, account settings, PRN wallet and membership/payment flows, and community information.

## Current architecture

- The client is an Angular CLI/TypeScript app in `src/`, using NgModules (`src/app/app.module.ts`), routed template-backed components, and AngularFire compatibility APIs.
- Firebase provides Authentication, Cloud Firestore, Realtime Database, and Storage. Client configuration is in `src/environments/`.
- Firestore documents and message records are coupled to client workflows and Cloud Functions. Before changing data shapes, inspect their readers, writers, rules, and functions.
- `functions/` is a separate Node.js 20 codebase using JavaScript, Firebase Admin, and Functions v2. It contains Firestore, Storage, scheduled, and Revolut payment handlers.
- Firebase configuration and policies are in `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, and `database.rules.json`. Hosting serves `dist/`; production enables the service worker.
- Root scripts provide `npm start`, `npm run build`, and `npm run lint`. Functions scripts are in `functions/package.json`. Confirm test coverage before relying on the initial observation that no maintained automated suite exists.
- These are observed implementation details; do not assume other services, layers, data models, or deployment processes exist.

## Working in this repository

- Update documentation when a change affects a documented route, user workflow, data contract, security behavior, shared UI pattern, or development process. For new components, update the relevant guide when the component introduces or changes one of those things; a routine component that follows existing patterns does not need its own documentation entry. Keep `README.md` focused on app-wide orientation and setup, `DATA_MODEL.md` on persisted paths and data workflows, and `UI_SPEC.md` on shared visual and interaction rules. Update this file when agent-facing repository conventions change.
- When creating Angular components, keep each component small and reusable. Limit a component to 500 lines total across its TypeScript, template, and component-specific style files. If a component would exceed that limit, split cohesive UI or behavior into additional reusable components rather than concentrating it in one component. Keep each component focused and avoid splitting code into components that have no meaningful reuse or responsibility of their own.
- Name prototypes descriptively from their subject or design direction. Do not use sequence numbers; distinguish alternatives through their names and descriptions, and carry the descriptive name through folders, component identifiers, routes, metadata, and the gallery.
- Before implementing a request to create Angular components, interview the user to clarify the requirements. Ask one question at a time, wait for the answer, and give multiple-choice options (while allowing a free-form answer). Ask no more than 20 questions total; stop earlier once the requirements are clear. After the interview, implement based on the answers and make any remaining assumptions explicit.
- Prioritize small, maintainable changes. Follow existing app patterns and ask for clarification only when blocked by an important unknown. Refactor nearby code when it clearly improves maintainability, while keeping the change focused.
- For UI changes, improve the experience while keeping the app's visual style. Support mobile and desktop layouts. Include loading and error states, and empty states when relevant. Handle accessibility case by case and call out meaningful gaps.
- Before UI work, read `UI_SPEC.md` and inspect the relevant templates plus matching rules in `src/styles.css`. Treat the global stylesheet and existing screens as legacy implementation, not as design examples; reuse styles only when they agree with `UI_SPEC.md`.
- For new or rebuilt UI, follow `UI_SPEC.md` when existing global styles conflict. Keep new styling scoped to the relevant component or page where practical. Do not change global CSS or redesign unrelated screens as part of a feature task. If a global rule blocks the specified UI or interaction, identify the rule and its impact, then propose the smallest focused CSS change for review.
- Put data access and substantial business logic in services; keep components focused on UI. Prefer concise code over unnecessary explicit typing, while retaining clear types at data and API boundaries.
- Ask the user before changing persisted data shapes or Firebase security rules/authorization behavior. Inspect the affected readers, writers, rules, and server handlers before proposing those changes.
- Add a dependency only when its benefit is clear, and explain why. Preserve or change the current architecture based on the task, and explain the choice. Deployments and production changes should follow the task's scope and authorization.
- Do not create branches or commits unless the user explicitly asks. A small, low-risk unrelated bug may be fixed while working; mention it in the final summary.
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
- Use judgment about adding or updating automated tests when a suitable setup exists. Describe validation performed and any meaningful coverage gaps.
- For Firestore, Storage, or Realtime Database rule/schema changes, validate relevant authenticated, unauthenticated, and cross-user access. Consider emulator checks when available.
