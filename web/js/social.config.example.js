// Copy this file to social.config.js and fill in your own credentials.
// The config is optional; if omitted the marketing site will fall back to
// the static values in the markup.
window.atroposSocialConfig = {
  youtube: {
    // Visit https://console.cloud.google.com/apis/library/youtube.googleapis.com
    // to enable the YouTube Data API v3 for your project, then create an API key
    // via the Credentials tab. Provide the channel ID you want to display.
    apiKey: "YOUR_YOUTUBE_DATA_API_KEY",
    accounts: [
      { channelId: "YOUR_CHANNEL_ID_1" },
      { channelId: "YOUR_CHANNEL_ID_2" },
    ],
  },
  instagram: {
    // Use the Instagram Graph API. Create a Meta app, connect your Instagram
    // Business or Creator account, and generate a User Access Token with the
    // `instagram_basic` permission. The user ID is available from the Graph
    // API Explorer once the account is connected.
    accessToken: "YOUR_INSTAGRAM_ACCESS_TOKEN",
    accounts: [
      { userId: "YOUR_INSTAGRAM_USER_ID_1" },
      { userId: "YOUR_INSTAGRAM_USER_ID_2" },
    ],
  },
  tiktok: {
    // Provide follower totals directly or point to your own endpoint that
    // returns a JSON object containing the count (optionally specify `jsonPath`).
    accounts: [
      { followerCount: 125000 },
      {
        fetchUrl: "https://example.com/api/tiktok/team",
        jsonPath: "data.followers",
      },
    ],
  },
  facebook: {
    // Use the Facebook Graph API to fetch `fan_count` for each page. The
    // access token can be shared or defined per account.
    accessToken: "YOUR_FACEBOOK_ACCESS_TOKEN",
    accounts: [
      { pageId: "YOUR_FACEBOOK_PAGE_ID_1" },
      { pageId: "YOUR_FACEBOOK_PAGE_ID_2" },
    ],
  },
  // Optional: how frequently to refresh counts (defaults to once per page load).
  refreshIntervalMs: 3600000,
};
