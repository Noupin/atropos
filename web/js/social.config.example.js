// Copy this file to social.config.js and fill in your own credentials.
// The config is optional; if omitted the marketing site will fall back to
// the static values in the markup.
//
// New in this release: you may specify `scrapeUrl` (and optional
// `scrapePattern`) per account. When the official APIs fail, the frontend
// will attempt to call a local API fallback (see `localApiBaseUrl` below)
// to parse the provided page before showing "N/A".
window.atroposSocialConfig = {
  youtube: {
    // Visit https://console.cloud.google.com/apis/library/youtube.googleapis.com
    // to enable the YouTube Data API v3 for your project, then create an API key
    // via the Credentials tab. Provide the channel ID you want to display.
    apiKey: "YOUR_YOUTUBE_DATA_API_KEY",
    accounts: [
      {
        channelId: "YOUR_CHANNEL_ID_1",
        // Optional HTML fallback: omit to disable scraping.
        scrapeUrl: "https://www.youtube.com/channel/YOUR_CHANNEL_ID_1/about",
      },
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
      {
        userId: "YOUR_INSTAGRAM_USER_ID_1",
        // Optional fallback: provide the username to enable scraping.
        username: "atropos", // or add scrapeUrl: "https://instagram.com/atropos/"
      },
      { userId: "YOUR_INSTAGRAM_USER_ID_2" },
    ],
  },
  tiktok: {
    // Provide follower totals directly or point to your own endpoint that
    // returns a JSON object containing the count (optionally specify `jsonPath`).
    // Add `scrapeUrl` (and optionally `scrapePattern`) to enable the HTML
    // fallback scraper when the JSON source is unavailable.
    accounts: [
      {
        followerCount: 125000,
        scrapeUrl: "https://www.tiktok.com/@atroposstudio",
      },
      {
        fetchUrl: "https://example.com/api/tiktok/team",
        jsonPath: "data.followers",
        scrapeUrl: "https://www.tiktok.com/@teamatropos",
      },
    ],
  },
  facebook: {
    // Use the Facebook Graph API to fetch `fan_count` for each page. The
    // access token can be shared or defined per account.
    accessToken: "YOUR_FACEBOOK_ACCESS_TOKEN",
    accounts: [
      {
        pageId: "YOUR_FACEBOOK_PAGE_ID_1",
        // Optional fallback scraper: customize the URL if you use vanity routes.
        scrapeUrl: "https://www.facebook.com/YOUR_FACEBOOK_PAGE_ID_1/",
      },
      { pageId: "YOUR_FACEBOOK_PAGE_ID_2" },
    ],
  },
  // Optional: how frequently to refresh counts (defaults to once per page load).
  refreshIntervalMs: 3600000,
  // Optional: when developing locally, point the hero metrics script at your
  // locally running Flask API. Provide either a full base URL (recommended)
  // or omit it and adjust `localApiPort` if you use a different port.
  // localApiBaseUrl: "http://127.0.0.1:5001",
  // localApiPort: 5001,
};
