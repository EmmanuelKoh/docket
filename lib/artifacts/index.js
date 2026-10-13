// lib/artifacts/index.js: heavy payloads by key (job PNG, ESC/POS bytes and
// offloaded inputs; tape documents and WAVs). Records store the key the
// store returns from put. Key layout, the same as the Blob pathnames before
// keys existed:
//   jobs/{owner}/{id}.png, .bin, .data.json   tape/{owner}/{id}.json, .wav
// Readers try the key first, then the legacy *_url column (old rows, and a
// key whose derived URL is wrong while *_url is still written): readFirst.
/**
 * @typedef {object} ArtifactStore
 * @property {'blob' | 'local'} driver
 * @property {boolean} inline        job png/bytes ride in the job row (local: PGlite is on the same disk)
 * @property {(key: string, body: Buffer, contentType: string) => Promise<{ key: string, url: string | null }>} put
 *           blob adds a random suffix: store the returned key
 * @property {(ref: string) => Promise<Buffer | null>} get   ref = key, or a legacy https URL; null = no such object
 * @property {(refs: string[]) => Promise<void>} del         never throws
 * @property {(ref: string) => string | null} url            public URL, or null when the store serves none
 * @property {(url: string) => string | null} keyFromUrl     key for a URL this store issued, else null
 */
import { STORE_DRIVER } from '../../config.js';

// Synchronous so lib/tape-store.js#audioUploadMode stays synchronous (lib/ is not typechecked).
export const ARTIFACT_DRIVER = STORE_DRIVER === 'redis' ? 'blob' : 'local';
/** @type {ArtifactStore | undefined} */
let store;
/** @returns {Promise<ArtifactStore>} */
export async function getArtifacts() {
  store ??= ARTIFACT_DRIVER === 'blob'
    ? (await import('./blob.js')).blobStore
    : (await import('./local.js')).localStore;
  return store;
}

// The first of refs (best first: the key, then the legacy URL) that holds
// the object. A read that fails (a wrong token-derived host, a 403, a DNS
// error) moves on to the next ref like a missing object does; the first
// failure is rethrown only when no ref produced the object.
/** @param {Array<string | null | undefined>} refs @returns {Promise<Buffer | null>} */
export async function readFirst(refs) {
  const artifacts = await getArtifacts();
  let failure = null;
  for (const ref of refs) {
    if (!ref) continue;
    try {
      const buf = await artifacts.get(ref);
      if (buf) return buf;
    } catch (err) {
      failure ??= err;
    }
  }
  if (failure) throw failure;
  return null;
}
