import { useCallback, useEffect, useRef } from 'react'

import { buildJobClipVideoUrl } from '../config/backend'
import {
  createInitialPipelineSteps,
  PIPELINE_STEP_DEFINITIONS,
  resolvePipelineLocation
} from '../data/pipeline'
import {
  normaliseJobClip,
  killPipelineJob,
  resumePipelineJob,
  startPipelineJob,
  subscribeToPipelineEvents,
  type PipelineEventMessage
} from '../services/pipelineApi'
import type { AccountSummary, HomePipelineState } from '../types'

type UsePipelineProgressOptions = {
  state: HomePipelineState
  setState: React.Dispatch<React.SetStateAction<HomePipelineState>>
  availableAccounts: AccountSummary[]
  markTrialRunPending: () => void
  finalizeTrialRun: (options: { succeeded: boolean }) => Promise<void>
  isTrialActive: boolean
  hasPendingTrialRun: boolean
  isMockBackend: boolean
  onFirstClipReady?: (details: { jobId: string }) => void
  onPipelineFinished?: (details: { jobId: string; success: boolean; producedClips: number }) => void
}

type UsePipelineProgressResult = {
  startPipeline: (url: string, accountId: string, reviewMode: boolean) => Promise<void>
  resumePipeline: () => Promise<void>
  killPipeline: () => Promise<void>
  cleanup: () => void
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const parseNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }
  const bounded = Math.floor(value)
  return bounded >= 0 ? bounded : 0
}

