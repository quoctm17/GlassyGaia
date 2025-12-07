import { X } from 'lucide-react';
import { useEffect } from 'react';
import '../../styles/components/admin/table-detail-modal.css';

interface TableDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  tableName: string;
  tableDisplayName: string;
}

export default function TableDetailModal({ 
  isOpen, 
  onClose, 
  record, 
  tableName,
  tableDisplayName 
}: TableDetailModalProps) {
  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !record) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content table-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Chi tiết Record</h2>
            <p className="modal-subtitle">
              Table: <code>{tableName}</code> ({tableDisplayName})
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="modal-body">
          <div className="detail-grid">
            {Object.entries(record).map(([key, value]) => (
              <div key={key} className="detail-row">
                <div className="detail-label">{key}</div>
                <div className="detail-value">
                  {value === null ? (
                    <span className="text-gray-500 italic">NULL</span>
                  ) : typeof value === 'boolean' ? (
                    <span className={value ? 'text-green-400' : 'text-red-400'}>
                      {value ? 'TRUE' : 'FALSE'}
                    </span>
                  ) : typeof value === 'object' ? (
                    <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
                  ) : (
                    <span className="detail-text">{String(value)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="admin-btn secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
