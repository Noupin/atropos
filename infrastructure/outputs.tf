output "licensing_api_base_url" {
  description = "Base URL for the licensing API"
  value       = "https://${var.api_hostname}"
}

output "users_kv_namespace_id" {
  description = "Cloudflare KV namespace id for licensing user records"
  value       = cloudflare_workers_kv_namespace.licensing_users.id
}

output "subscriptions_kv_namespace_id" {
  description = "Cloudflare KV namespace id for subscription snapshots"
  value       = cloudflare_workers_kv_namespace.licensing_subscriptions.id
}

output "transfers_kv_namespace_id" {
  description = "Cloudflare KV namespace id for device transfer state"
  value       = cloudflare_workers_kv_namespace.licensing_transfers.id
}
