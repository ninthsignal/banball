/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the realtime (TikTok live) server. Defaults to localhost in dev. */
  readonly VITE_REALTIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
