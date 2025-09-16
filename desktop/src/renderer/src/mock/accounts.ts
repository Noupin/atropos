import type { AccountProfile } from '../types'

const SAMPLE_VIDEO_FLOWERS = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const SAMPLE_VIDEO_OCEAN = 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4'
const SAMPLE_VIDEO_CITY = 'https://samplelib.com/lib/preview/mp4/sample-10s.mp4'

export const PROFILE_ACCOUNTS: AccountProfile[] = [
  {
    id: 'account-creator-hub',
    displayName: 'Creator Hub',
    initials: 'CH',
    description: 'Flagship team covering long-form and short-form programming.',
    platforms: [
      {
        id: 'creator-hub-youtube',
        name: 'YouTube Channel',
        status: 'active',
        statusMessage: 'Token refreshed 2 hours ago',
        dailyUploadTarget: 2,
        readyVideos: 12,
        upcomingUploads: [
          {
            id: 'yt-1',
            title: 'Behind the Scenes: Editing Workflow',
            videoUrl: SAMPLE_VIDEO_FLOWERS,
            scheduledFor: '2025-05-04T14:00:00Z',
            durationSec: 62
          },
          {
            id: 'yt-2',
            title: 'Creator Q&A: May Highlights',
            videoUrl: SAMPLE_VIDEO_OCEAN,
            scheduledFor: '2025-05-05T16:30:00Z',
            durationSec: 75
          },
          {
            id: 'yt-3',
            title: 'Short Form Tips for YouTube',
            videoUrl: SAMPLE_VIDEO_CITY,
            scheduledFor: '2025-05-06T18:15:00Z',
            durationSec: 48
          }
        ]
      },
      {
        id: 'creator-hub-tiktok',
        name: 'TikTok',
        status: 'expiring',
        statusMessage: 'Refresh recommended - expires in 3 days',
        dailyUploadTarget: 1,
        readyVideos: 5,
        upcomingUploads: [
          {
            id: 'tt-1',
            title: '60-Second Recap',
            videoUrl: SAMPLE_VIDEO_OCEAN,
            scheduledFor: '2025-05-04T20:00:00Z',
            durationSec: 59
          },
          {
            id: 'tt-2',
            title: 'Creator Challenge Teaser',
            videoUrl: SAMPLE_VIDEO_FLOWERS,
            scheduledFor: '2025-05-05T18:00:00Z',
            durationSec: 45
          }
        ]
      }
    ]
  },
  {
    id: 'account-brand-studio',
    displayName: 'Brand Studio',
    initials: 'BS',
    description: 'Campaign-specific channels managed by the brand partnerships team.',
    platforms: [
      {
        id: 'brand-studio-instagram',
        name: 'Instagram Reels',
        status: 'disconnected',
        statusMessage: 'Re-authentication required to publish',
        dailyUploadTarget: 1,
        readyVideos: 2,
        upcomingUploads: [
          {
            id: 'ig-1',
            title: 'Brand Story Reel',
            videoUrl: SAMPLE_VIDEO_FLOWERS,
            scheduledFor: '2025-05-07T15:45:00Z',
            durationSec: 52
          }
        ]
      },
      {
        id: 'brand-studio-facebook',
        name: 'Facebook Page',
        status: 'active',
        statusMessage: 'Connected via Business Manager',
        dailyUploadTarget: 1,
        readyVideos: 4,
        upcomingUploads: [
          {
            id: 'fb-1',
            title: 'Product Launch Livestream Replay',
            videoUrl: SAMPLE_VIDEO_CITY,
            scheduledFor: '2025-05-05T12:30:00Z',
            durationSec: 90
          },
          {
            id: 'fb-2',
            title: 'Community Spotlight',
            videoUrl: SAMPLE_VIDEO_FLOWERS,
            scheduledFor: '2025-05-06T10:15:00Z',
            durationSec: 54
          }
        ]
      }
    ]
  },
  {
    id: 'account-podcast-lab',
    displayName: 'Podcast Lab',
    initials: 'PL',
    description: 'Short-form highlights from weekly podcast recordings.',
    platforms: [
      {
        id: 'podcast-lab-youtube-shorts',
        name: 'YouTube Shorts',
        status: 'active',
        statusMessage: 'Synced 30 minutes ago',
        dailyUploadTarget: 1,
        readyVideos: 6,
        upcomingUploads: [
          {
            id: 'pl-1',
            title: 'Episode 48 — Best Moments',
            videoUrl: SAMPLE_VIDEO_OCEAN,
            scheduledFor: '2025-05-04T22:00:00Z',
            durationSec: 68
          },
          {
            id: 'pl-2',
            title: 'Listener Questions Deep Dive',
            videoUrl: SAMPLE_VIDEO_CITY,
            scheduledFor: '2025-05-06T09:30:00Z',
            durationSec: 72
          }
        ]
      }
    ]
  }
]
