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
