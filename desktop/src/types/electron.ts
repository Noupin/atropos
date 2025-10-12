import type { ElectronAPI as BaseElectronAPI } from '@electron-toolkit/preload'
import type { shell } from 'electron'

export type ElectronAPIWithShell = BaseElectronAPI & {
  shell: Pick<typeof shell, 'openExternal'>
}
