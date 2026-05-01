/** Repo-root-relative paths for wiki-derived endpoint tables (`analysis/data/`). */

export const ANALYSIS_DATA_DIR = "analysis/data";

/** Raw wiki-table JSON array (`sends-to`, `packets-per-tick`, …). Input to `normalize-endpoint-data`. */
export const WIKI_ENDPOINTS_DIRTY_JSON = `${ANALYSIS_DATA_DIR}/wiki-endpoints.dirty.json`;

/** Output of `normalize-endpoint-data` (structured rows + `packets_per_tick`). */
export const ENDPOINTS_NORMALIZED_JSON = `${ANALYSIS_DATA_DIR}/endpoints.normalized.json`;
