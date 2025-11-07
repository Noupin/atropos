// Copy this file to social.config.js and fill in your own credentials.
// The config is optional; if omitted the marketing site will fall back to
// the static values in the markup.
//
// The frontend automatically builds fallback scrape URLs using the account
// identifiers you provide. Supply handles/usernames once (either in the shared
// `accounts` section or per platform) and avoid duplicating full profile URLs.
// Set `scrapeDisabled: true` (or `scrapeEnabled: false`) on any account to opt
// out of scraping entirely.
window.atroposSocialConfig = {
  // Optional shared account definitions. Each entry can include platform keys
  // (`youtube`, `instagram`, `tiktok`, `facebook`) to avoid repeating metadata
  // across platform sections. Per-platform account lists still work and will be
  // merged with any shared accounts.
  accounts: [
    {
      label: "Sniply Secrets",
      handle: "sniplysecrets",
      youtube: { channelId: "YOUR_YOUTUBE_CHANNEL_ID_FOR_SNIPLY_SECRETS" },
      instagram: {
        userId: "YOUR_INSTAGRAM_USER_ID_FOR_SNIPLY_SECRETS",
        username: "sniplysecrets",
      },
      tiktok: { handle: "sniplysecrets" },
      facebook: { pageId: "YOUR_FACEBOOK_PAGE_ID_FOR_SNIPLY_SECRETS" },
    },
  ],
  youtube: {
    // Visit https://console.cloud.google.com/apis/library/youtube.googleapis.com
    // to enable the YouTube Data API v3 for your project, then create an API key
    // via the Credentials tab. Provide the channel ID you want to display.
    apiKey: "YOUR_YOUTUBE_DATA_API_KEY",
    accounts: [
      {
        channelId: "YOUR_CHANNEL_ID_1",
        handle: "sniplyhistory",
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
        username: "sniplycosmos",
      },
      { userId: "YOUR_INSTAGRAM_USER_ID_2" },
    ],
  },
  tiktok: {
    // Provide follower totals directly or point to your own endpoint that
    // returns a JSON object containing the count (optionally specify `jsonPath`).
    // The scraper will automatically build profile URLs using any handles.
    accounts: [
      {
        followerCount: 125000,
        // Disable scraping and rely solely on the static number if desired.
        // scrapeDisabled: true,
      },
      {
        fetchUrl: "https://example.com/api/tiktok/team",
        jsonPath: "data.followers",
        handle: "sniplyhealth",
      },
      "sniplyfunnykinda",
    ],
  },
  facebook: {
    // Use the Facebook Graph API to fetch `fan_count` for each page. The
    // access token can be shared or defined per account.
    accessToken: "YOUR_FACEBOOK_ACCESS_TOKEN",
    accounts: [
      {
        pageId: "YOUR_FACEBOOK_PAGE_ID_1",
        slug: "sniplycosmos",
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
