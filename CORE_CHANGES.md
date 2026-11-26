# Changes to upstream OpenBSP

`hmukhashen/dwesal-core` is a fork of `matiasbattocchia/open-bsp-api`, the
WhatsApp core of DWESAL. Keep pulling upstream; every local change is listed
here with why, so it can be dropped once upstream has an equivalent.

## Template management falls back to the system user token

- File: `supabase/functions/whatsapp-management/templates.ts`
  (`getBusinessCredentials`).
- Change: when the number's `organizations_addresses.extra.access_token` is
  empty, use `META_SYSTEM_USER_ACCESS_TOKEN`.
- Why: DWESAL registers numbers that are already on the platform's Meta app the
  way the README's "For any number you add" describes, without a per-number
  token. `whatsapp-dispatcher` already falls back to the system user token for
  sending, but listing, creating, editing and deleting templates sent
  `Bearer null` to Meta and failed.
- Upstream candidate: yes, it mirrors the dispatcher's existing behaviour.

## Embedded Signup always overrides the WABA's webhook

- File: `supabase/functions/whatsapp-management/embedded_signup.ts`
  (`selfWebhookOverride`, `performEmbeddedSignup`).
- Change: when the signup names no `callback_url` + `verify_token`, the WABA is
  subscribed with `override_callback_uri` =
  `${SUPABASE_URL}/functions/v1/whatsapp-webhook` (plus `?app_id=` when
  `META_APP_ID` lists several apps) and `verify_token` =
  `WHATSAPP_VERIFY_TOKEN`. Without either value the signup stops with a 500
  before anything changes at Meta. The override is not stored in
  `organizations_addresses.extra`, so the verify token stays out of the
  database.
- Why: DWESAL's Meta app is shared with the older Wesal system, whose server is
  the app-level webhook. A plain `subscribed_apps` call would send every
  onboarded number's messages and statuses there instead of to the core. Callers
  that name their own callback (onboarding links) keep it.
- Upstream candidate: maybe, as an opt-in; upstream assumes the app-level
  webhook is the core.

## Number, template and marketing-preference events reach the organization's webhooks

- Files: `supabase/functions/whatsapp-webhook/forward_events.ts` (new),
  `supabase/functions/whatsapp-webhook/index.ts` (the change loop),
  `supabase/functions/_shared/types/whatsapp_webhook_payload_types.ts`
  (`WebhookValueUserPreferences`, `WebhookValueWabaEvent`,
  `FORWARDED_WABA_FIELDS`).
- Change: Meta fields the core ignored are stored as `public.logs` rows,
  `category` = the Meta field, `level` info, `metadata` = `{ waba_id, value }`
  (the shape `account_update` logs already use):
  - `user_preferences` (a user stopped or resumed marketing messages): one row
    for the organization of the number it arrived on, with
    `organization_address`;
  - `phone_number_quality_update`, `phone_number_name_update`,
    `message_template_status_update`, `message_template_quality_update`,
    `template_category_update`: one row per organization holding the WABA
    (connected accounts, else the last one), with `organization_address` when
    the event's `display_phone_number` matches one of its accounts. No schema
    change: the existing `z_notify_webhook_logs` trigger sends each row to the
    organization's webhooks on `logs` insert.
- Why: DWESAL opts contacts out on Meta's marketing stop, slows down or pauses
  campaigns when a number's quality drops, and updates template status without
  waiting for its 30-minute poll. Meta only sends these fields when they are
  subscribed in the app's WhatsApp webhook configuration (App Dashboard >
  WhatsApp > Configuration > Webhook fields).
- Upstream candidate: yes (a generic "forward unknown fields as logs").

## Template list follows Meta's paging

- File: `supabase/functions/whatsapp-management/templates.ts` (`listTemplates`).
- Change: asks for 100 templates per page and follows `paging.next` up to 20
  pages (2,000 templates); answers `{ data }`, plus `paging` only when pages
  were left unread.
- Why: the list returned Meta's first page only (25 templates), so a WABA with
  more never showed the rest in DWESAL.
- Upstream candidate: yes.

