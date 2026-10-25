/**
 * Purpose: Local PDF sharing helper for the chart export menu.
 * Current role: Uses Web Share API only for a clerk-selected/generated local PDF.
 * Last meaningful change: 2026-10-18 — initial Next.js frontend boundary.
 * Constraint: No mailto attachments and no network upload; unsupported sharing downloads locally.
 */

export type ShareResult = "shared" | "downloaded" | "cancelled";

function asFile(input: Blob | File, filename: string): File {
  return input instanceof File ? input : new File([input], filename, { type: input.type || "application/pdf" });
}

export function downloadLocalFile(input: Blob | File, filename = "panchavati-daily-duty.pdf"): void {
  const url = URL.createObjectURL(input);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sharePdfFile(input: Blob | File, filename = "panchavati-daily-duty.pdf"): Promise<ShareResult> {
  const file = asFile(input, filename);
  const navigatorWithShare = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (navigatorWithShare.share && navigatorWithShare.canShare?.({ files: [file] })) {
    try {
      await navigatorWithShare.share({ files: [file], title: "Panchavati daily duty chart" });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }

  downloadLocalFile(file, filename);
  return "downloaded";
}
