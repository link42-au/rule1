/** Toast notification store — shared across the link42 platform. */

export type ToastVariant = "warning" | "error" | "success" | "info";

export interface ToastItem {
	id: number;
	variant: ToastVariant;
	title?: string;
	message: string;
	dismissing: boolean;
}

let nextId = 1;
export const toasts = $state<ToastItem[]>([]);

/**
 * Show a toast notification.
 * Auto-dismisses after `duration` ms (default 6000). Pass 0 to keep until manual dismiss.
 */
export function showToast(
	variant: ToastVariant,
	message: string,
	opts?: { title?: string; duration?: number },
): number {
	const id = nextId++;
	const duration = opts?.duration ?? 6000;

	toasts.push({
		id,
		variant,
		title: opts?.title,
		message,
		dismissing: false,
	});

	if (duration > 0) {
		setTimeout(() => dismissToast(id), duration);
	}

	return id;
}

/** Dismiss a toast with exit animation. */
export function dismissToast(id: number): void {
	const t = toasts.find((t) => t.id === id);
	if (!t || t.dismissing) return;
	t.dismissing = true;
	setTimeout(() => {
		const idx = toasts.findIndex((t) => t.id === id);
		if (idx !== -1) toasts.splice(idx, 1);
	}, 200);
}
