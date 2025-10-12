import { useState } from 'react'
import type { FC } from 'react'

const Versions: FC = () => {
  type VersionMap = Record<string, string | undefined>

  const resolveVersions = (): VersionMap => {
    const electronVersions = window.electron?.process?.versions
    if (electronVersions) {
      return electronVersions
    }
    return process.versions as VersionMap
  }

  const [versions] = useState<VersionMap>(resolveVersions)

  return (
    <ul className="versions">
      <li className="electron-version">Electron v{versions.electron}</li>
      <li className="chrome-version">Chromium v{versions.chrome}</li>
      <li className="node-version">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
