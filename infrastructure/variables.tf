variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account identifier"
}

variable "cloudflare_api_token" {
  type        = string
  description = "API token with permission to manage Workers, KV, and DNS"
  sensitive   = true
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Zone identifier for atropos-video.com"
}

variable "cloudflare_zone_name" {
  type        = string
  description = "Zone name (e.g. atropos-video.com)"
}

variable "environment" {
  type        = string
  description = "Deployment environment label (e.g. dev or prod)"
  default     = "dev"
}

variable "api_hostname" {
  type        = string
  description = "FQDN for the licensing API"
  default     = "api.atropos-video.com"
}

variable "worker_name" {
  type        = string
  description = "Cloudflare Worker script name"
  default     = "licensing-api"
}

variable "price_id_monthly" {
  type        = string
  description = "Default Stripe price id for monthly subscriptions"
}

variable "tier" {
  type        = string
  description = "License tier label"
  default     = "pro"
}

variable "return_url_success" {
  type        = string
  description = "Optional customer portal success redirect"
  default     = null
}

variable "return_url_cancel" {
  type        = string
  description = "Optional checkout cancel redirect"
  default     = null
}

variable "cors_allow_origins" {
  type        = list(string)
  description = "List of allowed origins for CORS responses"
  default     = []
}
