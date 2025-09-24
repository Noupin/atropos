export interface SerializableRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpRequestPayload {
  url: string
  init?: SerializableRequestInit
}

export interface HttpResponsePayload {
  ok: boolean
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
}
