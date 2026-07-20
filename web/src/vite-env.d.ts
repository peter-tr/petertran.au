/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_ENDPOINT?: string;
  readonly VITE_IMPOSTER_GRAPHQL_ENDPOINT?: string;
  readonly VITE_WARMUP_CONFIG_ENDPOINT?: string;
  readonly VITE_PC_CONFIG_ENDPOINT?: string;
  readonly VITE_PANTRY_GRAPHQL_ENDPOINT?: string;
  readonly VITE_RUM_APP_MONITOR_ID?: string;
  readonly VITE_RUM_IDENTITY_POOL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
