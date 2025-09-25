provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  api_record_name = var.api_hostname == var.cloudflare_zone_name ? "@" : replace(var.api_hostname, ".${var.cloudflare_zone_name}", "")
  cors_header_value = join(",", var.cors_allow_origins)
  route_pattern     = "${var.api_hostname}/*"
}

resource "cloudflare_workers_kv_namespace" "licensing_users" {
  account_id = var.cloudflare_account_id
  title      = "licensing-users-${var.environment}"
}

resource "cloudflare_workers_kv_namespace" "licensing_subscriptions" {
  account_id = var.cloudflare_account_id
  title      = "licensing-subscriptions-${var.environment}"
}

resource "cloudflare_workers_kv_namespace" "licensing_transfers" {
  account_id = var.cloudflare_account_id
  title      = "licensing-transfers-${var.environment}"
}

resource "cloudflare_workers_script" "licensing" {
  account_id  = var.cloudflare_account_id
  script_name = var.worker_name

  # Minimal module content; actual code will be deployed by Wrangler later.
  main_module = "index.mjs"
  content     = <<EOW
export default {
  async fetch() {
    return new Response("licensing worker placeholder", { status: 501 });
  }
}
EOW

  # v5 uses a top-level 'bindings' array instead of nested *_binding blocks.
  bindings = concat(
    [
      {
        type         = "kv_namespace"
        name         = "USERS_KV"
        namespace_id = cloudflare_workers_kv_namespace.licensing_users.id
      },
      {
        type         = "kv_namespace"
        name         = "SUBSCRIPTIONS_KV"
        namespace_id = cloudflare_workers_kv_namespace.licensing_subscriptions.id
      },
      {
        type         = "kv_namespace"
        name         = "TRANSFERS_KV"
        namespace_id = cloudflare_workers_kv_namespace.licensing_transfers.id
      },
      {
        type = "plain_text"
        name = "TIER"
        text = var.tier
      }
    ],
    var.return_url_success != null && var.return_url_success != "" ? [
      { type = "plain_text", name = "RETURN_URL_SUCCESS", text = var.return_url_success }
    ] : [],
    var.return_url_cancel != null && var.return_url_cancel != "" ? [
      { type = "plain_text", name = "RETURN_URL_CANCEL", text = var.return_url_cancel }
    ] : [],
    local.cors_header_value != "" ? [
      { type = "plain_text", name = "CORS_ALLOW_ORIGINS", text = local.cors_header_value }
    ] : []
  )
}

resource "cloudflare_workers_route" "licensing" {
  zone_id     = var.cloudflare_zone_id
  pattern     = local.route_pattern
  script = cloudflare_workers_script.licensing.id
}

resource "cloudflare_dns_record" "licensing_api" {
  zone_id = var.cloudflare_zone_id
  name    = var.api_hostname        # v5 expects the full record name, e.g., api.atropos-video.com
  type    = "A"
  content = "192.0.2.1"             # dummy origin for proxied route
  proxied = true
  ttl     = 1
  comment = "Managed by Terraform - licensing API"
}
