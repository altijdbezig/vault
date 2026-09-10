/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_ANON_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by Vite from package.json; see vite.config.ts. */
declare const __APP_VERSION__: string;
