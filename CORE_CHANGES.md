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
    the event's `display_phone_number` matches one of its accounts.
  No schema change: the existing `z_notify_webhook_logs` trigger sends each
  row to the organization's webhooks on `logs` insert.
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
  `supabase/functions/whatsapp-management/index.ts` (route),
  `templates.ts` (`getBusinessCredentials` exported).
- Change: `PUT /whatsapp-management/number` with
  `{ organization_id, organization_address }` (key role member or above)
  returns Meta's `verified_name`, `display_phone_number`, `quality_rating`,
  `messaging_limit_tier`, `throughput`, `name_status`, `status` for that number,
  read with the number's token or `META_SYSTEM_USER_ACCESS_TOKEN`; a 400 from
  Meta retries with the basic fields only. RLS on the key's client limits it to
  the organization's own addresses; a disconnected account answers 409.
- Why: the core does not store tier or quality; DWESAL polls them (every 6 h
  and after a quality or name event) to slow down or pause campaigns.
- Upstream candidate: yes.
