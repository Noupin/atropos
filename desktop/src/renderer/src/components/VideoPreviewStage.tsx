import type { FC, ReactNode } from 'react'

type VideoPreviewStageProps = {
  children: ReactNode
  className?: string
  height?: string
}

const DEFAULT_HEIGHT = 'clamp(240px, 70vh, 720px)'

const VideoPreviewStage: FC<VideoPreviewStageProps> = ({ children, className, height = DEFAULT_HEIGHT }) => {
  const composedClassName = [
    'relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={composedClassName} style={{ height }}>
      {children}
    </div>
  )
}

export default VideoPreviewStage
