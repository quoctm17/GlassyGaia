import { X, Shield, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import '../../styles/components/admin/role-management-modal.css';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  userEmail: string;
  currentRoles: string[];
  currentUserId: string; // The logged-in superadmin's ID
  onSave: (userId: string, roles: string[]) => Promise<void>;
}

const AVAILABLE_ROLES = [
  { value: 'user', label: 'User', description: 'Basic user access' },
  { value: 'admin', label: 'Admin', description: 'Content & user management' },
  { value: 'superadmin', label: 'SuperAdmin', description: 'Full system access' },
];

export default function RoleManagementModal({ 
  isOpen, 
  onClose, 
  userId,
  userName,
  userEmail,
  currentRoles,
  currentUserId,
  onSave 
}: RoleManagementModalProps) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Check if editing self or another superadmin
  const isEditingSelf = userId === currentUserId;
  const isTargetSuperAdmin = currentRoles.includes('superadmin');

  // Initialize roles when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRoles(currentRoles);
    }
  }, [isOpen, currentRoles]);

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

  const handleAddRole = (role: string) => {
    if (!selectedRoles.includes(role)) {
      setSelectedRoles([...selectedRoles, role]);
    }
  };

  const handleRemoveRole = (role: string) => {
    // Prevent removing superadmin role from self or other superadmins
    if (role === 'superadmin' && (isEditingSelf || isTargetSuperAdmin)) {
      toast.error(
        isEditingSelf 
          ? 'Bạn không thể xóa role SuperAdmin của chính mình'
          : 'Bạn không thể xóa role SuperAdmin của SuperAdmin khác'
      );
      return;
    }
    setSelectedRoles(selectedRoles.filter(r => r !== role));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedRoles.length === 0) {
      toast.error('User must have at least one role');
      return;
    }

    setSaving(true);
    try {
      await onSave(userId, selectedRoles);
      toast.success('Roles updated successfully');
      onClose();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update roles';
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const hasChanges = JSON.stringify(selectedRoles.sort()) !== JSON.stringify(currentRoles.sort());

  return (
    <div className="modal-overlay" onClick={!saving ? onClose : undefined}>
      <form className="modal-content role-management-modal" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Quản lý Roles</h2>
            <p className="modal-subtitle">
              User: <strong>{userName}</strong>
            </p>
            <p className="modal-subtitle-email">{userEmail}</p>
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
          {/* Current Roles */}
          <div className="role-section">
            <h3 className="role-section-title">
              <Shield className="w-4 h-4" />
              Roles hiện tại
            </h3>
            <div className="role-list">
              {selectedRoles.length === 0 ? (
                <p className="no-roles">Chưa có role nào được gán</p>
              ) : (
                selectedRoles.map((role) => {
                  const roleInfo = AVAILABLE_ROLES.find(r => r.value === role);
                  return (
                    <div key={role} className="role-item assigned">
                      <div className="role-item-info">
                        <div className="role-item-name">{roleInfo?.label || role}</div>
                        <div className="role-item-desc">{roleInfo?.description || ''}</div>
                      </div>
                      <button
                        type="button"
                        className="role-item-remove"
                        onClick={() => handleRemoveRole(role)}
                        disabled={saving}
                        title="Remove role"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Available Roles to Add */}
          <div className="role-section">
            <h3 className="role-section-title">
              <Plus className="w-4 h-4" />
              Thêm roles
            </h3>
            <div className="role-list">
              {AVAILABLE_ROLES.filter(r => !selectedRoles.includes(r.value)).map((role) => (
                <button
                  key={role.value}
                  type="button"
                  className="role-item available"
                  onClick={() => handleAddRole(role.value)}
                  disabled={saving}
                >
                  <div className="role-item-info">
                    <div className="role-item-name">{role.label}</div>
                    <div className="role-item-desc">{role.description}</div>
                  </div>
                  <Plus className="w-4 h-4 role-item-add-icon" />
                </button>
              ))}
              {AVAILABLE_ROLES.every(r => selectedRoles.includes(r.value)) && (
                <p className="no-roles">Tất cả roles đã được gán</p>
              )}
            </div>
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
            disabled={saving || !hasChanges}
          >
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
    </div>
  );
}
