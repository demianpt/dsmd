function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(message: string, details?: unknown): void {
    console.log(`[${stamp()}] INFO  ${message}`, details ?? '');
  },
  warn(message: string, details?: unknown): void {
    console.warn(`[${stamp()}] WARN  ${message}`, details ?? '');
  },
  error(message: string, details?: unknown): void {
    console.error(`[${stamp()}] ERROR ${message}`, details ?? '');
  }
};
