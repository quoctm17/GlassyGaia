import type { ReactNode } from 'react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  itemName?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isDeleting?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  children?: ReactNode;
}

export default function ConfirmDeleteModal({
  isOpen,
  title,
  description,
  itemName,
  onClose,
  onConfirm,
  isDeleting = false,
  confirmLabel = 'Xoá',
  cancelLabel = 'Huỷ',
  children
}: ConfirmDeleteModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !isDeleting && onClose()}
    >
      <div
        className="admin-modal-panel max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold admin-modal-title mb-4 typography-inter-1">
          {title}
        </h3>
        <div className="admin-modal-text mb-2 typography-inter-3">
          {description}
        </div>
        {itemName && (
          <div className="admin-accent-strong font-semibold mb-4 break-words max-w-full max-h-24 overflow-auto typography-inter-2">
            "{itemName}"
          </div>
        )}
        {children && <div className="mb-4">{children}</div>}
        <div className="flex gap-3 justify-end">
          <button
            className="admin-btn secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            {cancelLabel}
          </button>
          <button
            className="admin-btn danger"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Đang xoá...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
