import { useCallback } from 'react'

type RendererApi = {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export const useIpc = () => {
  const invoke = useCallback(
    (channel: string, ...args: unknown[]) => {
      const api = (window as typeof window & { api?: RendererApi }).api
      if (api?.invoke) {
        return api.invoke(channel, ...args)
      }

      return Promise.resolve(undefined)
    },
    []
  )

  return { invoke }
}
