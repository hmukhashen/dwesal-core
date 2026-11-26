import type { Database } from "../_shared/supabase.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HTTPException } from "jsr:@hono/hono/http-exception";
import { ContentfulStatusCode } from "jsr:@hono/hono/utils/http-status";
import { getBusinessCredentials } from "./templates.ts";

const API_VERSION = "v24.0";

// Fields of the phone number Meta reports. Older apps or numbers may refuse
// some of them, so a refusal falls back to the fields every number has.
const FULL_FIELDS =
  "verified_name,display_phone_number,quality_rating,messaging_limit_tier,throughput,name_status,status";
const BASIC_FIELDS = "verified_name,display_phone_number,quality_rating";

export type NumberHealth = {
  id?: string;
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  throughput?: { level?: string };
  name_status?: string;
  status?: string;
};

/**
 * Meta's current view of one of the organization's numbers (quality rating,
 * messaging limit tier, verified name), read with the number's token or the
 * system user's. The organization's own systems poll it to slow down or stop
 * sending when quality drops, since the core does not store these.
 */
export async function fetchNumberHealth(
  client: SupabaseClient<Database>,
  organization_id: string,
  organization_address: string,
): Promise<NumberHealth> {
  const { access_token } = await getBusinessCredentials(
    client,
    organization_id,
    organization_address,
  );

  const get = (fields: string) =>
    fetch(
      `https://graph.facebook.com/${API_VERSION}/${organization_address}?fields=${fields}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

  let response = await get(FULL_FIELDS);
  if (response.status === 400) response = await get(BASIC_FIELDS);

  if (!response.ok) {
    throw new HTTPException(response.status as ContentfulStatusCode, {
      message: "Could not fetch the phone number",
      cause: await response.json().catch(() => ({})),
    });
  }

  return await response.json();
}
