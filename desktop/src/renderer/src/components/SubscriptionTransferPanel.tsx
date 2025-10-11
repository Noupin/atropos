import { FormEvent, useMemo, useState } from 'react'
import type { FC } from 'react'
import { timeAgo } from '../lib/format'
import {
  cancelSubscriptionTransfer,
  initiateSubscriptionTransfer,
  type TransferStatePayload
} from '../services/licensing'
import { LicensingRequestError, LicensingOfflineError } from '../services/licensing'

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return '—'
  }
  try {
    const date = new Date(value)
    return `${date.toLocaleString()} (${timeAgo(value)})`
  } catch (error) {
    return value
  }
}

type SubscriptionTransferPanelProps = {
  deviceHash: string | null
  transfer: TransferStatePayload
  isDisabled?: boolean
  canInitiate?: boolean
  disabledMessage?: string | null
  onRefresh: () => Promise<void> | void
}

const buildMailtoUrl = (email: string, link: string, expiresAt: string): string => {
  const subject = 'Transfer your Atropos subscription'
  const expiration = formatTimestamp(expiresAt)
  const lines = [
    'Hi,',
    '',
    'Click the link below to activate your Atropos subscription on this device:',
    '',
    `<${link}>`,
    '',
    `This secure link expires ${expiration}.`,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    '— The Atropos Team'
  ]
  const body = lines.join('\r\n')
  const encodedSubject = encodeURIComponent(subject)
  const encodedBody = encodeURIComponent(body)
  return `mailto:${encodeURIComponent(email)}?subject=${encodedSubject}&body=${encodedBody}`
}

const openMailClient = (email: string, magicLink: string, expiresAt: string): void => {
  const mailtoUrl = buildMailtoUrl(email, magicLink, expiresAt)
  if (window.electron?.shell?.openExternal) {
    void window.electron.shell.openExternal(mailtoUrl)
    return
  }
  window.open(mailtoUrl, '_blank', 'noopener')
}

const SubscriptionTransferPanel: FC<SubscriptionTransferPanelProps> = ({
  deviceHash,
  transfer,
  isDisabled = false,
  canInitiate = true,
  disabledMessage = null,
  onRefresh
}) => {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  const isLocked = transfer.status === 'locked'
  const isPending = transfer.status === 'pending'

  const pendingSummary = useMemo(() => {
    if (!isPending) {
      return null
    }
    return {
      email: transfer.email,
      expiresAt: transfer.expiresAt,
      initiatedAt: transfer.initiatedAt
    }
  }, [isPending, transfer.email, transfer.expiresAt, transfer.initiatedAt])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setMagicLink(null)
    setExpiresAt(null)

    if (!deviceHash) {
      setError('Device identifier unavailable. Restart the app and try again.')
      return
    }
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter an email address to send the transfer link to.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await initiateSubscriptionTransfer(deviceHash, trimmedEmail)
      setMagicLink(response.magicLink)
      setExpiresAt(response.expiresAt)
      setSuccess('Transfer link generated. Your email client will open with the details.')
      openMailClient(trimmedEmail, response.magicLink, response.expiresAt)
      await onRefresh()
    } catch (err) {
      if (err instanceof LicensingOfflineError) {
        setError(err.message)
      } else if (err instanceof LicensingRequestError) {
        if (err.code === 'transfer_pending') {
          setError('A transfer link is already pending. Cancel it before creating a new one.')
        } else if (err.code === 'transfer_locked') {
          setError('Access has already been transferred. Use the active device to move it back.')
        } else {
          setError(err.message)
        }
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to initiate transfer.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    setError(null)
    setSuccess(null)
    setMagicLink(null)
    setExpiresAt(null)

    if (!deviceHash) {
      setError('Device identifier unavailable. Restart the app and try again.')
      return
    }

    setIsCancelling(true)
    try {
      await cancelSubscriptionTransfer(deviceHash)
      setSuccess('Transfer cancelled. Access remains on this device.')
      await onRefresh()
    } catch (err) {
      if (err instanceof LicensingOfflineError) {
        setError(err.message)
      } else if (err instanceof LicensingRequestError) {
        if (err.code === 'transfer_not_pending') {
          setError('No pending transfer was found to cancel.')
        } else {
          setError(err.message)
        }
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to cancel transfer.')
      }
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--fg)]">Transfer subscription to another device</h3>
        <p className="text-xs text-[var(--muted)]">
          Generate a one-time magic link to move your subscription to a different machine. The new device
          becomes active only after this one is deactivated.
        </p>
      </div>
      {isLocked ? (
        <div className="rounded-lg border border-dashed border-white/20 bg-white/5 p-4 text-sm text-[var(--muted)]">
          Access for this device has been transferred to another machine. Use that device to move the
          subscription back if needed.
        </div>
      ) : isPending && pendingSummary ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-[color:color-mix(in_srgb,var(--warning)_20%,transparent)] p-4 text-sm">
          <div>
            Transfer email sent to <span className="font-semibold">{pendingSummary.email ?? '—'}</span>.
          </div>
          <div className="text-xs text-[var(--muted)]">
            Link expires {formatTimestamp(pendingSummary.expiresAt)}. Cancel the transfer if you entered the wrong
            email.
          </div>
          <div>
            <button
              type="button"
              className="marble-button marble-button--outline px-3 py-1.5 text-xs font-semibold"
              onClick={() => {
                void handleCancel()
              }}
              disabled={isCancelling || isDisabled}
            >
              {isCancelling ? 'Cancelling…' : 'Cancel transfer'}
            </button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Recipient email
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
                setSuccess(null)
                setMagicLink(null)
                setExpiresAt(null)
              }}
              placeholder="name@example.com"
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              disabled={isSubmitting || isDisabled || !canInitiate}
            />
          </label>
          <button
            type="submit"
            className="marble-button px-3 py-2 text-sm font-semibold"
            disabled={isSubmitting || isDisabled || !canInitiate}
          >
            {isSubmitting ? 'Preparing link…' : 'Send transfer link'}
          </button>
          {!canInitiate && disabledMessage ? (
            <p className="text-xs font-medium text-[var(--muted)]">{disabledMessage}</p>
          ) : null}
        </form>
      )}
      {magicLink && expiresAt ? (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-[var(--muted)]">
          <div className="font-semibold text-[var(--fg)]">Magic link</div>
          <code className="break-all rounded bg-black/30 px-2 py-1 text-[var(--fg)]">{magicLink}</code>
          <div>Link expires {formatTimestamp(expiresAt)}.</div>
        </div>
      ) : null}
      {success ? <p className="text-xs font-medium text-[color:var(--success-strong)]">{success}</p> : null}
      {error ? <p className="text-xs font-medium text-[color:var(--error-strong)]">{error}</p> : null}
    </div>
  )
}

export default SubscriptionTransferPanel
