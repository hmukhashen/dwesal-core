# Changes to upstream OpenBSP

`hmukhashen/dwesal-core` is a fork of `matiasbattocchia/open-bsp-api`, the
WhatsApp core of DWESAL. Keep pulling upstream; every local change is listed
here with why, so it can be dropped once upstream has an equivalent.

## Template management falls back to the system user token

- File: `supabase/functions/whatsapp-management/templates.ts`
  (`getBusinessCredentials`).
- Change: when the number's `organizations_addresses.extra.access_token` is
  empty, use `META_SYSTEM_USER_ACCESS_TOKEN`.
- Why: DWESAL registers numbers that are already on the platform's Meta app
  the way the README's "For any number you add" describes, without a
  per-number token. `whatsapp-dispatcher` already falls back to the system
  user token for sending, but listing, creating, editing and deleting
  templates sent `Bearer null` to Meta and failed.
- Upstream candidate: yes, it mirrors the dispatcher's existing behaviour.