export const usePipelineProgress = ({
  state,
  setState,
  availableAccounts,
  markTrialRunPending,
  finalizeTrialRun,
  isTrialActive,
  hasPendingTrialRun,
  isMockBackend,
  onFirstClipReady,
  onPipelineFinished
}: UsePipelineProgressOptions): UsePipelineProgressResult => {
  const connectionCleanupRef = useRef<(() => void) | null>(null)
  const subscribedJobIdRef = useRef<string | null>(null)
  const activeJobIdRef = useRef<string | null>(state.activeJobId ?? null)
  const trialFlagsRef = useRef({ isTrialActive, hasPendingTrialRun })
  const firstClipHandledRef = useRef(false)
  const finalizeTriggeredRef = useRef(false)
  const onFirstClipReadyRef = useRef<((details: { jobId: string }) => void) | null>(
    onFirstClipReady ?? null
  )
  const onPipelineFinishedRef = useRef<
    ((details: { jobId: string; success: boolean; producedClips: number }) => void) | null
  >(onPipelineFinished ?? null)

  useEffect(() => {
    activeJobIdRef.current = state.activeJobId ?? null
  }, [state.activeJobId])

  useEffect(() => {
    trialFlagsRef.current = { isTrialActive, hasPendingTrialRun }
  }, [hasPendingTrialRun, isTrialActive])

  useEffect(() => {
    onFirstClipReadyRef.current = onFirstClipReady ?? null
  }, [onFirstClipReady])

  useEffect(() => {
    onPipelineFinishedRef.current = onPipelineFinished ?? null
  }, [onPipelineFinished])

  const updateState = useCallback(
    (updater: (prev: HomePipelineState) => HomePipelineState) => {
      setState((prev) => {
        const next = updater(prev)
        return next
      })
    },
    [setState]
  )

  const cleanupConnection = useCallback(() => {
    const cleanup = connectionCleanupRef.current
    if (cleanup) {
      cleanup()
      connectionCleanupRef.current = null
      subscribedJobIdRef.current = null
    }
  }, [])

  const handlePipelineEvent = useCallback(
    (event: PipelineEventMessage) => {
      if (event.type === 'pipeline_started') {
        firstClipHandledRef.current = false
        finalizeTriggeredRef.current = false
        if (trialFlagsRef.current.isTrialActive) {
          markTrialRunPending()
        }
        updateState((prev) => ({
          ...prev,
          steps: createInitialPipelineSteps(),
          pipelineError: null,
          isProcessing: true,
          lastRunProducedNoClips: false,
          lastRunClipSummary: null,
          lastRunClipStatus: null
        }))
        return
      }

      if (event.type === 'step_progress') {
        const location = resolvePipelineLocation(event.step)
        if (!location || typeof event.data?.progress !== 'number') {
          return
        }
        const progressValue = clamp01(event.data.progress)
        const completedValue =
          typeof event.data.completed === 'number' ? Math.max(0, event.data.completed) : null
        const totalValue = typeof event.data.total === 'number' ? Math.max(0, event.data.total) : null
        const rawEta =
          typeof event.data.eta_seconds === 'number'
            ? event.data.eta_seconds
            : typeof event.data.eta === 'number'
              ? event.data.eta
              : null
        const etaValue = rawEta !== null && Number.isFinite(rawEta) && rawEta >= 0 ? rawEta : null

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step) => {
            if (location.kind === 'step') {
              if (step.id !== location.stepId) {
                return step
              }

              const nextClipProgress = step.clipStage
                ? {
                    completed:
                      completedValue !== null
                        ? completedValue
                        : step.clipProgress?.completed ?? 0,
                    total: totalValue !== null ? totalValue : step.clipProgress?.total ?? 0
                  }
                : step.clipProgress

              if (step.status === 'completed') {
                return { ...step, clipProgress: nextClipProgress, etaSeconds: null }
              }

              return {
                ...step,
                status: 'running',
                progress: progressValue,
                clipProgress: nextClipProgress,
                etaSeconds: etaValue
              }
            }

            if (step.id !== location.stepId) {
              return step
            }

            return {
              ...step,
              status: step.status === 'pending' ? 'running' : step.status,
              substeps: step.substeps.map((substep) => {
                if (substep.id !== location.substepId) {
                  return substep
                }

                const totalClips = totalValue !== null ? totalValue : substep.totalClips
                const boundedTotal = Math.max(0, totalClips)

                if (location.clipIndex !== null) {
                  const clipPosition =
                    boundedTotal > 0
                      ? Math.min(boundedTotal, Math.max(1, location.clipIndex))
                      : Math.max(1, location.clipIndex)
                  const previousCompleted = substep.completedClips
                  const rawCompleted =
                    completedValue !== null ? Math.max(0, completedValue) : previousCompleted
                  let boundedCompleted =
                    boundedTotal > 0 ? Math.min(boundedTotal, rawCompleted) : rawCompleted
                  if (progressValue >= 1) {
                    boundedCompleted = Math.max(boundedCompleted, clipPosition)
                  }
                  const allDone =
                    (boundedTotal === 0 && totalValue !== null) ||
                    (boundedTotal > 0 && boundedCompleted >= boundedTotal)

                  return {
                    ...substep,
                    status: allDone ? 'completed' : 'running',
                    progress: progressValue,
                    etaSeconds: etaValue,
                    completedClips: boundedCompleted,
                    totalClips: boundedTotal,
                    activeClipIndex: allDone ? null : clipPosition
                  }
                }

                const previousCompleted = substep.completedClips
                const rawCompleted =
                  completedValue !== null ? Math.max(0, completedValue) : previousCompleted
                const boundedCompleted =
                  boundedTotal > 0 ? Math.min(boundedTotal, rawCompleted) : rawCompleted
                const progressed = boundedCompleted > previousCompleted
                const allDone =
                  (boundedTotal === 0 && totalValue !== null) ||
                  (boundedTotal > 0 && boundedCompleted >= boundedTotal)

                const nextStatus = allDone
                  ? 'completed'
                  : substep.status === 'pending' && !progressed && previousCompleted === 0
                    ? substep.status
                    : 'running'

                const nextProgress = allDone ? 1 : progressed ? 0 : substep.progress

                const nextActiveClipIndex = allDone
                  ? null
                  : totalValue !== null && boundedTotal > 0
                    ? Math.min(boundedTotal, boundedCompleted + 1)
                    : substep.activeClipIndex

                return {
                  ...substep,
                  status: nextStatus,
                  progress: nextProgress,
                  etaSeconds: etaValue,
                  completedClips: boundedCompleted,
                  totalClips: boundedTotal,
                  activeClipIndex: nextActiveClipIndex
                }
              })
            }
          })
        }))
        return
      }

      if (
        event.type === 'step_started' ||
        event.type === 'step_completed' ||
        event.type === 'step_failed'
      ) {
        const location = resolvePipelineLocation(event.step)
        if (!location) {
          return
        }
        const targetIndex = PIPELINE_STEP_DEFINITIONS.findIndex(
          (definition) => definition.id === location.stepId
        )
        if (targetIndex === -1) {
          return
        }

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step, index) => {
            const shouldForceCompleted = index < targetIndex && step.status !== 'completed'

            if (location.kind === 'step') {
              if (shouldForceCompleted) {
                return { ...step, status: 'completed', progress: 1, etaSeconds: null }
              }
              if (step.id === location.stepId) {
                if (event.type === 'step_started') {
                  return { ...step, status: 'running', progress: 0, etaSeconds: null }
                }
                if (event.type === 'step_completed') {
                  return { ...step, status: 'completed', progress: 1, etaSeconds: null }
                }
                return { ...step, status: 'failed', progress: 1, etaSeconds: null }
              }
              return step
            }

            if (shouldForceCompleted) {
              return { ...step, status: 'completed', progress: 1, etaSeconds: null }
            }

            if (step.id !== location.stepId) {
              return step
            }

            const clipPosition =
              location.kind === 'substep' && location.clipIndex !== null
                ? Math.max(1, location.clipIndex)
                : null

            const updatedSubsteps = step.substeps.map((substep) => {
              if (substep.id === location.substepId) {
                if (event.type === 'step_started') {
                  const nextActiveClip =
                    clipPosition ?? substep.activeClipIndex ?? Math.max(1, substep.completedClips + 1)
                  return {
                    ...substep,
                    status: 'running',
                    progress: 0,
                    etaSeconds: null,
                    activeClipIndex: nextActiveClip
                  }
                }
                if (event.type === 'step_completed') {
                  const targetClipIndex = clipPosition ?? location.clipIndex
                  const boundedTotal = Math.max(0, substep.totalClips)
                  const rawCompleted =
                    targetClipIndex !== null
                      ? Math.max(substep.completedClips, targetClipIndex)
                      : substep.completedClips
                  const completedClips =
                    boundedTotal > 0 ? Math.min(boundedTotal, rawCompleted) : rawCompleted
                  const allDone = boundedTotal > 0 && completedClips >= boundedTotal
                  return {
                    ...substep,
                    status: allDone ? 'completed' : 'running',
                    progress: 1,
                    etaSeconds: null,
                    completedClips,
                    activeClipIndex: allDone ? null : clipPosition ?? substep.activeClipIndex
                  }
                }
                return {
                  ...substep,
                  status: 'failed',
                  etaSeconds: null,
                  progress: 1,
                  activeClipIndex: clipPosition ?? substep.activeClipIndex
                }
              }

              if (event.type === 'step_started' && clipPosition !== null) {
                const boundedTotal = Math.max(0, substep.totalClips)
                const completedClips = Math.max(0, substep.completedClips)
                const allDone = boundedTotal > 0 && completedClips >= boundedTotal
                if (!allDone && completedClips < clipPosition) {
                  const nextActiveClip =
                    boundedTotal > 0 ? Math.min(boundedTotal, clipPosition) : clipPosition
                  return {
                    ...substep,
                    status: 'pending',
                    progress: 0,
                    etaSeconds: null,
                    activeClipIndex: nextActiveClip
                  }
                }
              }

              return substep
            })

            const allCompleted =
              updatedSubsteps.length > 0 &&
              updatedSubsteps.every((substep) => substep.status === 'completed')

            if (event.type === 'step_failed') {
              return {
                ...step,
                status: 'failed',
                progress: 1,
                etaSeconds: null,
                substeps: updatedSubsteps
              }
            }

            if (event.type === 'step_completed' && allCompleted) {
              return {
                ...step,
                status: 'completed',
                progress: 1,
                etaSeconds: null,
                substeps: updatedSubsteps
              }
            }

            if (event.type === 'step_started' && step.status === 'pending') {
              return {
                ...step,
                status: 'running',
                substeps: updatedSubsteps
              }
            }

            return { ...step, substeps: updatedSubsteps }
          })
        }))

        if (event.type === 'step_failed') {
          updateState((prev) => ({
            ...prev,
            pipelineError: event.message ?? 'Pipeline step failed.'
          }))
        }
        return
      }

      if (event.type === 'log') {
        const statusValue =
          event.data && typeof event.data === 'object'
            ? (event.data as Record<string, unknown>).status
            : null
        if (statusValue === 'waiting_for_review') {
          updateState((prev) => ({ ...prev, awaitingReview: true }))
        }
        return
      }

      if (event.type === 'clip_ready') {
        const jobId = activeJobIdRef.current
        const data = event.data ?? {}
        if (!jobId || typeof data !== 'object') {
          return
        }

        const payload = data as Record<string, unknown>
        const clipId = typeof payload.clip_id === 'string' ? payload.clip_id : null
        const description = typeof payload.description === 'string' ? payload.description : null
        const durationValue = typeof payload.duration_seconds === 'number' ? payload.duration_seconds : null
        const createdAt = typeof payload.created_at === 'string' ? payload.created_at : null
        const sourceUrl = typeof payload.source_url === 'string' ? payload.source_url : null
        const sourceTitle = typeof payload.source_title === 'string' ? payload.source_title : null

        if (!clipId || !description || !createdAt || durationValue === null || !sourceUrl || !sourceTitle) {
          return
        }

        const playbackUrl = buildJobClipVideoUrl(jobId, clipId)
        const manifestPayload: Record<string, unknown> = {
          ...payload,
          id: clipId,
          playback_url: playbackUrl,
          description,
          duration_seconds: durationValue,
          created_at: createdAt,
          source_url: sourceUrl,
          source_title: sourceTitle
        }

        const incomingClip = normaliseJobClip(manifestPayload)
        if (!incomingClip) {
          return
        }

        updateState((prev) => {
          const existingIndex = prev.clips.findIndex((clip) => clip.id === incomingClip.id)
          const mergedClips =
            existingIndex === -1
              ? [...prev.clips, incomingClip]
              : prev.clips.map((clip, index) => (index === existingIndex ? incomingClip : clip))

          mergedClips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

          const hasSelection = mergedClips.some((clip) => clip.id === prev.selectedClipId)
          return {
            ...prev,
            clips: mergedClips,
            selectedClipId: hasSelection ? prev.selectedClipId : mergedClips[0]?.id ?? null,
            lastRunProducedNoClips: false,
            lastRunClipSummary: null,
            lastRunClipStatus: null
          }
        })

        if (!firstClipHandledRef.current) {
          firstClipHandledRef.current = true
          if (!finalizeTriggeredRef.current && trialFlagsRef.current.hasPendingTrialRun) {
            finalizeTriggeredRef.current = true
            void finalizeTrialRun({ succeeded: true })
            const callback = onFirstClipReadyRef.current
            if (callback) {
              callback({ jobId })
            }
          }
        }

        return
      }

      if (event.type === 'pipeline_completed') {
        const successValue = event.data?.success
        const success = typeof successValue === 'boolean' ? successValue : true
        const errorValue = event.data?.error
        const errorMessage =
          typeof errorValue === 'string'
            ? errorValue
            : typeof event.message === 'string'
              ? event.message
              : null

        const rawData =
          event.data && typeof event.data === 'object'
            ? (event.data as Record<string, unknown>)
            : null
        const expectedFromEvent =
          rawData !== null
            ? parseNonNegativeInt(
                rawData['clips_expected'] ??
                  rawData['clips_processed'] ??
                  rawData['total_clips'] ??
                  null
              )
            : null
        const renderedFromEvent =
          rawData !== null
            ? parseNonNegativeInt(
                rawData['clips_rendered'] ??
                  rawData['clips_available'] ??
                  rawData['clips_processed'] ??
                  null
              )
            : null

        let producedClipCount = 0

        updateState((prev) => {
          const stateClipCount = prev.clips.length
          const resolvedRenderedCount =
            renderedFromEvent !== null ? Math.max(renderedFromEvent, stateClipCount) : stateClipCount
          const clipProgressTotal = parseNonNegativeInt(
            prev.steps.find((step) => step.id === 'produce-clips')?.clipProgress?.total
          )
          let resolvedExpectedCount =
            expectedFromEvent !== null
              ? Math.max(expectedFromEvent, resolvedRenderedCount)
              : resolvedRenderedCount
          if (clipProgressTotal !== null) {
            resolvedExpectedCount = Math.max(resolvedExpectedCount, clipProgressTotal)
          }

          producedClipCount = resolvedRenderedCount
          const clipStatus: HomePipelineState['lastRunClipStatus'] =
            success && resolvedRenderedCount === 0
              ? resolvedExpectedCount > 0
                ? 'rendered_none'
                : 'none_to_render'
              : null
          const clipSummary = clipStatus
            ? { expected: resolvedExpectedCount, rendered: resolvedRenderedCount }
            : null

          return {
            ...prev,
            pipelineError: success ? null : errorMessage ?? 'Pipeline failed.',
            isProcessing: false,
            awaitingReview: false,
            steps: prev.steps.map((step) => {
              if (success) {
                if (step.status === 'completed' || step.status === 'failed') {
                  return { ...step, etaSeconds: null }
                }
                return { ...step, status: 'completed', progress: 1, etaSeconds: null }
              }
              if (step.status === 'completed' || step.status === 'failed') {
                return { ...step, etaSeconds: null }
              }
              return { ...step, status: 'failed', progress: 1, etaSeconds: null }
            }),
            lastRunProducedNoClips: success && resolvedRenderedCount === 0,
            lastRunClipSummary: clipSummary,
            lastRunClipStatus: clipStatus
          }
        })
        cleanupConnection()
        const jobId = activeJobIdRef.current
        if (!finalizeTriggeredRef.current && trialFlagsRef.current.hasPendingTrialRun) {
          finalizeTriggeredRef.current = true
          void finalizeTrialRun({ succeeded: success })
        }
        const finishedCallback = onPipelineFinishedRef.current
        if (finishedCallback && jobId) {
          finishedCallback({ jobId, success, producedClips: producedClipCount })
        }
      }
    },
    [cleanupConnection, finalizeTrialRun, markTrialRunPending, updateState]
  )

  const subscribeToJob = useCallback(
    (jobId: string) => {
      if (!jobId || isMockBackend) {
        return
      }

      if (subscribedJobIdRef.current === jobId && connectionCleanupRef.current) {
        return
      }

      cleanupConnection()
      let unsubscribe: (() => void) | null = null
      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe()
          unsubscribe = null
        }
      }

      connectionCleanupRef.current = cleanup
      subscribedJobIdRef.current = jobId

      unsubscribe = subscribeToPipelineEvents(jobId, {
        onEvent: handlePipelineEvent,
        onError: (error) => {
          updateState((prev) => ({
            ...prev,
            pipelineError: error.message,
            isProcessing: false,
            lastRunProducedNoClips: false,
            lastRunClipSummary: null,
            lastRunClipStatus: null
          }))
          cleanupConnection()
        },
        onClose: () => {
          if (connectionCleanupRef.current === cleanup) {
            connectionCleanupRef.current = null
            subscribedJobIdRef.current = null
          }
        }
      })
    },
    [cleanupConnection, handlePipelineEvent, isMockBackend, updateState]
  )

  useEffect(() => {
    if (!state.activeJobId || isMockBackend) {
      return undefined
    }

    subscribeToJob(state.activeJobId)

    return () => {
      cleanupConnection()
    }
  }, [cleanupConnection, isMockBackend, state.activeJobId, subscribeToJob])

  const startPipeline = useCallback(
    async (url: string, accountId: string, reviewMode: boolean) => {
      if (isMockBackend) {
        return
      }

      if (hasPendingTrialRun) {
        updateState((prev) => ({
          ...prev,
          pipelineError: 'Finish your current trial run before starting a new video.',
          isProcessing: false
        }))
        return
      }

      updateState((prev) => ({
        ...prev,
        isProcessing: true,
        pipelineError: null,
        awaitingReview: false,
        lastRunProducedNoClips: false,
        lastRunClipSummary: null,
        lastRunClipStatus: null
      }))

      cleanupConnection()
      firstClipHandledRef.current = false
      finalizeTriggeredRef.current = false

      try {
        const toneOverride = availableAccounts.find((account) => account.id === accountId)?.tone ?? null
        const { jobId } = await startPipelineJob({
          url,
          account: accountId,
          tone: toneOverride,
          reviewMode
        })
        activeJobIdRef.current = jobId
        updateState((prev) => ({ ...prev, activeJobId: jobId, awaitingReview: false }))
        if (isTrialActive) {
          markTrialRunPending()
        }
        subscribeToJob(jobId)
      } catch (error) {
        updateState((prev) => ({
          ...prev,
          pipelineError: error instanceof Error ? error.message : 'Unable to start the pipeline.',
          isProcessing: false,
          lastRunProducedNoClips: false,
          lastRunClipSummary: null,
          lastRunClipStatus: null
        }))
      }
    },
    [
      availableAccounts,
      cleanupConnection,
      hasPendingTrialRun,
      isMockBackend,
      isTrialActive,
      markTrialRunPending,
      subscribeToJob,
      updateState
    ]
  )

  const resumePipeline = useCallback(async () => {
    const jobId = activeJobIdRef.current
    if (!jobId || isMockBackend) {
      return
    }
    try {
      await resumePipelineJob(jobId)
      updateState((prev) => ({ ...prev, awaitingReview: false }))
    } catch (error) {
      updateState((prev) => ({
        ...prev,
        pipelineError:
          error instanceof Error ? error.message : 'Unable to resume the pipeline. Try again shortly.'
      }))
    }
  }, [isMockBackend, updateState])

  const killPipeline = useCallback(async () => {
    const jobId = activeJobIdRef.current
    if (!jobId || isMockBackend) {
      return
    }
    try {
      const result = await killPipelineJob(jobId)
      const nextMessage = result.message ?? (result.killed ? 'Pipeline cancelled.' : null)
      updateState((prev) => ({
        ...prev,
        isProcessing: false,
        awaitingReview: false,
        pipelineError: nextMessage ?? prev.pipelineError
      }))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to stop the pipeline. Try again shortly.'
      updateState((prev) => ({
        ...prev,
        pipelineError: message
      }))
      throw error instanceof Error ? error : new Error(message)
    }
  }, [isMockBackend, updateState])

  return {
    startPipeline,
    resumePipeline,
    killPipeline,
    cleanup: cleanupConnection
  }
}

export default usePipelineProgress
