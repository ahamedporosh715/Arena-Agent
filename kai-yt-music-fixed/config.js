// Fixed YT Music - deploy-time config for KaiOS 2.5 builds
// All bugs fixed: backend proxy for audio, proper action handling
window.APP_CONFIG = window.APP_CONFIG || {
  apiBase: '',
  token: '',
  defaultQuality: 360,
  audioFormat: 'm4a',
  autoMode: 'ask',
  autoInfo: 'off',
  pollMode: 'normal',
  // NEW: Music player settings
  preferredMime: 'audio/mp4', // audio/mp4 preferred for KaiOS
  autoplay: true,
  autosleep: 0, // 0 = off, minutes
  invidiousInstance: 'https://invidious.snopyta.org',
  useBackendProxy: true, // FIX: Always use backend proxy for playback
  retryAttempts: 3,
  cacheExpiry: 45 * 60 * 1000 // 45 minutes
};
