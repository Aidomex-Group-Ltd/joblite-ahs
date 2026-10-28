const MIB = 1024 * 1024

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const VIDEO_TYPES = ['video/mp4', 'video/webm']

export const IMAGE_MAX_BYTES = 8 * MIB

/** Videos above this size are still accepted, but only after the uploader explicitly confirms. */
export const VIDEO_RECOMMENDED_MAX_BYTES = 300 * MIB

/** Absolute ceiling for a single post video, confirmed or not. */
export const VIDEO_HARD_MAX_BYTES = 1024 * MIB

/**
 * R2 multipart parts must be at least 5 MiB (except the last) and equally sized;
 * each part is one Worker request, so it also stays far below Worker body and memory limits.
 */
export const VIDEO_PART_BYTES = 10 * MIB

export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / MIB
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1).replace(/\.0$/, '')} GB`
  return `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1).replace(/\.0$/, '')} MB`
}

export function videoPartCount(size: number): number {
  return Math.max(1, Math.ceil(size / VIDEO_PART_BYTES))
}
