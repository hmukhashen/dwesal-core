create index messages_org_inbound_timestamp_idx on public.messages using btree (organization_id, "timestamp" desc) where (sender_address is not null);
