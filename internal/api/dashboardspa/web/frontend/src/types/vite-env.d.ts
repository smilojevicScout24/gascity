interface ImportMetaEnv {
  readonly VITE_GC_SUPERVISOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  /** Vite eager URL glob; the City view resolves its content-hashed sprites through it. */
  glob<T>(
    pattern: string,
    options: { eager: true; query: '?url'; import: 'default' },
  ): Record<string, T>;
}
