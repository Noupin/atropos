provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  api_record_name = var.api_hostname == var.cloudflare_zone_name
    ? "@"
    : replace(var.api_hostname, ".${var.cloudflare_zone_name}", "");
  cors_header_value = join(",", var.cors_allow_origins);
  route_pattern     = "${var.api_hostname}/api/*";
}

resource "cloudflare_workers_kv_namespace" "licensing" {
  account_id = var.cloudflare_account_id
  title      = "licensing-${var.environment}"
}

resource "cloudflare_workers_script" "licensing" {
  account_id = var.cloudflare_account_id
  name       = var.worker_name
  module     = true

  content = <<EOW
export default {
  async fetch() {
    return new Response("licensing worker placeholder", { status: 501 });
  }
};
EOW

  kv_namespace_binding {
    name         = "LICENSING_KV"
    namespace_id = cloudflare_workers_kv_namespace.licensing.id
  }

  plain_text_binding {
    name = "PRICE_ID_MONTHLY"
    text = var.price_id_monthly
  }

  plain_text_binding {
    name = "TIER"
    text = var.tier
  }

  dynamic "plain_text_binding" {
    for_each = {
      for key, value in {
        RETURN_URL_SUCCESS = var.return_url_success
        RETURN_URL_CANCEL  = var.return_url_cancel
        CORS_ALLOW_ORIGINS = local.cors_header_value
      } : key => value if value != null && value != ""
    }

    content {
      name = plain_text_binding.key
      text = plain_text_binding.value
    }
  }

  lifecycle {
    ignore_changes = [content]
  }
}

resource "cloudflare_worker_route" "licensing" {
  zone_id     = var.cloudflare_zone_id
  pattern     = local.route_pattern
  script_name = cloudflare_workers_script.licensing.name
}

resource "cloudflare_record" "licensing_api" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_record_name
  type    = "CNAME"
  value   = "workers.dev"
  proxied = true
  comment = "Managed by Terraform - licensing API"
}
