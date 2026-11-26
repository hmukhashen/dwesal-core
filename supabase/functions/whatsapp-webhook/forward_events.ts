import type { SupabaseClient } from "@supabase/supabase-js";
import * as log from "../_shared/logger.ts";
import type { Database, Json } from "../_shared/supabase.ts";
import type {
  ForwardedWabaField,
  WebhookValueUserPreferences,
  WebhookValueWabaEvent,
} from "../_shared/types/whatsapp_webhook_payload_types.ts";

// Meta events the core does not act on but an organization's own systems do
// (DWESAL: opt-outs, number quality and tier, template status). They are
// stored as `logs` rows, category = the Meta field, metadata = { waba_id,
// value }, the same shape account_update logs use, so the logs table's
// existing notify_webhook trigger forwards them to the organization's
// webhooks. No new table, trigger or webhook type is needed.

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * A user stopped or resumed marketing messages (Meta's own opt-out). Logged
 * for the organization of the number it arrived on.
 */
export async function forwardUserPreferences(
  client: SupabaseClient<Database>,
  waba_id: string,
  organization_id: string,
  organization_address: string,
  value: WebhookValueUserPreferences,
) {
  const prefs = value.user_preferences ?? [];
  if (!prefs.length) return;
  await client
    .from("logs")
    .insert({
      organization_id,
      organization_address,
      service: "whatsapp",
      category: "user_preferences",
      level: "info",
      message: prefs.map((p) => `${p.category}:${p.value}`).join(","),
      metadata: { waba_id, value } as unknown as Json,
    })
    .throwOnError();
}

/**
 * A WABA-level event (number quality or name, template status, quality or
 * category): logged for the organizations that hold the WABA, as
 * handleAccountUpdate does. A number event also names the account whose
 * phone number it is, when one matches.
 */
export async function forwardWabaEvent(
  client: SupabaseClient<Database>,
  waba_id: string,
  field: ForwardedWabaField,
  value: WebhookValueWabaEvent,
) {
  const { data: rows } = await client
    .from("organizations_addresses")
    .select(
      "organization_id, address, status, phone_number:extra->>phone_number, created_at",
    )
    .eq("service", "whatsapp")
    .eq("extra->>waba_id", waba_id)
    .order("created_at", { ascending: false })
    .throwOnError();

  if (!rows.length) {
    log.warn(`${field}: no organization found for WABA`, { waba_id });
    return;
  }

  const connected = rows.filter((r) => r.status === "connected");
  const holders = new Set(
    (connected.length ? connected : [rows[0]]).map((r) => r.organization_id),
  );
  const phone = digits(value.display_phone_number);

  for (const organization_id of holders) {
    const account = phone
      ? rows.find((r) =>
        r.organization_id === organization_id &&
        digits(r.phone_number) === phone
      )
      : undefined;
    await client
      .from("logs")
      .insert({
        organization_id,
        ...(account
          ? { organization_address: account.address, service: "whatsapp" }
          : { service: "whatsapp" }),
        category: field,
        level: "info",
        message: (value.event ?? field).toString().toLowerCase(),
        metadata: { waba_id, value } as unknown as Json,
      })
      .throwOnError();
  }
}
