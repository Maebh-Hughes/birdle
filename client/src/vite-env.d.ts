/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application id (public). */
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
