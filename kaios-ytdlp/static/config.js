// Premium Downloader deploy-time config for KaiOS 2.5 builds.
// Same-origin backend: keep apiBase empty.
window.APP_CONFIG = window.APP_CONFIG || {
  apiBase: '',
  token: '',
  defaultQuality: 360,
  audioFormat: 'm4a',
  // autoMode: 'ask' | 'video' | 'audio'
  autoMode: 'ask',
  autoInfo: 'off',
  // pollMode: 'eco' | 'normal' | 'fast'
  pollMode: 'normal'
};
