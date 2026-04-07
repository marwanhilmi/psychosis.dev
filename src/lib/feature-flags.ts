export const FEATURES = {
  /** X/Twitter integration — auth, tweet indexing, X signals in analysis */
  X_ENABLED: false,
  /** Debug mode — enables /debug page, /api/debug endpoint, and ?debug=true meter on index */
  DEBUG: import.meta.env.DEV,
} as const
