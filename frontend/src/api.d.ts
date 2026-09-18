export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_ATLAS_STAGING?: string;
    readonly VITE_API_BASE_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
