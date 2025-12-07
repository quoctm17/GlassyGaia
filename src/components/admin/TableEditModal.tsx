import { X, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import '../../styles/components/admin/table-edit-modal.css';

interface TableEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  tableName: string;
  tableDisplayName: string;
  onSave: (updatedRecord: Record<string, unknown>) => Promise<void>;
}

export default function TableEditModal({ 
  isOpen, 
  onClose, 
  record, 
  tableName,
  tableDisplayName,
  onSave 
}: TableEditModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Initialize form data when record changes
  useEffect(() => {
    if (record) {
      setFormData({ ...record });
    }
  }, [record]);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, saving]);

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      toast.success('Record updated successfully');
      onClose();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save';
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !record) return null;

  // Fields that should not be edited (primary keys, system fields)
  const readOnlyFields = ['id', 'uid', 'created_at', 'updated_at'];

  return (
    <div className="modal-overlay" onClick={!saving ? onClose : undefined}>
      <form className="modal-content table-edit-modal" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Chỉnh sửa Record</h2>
            <p className="modal-subtitle">
              Table: <code>{tableName}</code> ({tableDisplayName})
            </p>
          </div>
          <button 
            type="button"
            className="modal-close-btn" 
            onClick={onClose} 
            disabled={saving}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="modal-body">
          <div className="edit-form-grid">
              {Object.entries(formData).map(([key, value]) => {
                const isReadOnly = readOnlyFields.includes(key);
                const isBoolean = typeof value === 'boolean';
                const isNull = value === null;

                return (
                  <div key={key} className="form-field">
                    <label className="form-label">
                      {key}
                      {isReadOnly && <span className="readonly-badge">Read-only</span>}
                    </label>
                    
                    {isBoolean ? (
                      <select
                        className="form-input"
                        value={value ? 'true' : 'false'}
                        onChange={(e) => handleInputChange(key, e.target.value === 'true' ? 'true' : 'false')}
                        disabled={isReadOnly || saving}
                      >
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        value={isNull ? '' : String(value)}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        disabled={isReadOnly || saving}
                        placeholder={isNull ? 'NULL' : ''}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="modal-footer">
            <button 
              type="button" 
              className="admin-btn secondary" 
              onClick={onClose}
              disabled={saving}
            >
              Hủy
            </button>
            <button 
              type="submit" 
              className="admin-btn primary"
              disabled={saving}
            >
              {saving ? (
                <>Đang lưu...</>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Lưu thay đổi
                </>
              )}
            </button>
          </div>
      </form>
    </div>
  );
}
