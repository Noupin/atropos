terraform {
  required_version = ">= 1.3.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID where Workers and KV are managed."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for atropos-video.com."
  type        = string
}

variable "zone_name" {
  description = "Cloudflare zone name (e.g., atropos-video.com)."
  type        = string
}

locals {
  environments = {
    dev = {
      kv_title    = "licensing_dev"
      script_name = "license-api-dev"
      hostname    = "dev.api.atropos-video.com"
      base_url    = "https://dev.api.atropos-video.com"
    }
    prod = {
      kv_title    = "licensing_prod"
      script_name = "license-api"
      hostname    = "api.atropos-video.com"
      base_url    = "https://api.atropos-video.com"
    }
  }
}

resource "cloudflare_workers_kv_namespace" "licensing" {
  for_each = local.environments

  account_id = var.cloudflare_account_id
  title      = each.value.kv_title

  # Cloudflare KV is eventually consistent; writes may take time to propagate globally.
}

resource "cloudflare_record" "license_api" {
  for_each = local.environments

  zone_id = var.cloudflare_zone_id
  name    = replace(each.value.hostname, format(".%s", var.zone_name), "")
  type    = "CNAME"
  content = "workers.dev.cloudflare.com"
  proxied = true
  ttl     = 1
}

resource "cloudflare_workers_route" "license_api" {
  for_each = local.environments

  zone_id = var.cloudflare_zone_id
  pattern = "${each.value.hostname}/*"
  script_name  = each.value.script_name
}

output "licensing_dev_kv_namespace_id" {
  description = "ID of the dev licensing KV namespace."
  value       = cloudflare_workers_kv_namespace.licensing["dev"].id
}

output "licensing_prod_kv_namespace_id" {
  description = "ID of the prod licensing KV namespace."
  value       = cloudflare_workers_kv_namespace.licensing["prod"].id
}

output "licensing_dev_api_base_url" {
  description = "Base URL for the dev licensing API."
  value       = local.environments.dev.base_url
}

output "licensing_prod_api_base_url" {
  description = "Base URL for the prod licensing API."
  value       = local.environments.prod.base_url
}