## Number health read: `PUT /whatsapp-management/number`

- Files: `supabase/functions/whatsapp-management/numbers.ts` (new),
  `supabase/functions/whatsapp-management/index.ts` (route), `templates.ts`
  (`getBusinessCredentials` exported).
- Change: `PUT /whatsapp-management/number` with
  `{ organization_id, organization_address }` (key role member or above) returns
  Meta's `verified_name`, `display_phone_number`, `quality_rating`,
  `messaging_limit_tier`, `throughput`, `name_status`, `status` for that number,
  read with the number's token or `META_SYSTEM_USER_ACCESS_TOKEN`; a 400 from
  Meta retries with the basic fields only. RLS on the key's client limits it to
  the organization's own addresses; a disconnected account answers 409.
- Why: the core does not store tier or quality; DWESAL polls them (every 6 h and
  after a quality or name event) to slow down or pause campaigns.
- Upstream candidate: yes.

## Template media headers take a sample file: `header_sample`

- Files: `supabase/functions/whatsapp-management/header_sample.ts` (new),
  `templates.ts` (`createTemplate`, `editTemplate`), `index.ts` (POST and PATCH
  `/whatsapp-management/templates` read `header_sample`).
- Change: the body may carry
  `header_sample: { url | base64, mime_type, file_name? }` (jpeg/png ≤5 MB, mp4
  ≤16 MB, pdf ≤16 MB; base64 ≤5 MB). When the template's HEADER is IMAGE, VIDEO
  or DOCUMENT, the core downloads the sample (https only, no literal private or
  internal hosts, no redirects, 20 s timeout, size capped while streaming),
  opens a Meta Resumable Upload session on the first `META_APP_ID` with the
  number's token (or the system user's), uploads the bytes (60 s timeouts) and
  sets the HEADER's `example` to `{ header_handle: [handle] }` before creating
  or editing the template. A sample that does not fit the header format answers
  400; a failed download 422/413; Meta's refusals pass through with Meta's error
  as `cause`. Without `header_sample` nothing changes. Tokens are never logged
  or returned.
- Why: Meta rejects media-header templates without a sample handle, and the
  handle needs the app ID and a token that only the core holds. DWESAL sends a
  15-minute signed storage link.
- Upstream candidate: yes.

## The WhatsApp dispatcher sends interactive messages

- Files: `supabase/functions/whatsapp-dispatcher/interactive.ts` (new,
  `toInteractive`, with `interactive_test.ts`),
  `supabase/functions/whatsapp-dispatcher/index.ts` (case `interactive` in
  `outgoingMessageToEndpointMessage`),
  `supabase/functions/_shared/types/whatsapp_endpoint_types.ts`
  (`OutgoingInteractive`, `OutgoingInteractiveMessage`),
  `supabase/functions/_shared/types/message_types.ts`
  (`OutgoingInteractivePart` in `OutgoingMessage`).
- Change: a business row with `content: { version: "1", type: "data", kind:
  "interactive", data }` is sent as Meta's `type: "interactive"` message, `data`
  in the Cloud API's `interactive` shape: reply buttons (`button`, 1-3 buttons,
  title ≤20, unique ids), a list (`list`, button label ≤20, ≤10 sections and ≤10
  rows in all, row title ≤24, description ≤72, unique ids, section titles
  required when there are several) or a call-to-action URL button (`cta_url`).
  Optional text header (≤60) and footer (≤60), body ≤1024. A row that breaks a
  limit fails permanently with the reason in `status.errors` instead of
  reaching Meta. No schema change: `messages_content_schema` already accepts
  `type data` with any kind. The customer's answer already arrives as an
  incoming `interactive` row (`button_reply` / `list_reply`).
- Why: DWESAL's button chatbot sends its menus as reply buttons and lists
  (`CHATBOT_INTERACTIVE=true` on DWESAL's worker once this is deployed); before
  this the dispatcher threw "Cannot convert outgoing message" for them.
  Interactive messages are session messages: Meta refuses them outside the 24 h
  window (131047), as it does free text.
- Upstream candidate: yes; it is the outgoing half of a message kind the core
  already reads.
