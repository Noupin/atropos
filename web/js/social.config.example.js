// Copy this file to social.config.js and fill in your own credentials.
// The config is optional; if omitted the marketing site will fall back to
// the static values in the markup.
window.atroposSocialConfig = {
  youtube: {
    // Visit https://console.cloud.google.com/apis/library/youtube.googleapis.com
    // to enable the YouTube Data API v3 for your project, then create an API key
    // via the Credentials tab. Provide the channel ID you want to display.
    channelId: "YOUR_CHANNEL_ID",
    apiKey: "YOUR_YOUTUBE_DATA_API_KEY",
  },
  instagram: {
    // Use the Instagram Graph API. Create a Meta app, connect your Instagram
    // Business or Creator account, and generate a User Access Token with the
    // `instagram_basic` permission. The user ID is available from the Graph
    // API Explorer once the account is connected.
    userId: "YOUR_INSTAGRAM_USER_ID",
    accessToken: "YOUR_INSTAGRAM_ACCESS_TOKEN",
  },
  // Optional: how frequently to refresh counts (defaults to once per page load).
  refreshIntervalMs: 3600000,
};
