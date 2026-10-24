# Joblite AHS mobile UI source kit

A React/TypeScript UI foundation matching the supplied Joblite AHS mobile mockup. This is new reference implementation code, not an export of your current production repository.

## Files
- `JobliteHome.tsx`: typed, data-driven home/feed component with inline SVG icons and action callbacks.
- `JobliteHome.css`: namespaced responsive styles. No UI/icon library required.
- `OPEN_CODE_PROMPT.md`: implementation and deployment prompt for OpenCode.
- `reference.png`: the user-supplied design reference.

## Use with your existing project
1. Extract this folder into a separate working directory; do not overwrite your repository wholesale.
2. Give OpenCode the prompt and the reference image.
3. Have it copy/adapt the component and stylesheet to `src/client/` and connect props to actual API handlers, session state and routes.
4. Verify guest and authenticated workflows, then build and deploy using the existing configuration.

```tsx
import JobliteHome from './components/JobliteHome';
// Build an adapter from existing queries, session state and router callbacks.
// <JobliteHome {...adapter} />
```

The component receives real feed items; it has no sample jobs or invented engagement counts. Defaults and response mapping belong in the adapter, not in fabricated production data. `publishedLabel` should be derived from real server timestamps. Board URLs and media URLs must be validated by the adapter/server before use.

## Callback contract
- `onPublish`, `onToggleSave`, `onPostAction`, `onShare` return promises and reject on real failures.
- The host updates feed props after save/like/publish success; the component does not independently mutate server state.
- `onAddMedia` exposes the attachment intent. The host must implement secure upload and extend the composer to show/remove attachments.
- `onSignIn(intent)` preserves an intended action; the host must request explicit confirmation before submitting or publishing after login.
- `onApply` differentiates native and imported jobs in the host adapter and validates the destination.
- `onNavigate` adapts the reference paths to the actual router. Active Home styling is intended only for this Home component.
- `onItemMenu`, `onEligibility` and `onNotifications` require real host views.
- Search debounce, cancellation, pagination, API cache and scheduled source ingestion are integration work, not included backend services.

All controls expose callbacks, but they become production features only when integrated. There is no bundled authentication service, database, upload server or 30-minute scheduler. The OpenCode prompt directs implementation against the actual repository.

## Visual choices
White/slate surfaces; navy text; blue primary actions. Real notification counts only. Guests receive a board-discovery strip rather than fictitious private application counts. Video uses native accessible controls, never fake playback thumbnails.

## Validation
See `VALIDATION.md` for the actual checks performed on this kit. Validate against your installed React/TypeScript versions and actual API contracts after integration.
