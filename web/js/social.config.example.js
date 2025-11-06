// Copy this file to social.config.js and fill in your own credentials.
// The config is optional; if omitted the marketing site will fall back to
// the static values in the markup.
window.atroposSocialConfig = {
  // Toggle the hero metrics entirely.
  metricsFeatureEnabled: true,

  youtube: {
    // Visit https://console.cloud.google.com/apis/library/youtube.googleapis.com
    // to enable the YouTube Data API v3 for your project, then create an API key
    // via the Credentials tab. Provide the channel IDs you want to display.
    accounts: [
      {
        channelId: "YOUR_CHANNEL_ID",
        apiKey: "YOUR_YOUTUBE_DATA_API_KEY",
      },
      // { channelId: "ANOTHER_CHANNEL", apiKey: "API_KEY" },
    ],
    // Optional: fallback total if a request fails.
    mockCount: 12800,
  },

  instagram: {
    // Use the Instagram Graph API. Create a Meta app, connect your Instagram
    // Business or Creator account, and generate a User Access Token with the
    // `instagram_basic` permission. The user ID is available from the Graph
    // API Explorer once the account is connected.
    accounts: [
      {
        userId: "YOUR_INSTAGRAM_USER_ID",
        accessToken: "YOUR_INSTAGRAM_ACCESS_TOKEN",
      },
    ],
    mockCount: 8600,
  },

  tiktok: {
    // Generate a TikTok access token with the `user.info.basic` scope and include
    // the Open ID returned during the OAuth flow.
    accounts: [
      {
        openId: "YOUR_TIKTOK_OPEN_ID",
        accessToken: "YOUR_TIKTOK_ACCESS_TOKEN",
      },
    ],
    mockCount: 5400,
  },

  facebook: {
    // Provide the Facebook Page ID and Graph API token with `pages_read_engagement`.
    accounts: [
      {
        pageId: "YOUR_FACEBOOK_PAGE_ID",
        accessToken: "YOUR_FACEBOOK_ACCESS_TOKEN",
      },
    ],
    mockCount: 4300,
  },

  // Optional: how frequently to refresh counts (defaults to once per page load).
  refreshIntervalMs: 3600000,
};
