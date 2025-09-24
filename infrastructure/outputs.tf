output "licensing_api_base_url" {
  description = "Base URL for the licensing API"
  value       = "https://${var.api_hostname}"
}

output "kv_namespace_id" {
  description = "Cloudflare KV namespace id for licensing state"
  value       = cloudflare_workers_kv_namespace.licensing.id
}
