import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiListCategories, apiCreateCategory, apiUpdateCategory, apiDeleteCategory, apiCheckCategoryUsage } from '../../services/cfApi';
import type { Category } from '../../types';
import { Plus, Pencil, Trash2, Search, ArrowLeft, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDeleteModal from '../../components/admin/ConfirmDeleteModal';
import ProgressBar from '../../components/ProgressBar';
import '../../styles/components/admin/admin-forms.css';

export default function AdminCategoriesPage() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [categoryUsageInfo, setCategoryUsageInfo] = useState<{ category: Category; usage_count: number } | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<{ items: Array<{ id: string; name: string }> } | null>(null);
  const [bulkDeleteUsageInfo, setBulkDeleteUsageInfo] = useState<Array<{ id: string; name: string; usage_count: number }> | null>(null);
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const cats = await apiListCategories();
      setCategories(cats);
    } catch (e) {
      toast.error(`Failed to load categories: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredCategories = categories.filter(cat =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Bulk selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCategories.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCategories.map(cat => cat.id)));
    }
  };

  const toggleSelectId = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkDelete = async () => {
    const items = Array.from(selectedIds).map(id => {
      const cat = categories.find(c => c.id === id);
      return { id, name: cat?.name || id };
    });
    
    // Check usage for all selected categories first
    setCheckingUsage(true);
    try {
      const usageChecks: Array<{ id: string; name: string; usage_count: number }> = [];
      for (const item of items) {
        try {
          const usage = await apiCheckCategoryUsage(item.id);
          usageChecks.push({ id: item.id, name: item.name, usage_count: usage.usage_count });
        } catch (e) {
          // If check fails, assume 0 usage
          usageChecks.push({ id: item.id, name: item.name, usage_count: 0 });
        }
      }
      
      const inUseCategories = usageChecks.filter(c => c.usage_count > 0);
      if (inUseCategories.length > 0) {
        // Show usage info modal instead of delete confirmation
        setBulkDeleteUsageInfo(usageChecks);
        setConfirmBulkDelete({ items });
      } else {
        // All safe to delete, proceed with normal confirmation
        setBulkDeleteUsageInfo(null);
        setConfirmBulkDelete({ items });
      }
    } catch (e) {
      toast.error(`Failed to check category usage: ${(e as Error).message}`);
    } finally {
      setCheckingUsage(false);
    }
  };

  const executeBulkDelete = async () => {
    if (!confirmBulkDelete) return;
    
    setIsDeleting(true);
    setDeletionPercent(0);
    setDeletionProgress({ stage: 'Đang kiểm tra...', details: `Kiểm tra ${confirmBulkDelete.items.length} categories trước khi xóa` });
    
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    try {
      // First pass: check usage for all categories
      const usageChecks: Array<{ id: string; name: string; usage_count: number }> = [];
      for (let i = 0; i < confirmBulkDelete.items.length; i++) {
        const item = confirmBulkDelete.items[i];
        const progress = Math.floor(((i + 1) / confirmBulkDelete.items.length) * 45);
        setDeletionPercent(progress);
        setDeletionProgress({ 
          stage: `Đang kiểm tra ${i + 1}/${confirmBulkDelete.items.length}`, 
          details: `Kiểm tra: ${item.name}` 
        });

        try {
          const usage = await apiCheckCategoryUsage(item.id);
          usageChecks.push({ id: item.id, name: item.name, usage_count: usage.usage_count });
        } catch (e) {
          results.push({ id: item.id, success: false, error: `Check failed: ${(e as Error).message}` });
        }
      }

      // Filter out categories that are in use
      const inUseCategories = usageChecks.filter(c => c.usage_count > 0);
      const safeToDelete = usageChecks.filter(c => c.usage_count === 0);

      if (inUseCategories.length > 0) {
        const inUseNames = inUseCategories.map(c => `"${c.name}" (${c.usage_count} content item(s))`).join(', ');
        toast.error(`Cannot delete ${inUseCategories.length} category/categories: ${inUseNames}. Please remove them from content items first.`);
        // Still try to delete the safe ones
      }

      // Second pass: delete only safe categories
      setDeletionProgress({ stage: 'Đang xóa...', details: `Xóa ${safeToDelete.length} categories an toàn` });
      for (let i = 0; i < safeToDelete.length; i++) {
        const item = safeToDelete[i];
        const progress = 50 + Math.floor(((i + 1) / safeToDelete.length) * 45);
        setDeletionPercent(progress);
        setDeletionProgress({ 
          stage: `Đang xóa ${i + 1}/${safeToDelete.length}`, 
          details: `Xóa: ${item.name}` 
        });

        try {
          await apiDeleteCategory(item.id);
          results.push({ id: item.id, success: true });
        } catch (e) {
          results.push({ id: item.id, success: false, error: (e as Error).message });
        }
      }

      setDeletionPercent(100);
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      setDeletionProgress({ 
        stage: 'Hoàn tất', 
        details: `Thành công: ${successCount}, Thất bại: ${failCount}${inUseCategories.length > 0 ? `, Bỏ qua: ${inUseCategories.length}` : ''}` 
      });

      // Remove successfully deleted items from categories
      const deletedIds = results.filter(r => r.success).map(r => r.id);
      setCategories(prev => prev.filter(c => !deletedIds.includes(c.id)));
      setSelectedIds(new Set());

      setTimeout(() => {
        if (failCount > 0) {
          toast.error(`Xóa xong! Thành công: ${successCount}, Thất bại: ${failCount}`);
        } else {
          toast.success(`Đã xóa ${successCount} categories`);
        }
        setConfirmBulkDelete(null);
        setDeletionProgress(null);
        setDeletionPercent(0);
      }, 600);
    } catch (e) {
      toast.error((e as Error).message);
      setDeletionProgress(null);
      setDeletionPercent(0);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreate = async () => {
    if (!newCategoryName.trim()) {
      toast.error('Category name is required');
      return;
    }
    try {
      setIsCreating(true);
      const result = await apiCreateCategory(newCategoryName.trim());
      if (result.created) {
        toast.success(`Category "${result.name}" created`);
      } else {
        toast.error(`Category "${result.name}" already exists`);
      }
      setNewCategoryName('');
      await loadCategories();
    } catch (e) {
      toast.error(`Failed to create category: ${(e as Error).message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (category: Category) => {
    setEditingCategory(category);
    setTimeout(() => {
      editInputRef.current?.focus();
    }, 100);
  };

  const handleSaveEdit = async () => {
    if (!editingCategory || !editingCategory.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    try {
      await apiUpdateCategory(editingCategory.id, editingCategory.name.trim());
      toast.success(`Category updated to "${editingCategory.name}"`);
      setEditingCategory(null);
      await loadCategories();
    } catch (e) {
      toast.error(`Failed to update category: ${(e as Error).message}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
  };

  const handleDeleteClick = async (category: Category) => {
    // Check usage before showing delete confirmation
    setCheckingUsage(true);
    try {
      const usage = await apiCheckCategoryUsage(category.id);
      if (usage.usage_count > 0) {
        // Show usage warning modal instead of delete confirmation
        setCategoryUsageInfo({ category, usage_count: usage.usage_count });
        setDeletingCategory(category);
      } else {
        // Safe to delete, show normal confirmation
        setCategoryUsageInfo(null);
        setDeletingCategory(category);
      }
    } catch (e) {
      toast.error(`Failed to check category usage: ${(e as Error).message}`);
    } finally {
      setCheckingUsage(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCategory) return;
    try {
      setIsDeleting(true);
      await apiDeleteCategory(deletingCategory.id);
      toast.success(`Category "${deletingCategory.name}" deleted`);
      setDeletingCategory(null);
      setCategoryUsageInfo(null);
      await loadCategories();
    } catch (e) {
      toast.error(`Failed to delete category: ${(e as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-header flex items-center gap-2">
        <h2 className="admin-title">Categories Management</h2>
        <button className="admin-btn secondary flex items-center gap-1.5" onClick={() => navigate('/admin/content')}>
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      {/* Create New Category */}
      <div className="admin-panel space-y-3">
        <div className="typography-inter-1 admin-panel-title">Create New Category</div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="admin-input flex-1"
            placeholder="Category name..."
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreate();
              }
            }}
            disabled={isCreating}
          />
          <button
            className="admin-btn primary flex items-center gap-2"
            onClick={handleCreate}
            disabled={isCreating || !newCategoryName.trim()}
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="admin-panel space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--sub-language-text)' }} />
            <input
              type="text"
              className="admin-input !pl-10"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Categories List */}
      <div className="admin-panel space-y-3">
        <div className="flex items-center justify-between">
          <div className="typography-inter-1 admin-panel-title">
            Categories ({filteredCategories.length})
          </div>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="admin-btn primary flex items-center gap-2 bg-red-600 hover:bg-red-700"
              onClick={handleBulkDelete}
              title={`Delete ${selectedIds.size} selected categories`}
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete ({selectedIds.size})</span>
            </button>
          )}
        </div>
        {loading ? (
          <div className="admin-info">Loading categories...</div>
        ) : filteredCategories.length === 0 ? (
          <div className="admin-info">
            {searchQuery ? 'No categories match your search' : 'No categories yet. Create one above!'}
          </div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="w-12">
                    <button
                      type="button"
                      className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                        selectedIds.size === filteredCategories.length && filteredCategories.length > 0
                          ? 'bg-pink-500 border-pink-500'
                          : selectedIds.size > 0
                          ? 'bg-pink-500/50 border-pink-500'
                          : 'border-gray-600 hover:border-pink-500'
                      }`}
                      onClick={toggleSelectAll}
                      title={selectedIds.size === filteredCategories.length ? 'Deselect all' : 'Select all'}
                    >
                      {selectedIds.size > 0 && <Check className="w-3 h-3 text-white" />}
                    </button>
                  </th>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.map((cat) => {
                  const isSelected = selectedIds.has(cat.id);
                  return (
                  <tr key={cat.id} className={isSelected ? 'bg-pink-500/10' : ''}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-pink-500 border-pink-500'
                            : 'border-gray-600 hover:border-pink-500'
                        }`}
                        onClick={() => toggleSelectId(cat.id)}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </button>
                    </td>
                    <td>
                      {editingCategory?.id === cat.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          className="admin-input"
                          value={editingCategory.name}
                          onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit();
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                          onBlur={handleSaveEdit}
                          autoFocus
                        />
                      ) : (
                        <span className="typography-inter-2" style={{ fontSize: '14px', color: 'var(--text)' }}>
                          {cat.name}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="typography-inter-4" style={{ fontSize: '12px', color: 'var(--sub-language-text)' }}>
                        {cat.created_at ? new Date(cat.created_at * 1000).toLocaleDateString() : '-'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {editingCategory?.id === cat.id ? (
                          <>
                            <button
                              className="admin-btn secondary !px-2 !py-1"
                              onClick={handleSaveEdit}
                              title="Save"
                            >
                              ✓
                            </button>
                            <button
                              className="admin-btn secondary !px-2 !py-1"
                              onClick={handleCancelEdit}
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="admin-btn secondary !px-2 !py-1"
                              onClick={() => handleStartEdit(cat)}
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              className="admin-btn danger !px-2 !py-1"
                              onClick={() => handleDeleteClick(cat)}
                              disabled={checkingUsage}
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Category Usage Warning Modal (Single) */}
      {deletingCategory && categoryUsageInfo && categoryUsageInfo.usage_count > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => {
          setDeletingCategory(null);
          setCategoryUsageInfo(null);
        }}>
          <div 
            className="admin-modal-panel max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">⚠️ Không thể xóa Category</h3>
            <div className="mb-4 p-3 rounded-lg border-2" style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error)' }}>
              <p className="admin-modal-text mb-2">
                Category <span className="admin-accent-strong font-semibold">"{deletingCategory.name}"</span> đang được sử dụng bởi:
              </p>
              <p className="text-lg font-bold admin-accent-strong" style={{ color: 'var(--error-text)' }}>
                {categoryUsageInfo.usage_count} content item(s)
              </p>
            </div>
            <p className="admin-modal-text mb-6">
              Để xóa category này, bạn cần gỡ category khỏi tất cả content items trước. 
              Vui lòng vào trang quản lý từng content item và xóa category khỏi chúng.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="admin-btn secondary"
                onClick={() => {
                  setDeletingCategory(null);
                  setCategoryUsageInfo(null);
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Single) - Only show if category is safe to delete */}
      {deletingCategory && (!categoryUsageInfo || categoryUsageInfo.usage_count === 0) && (
        <ConfirmDeleteModal
          isOpen={!!deletingCategory}
          title="Xác nhận xoá Category"
          description="Thao tác này sẽ xóa category khỏi hệ thống. Category này hiện không được sử dụng bởi content item nào."
          itemName={deletingCategory ? `"${deletingCategory.name}"` : ''}
          isDeleting={isDeleting}
          onClose={() => {
            if (!isDeleting) {
              setDeletingCategory(null);
              setCategoryUsageInfo(null);
            }
          }}
          onConfirm={handleDelete}
          confirmLabel="Xoá"
          cancelLabel="Huỷ"
        />
      )}

      {/* Bulk Delete Usage Warning Modal */}
      {confirmBulkDelete && bulkDeleteUsageInfo && bulkDeleteUsageInfo.some(c => c.usage_count > 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !isDeleting && (setConfirmBulkDelete(null), setBulkDeleteUsageInfo(null))}>
          <div 
            className="admin-modal-panel max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">⚠️ Không thể xóa một số Categories</h3>
            <div className="mb-4 p-3 rounded-lg border-2" style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error)' }}>
              <p className="admin-modal-text mb-2">
                Có <span className="admin-accent-strong font-semibold">{bulkDeleteUsageInfo.filter(c => c.usage_count > 0).length}</span> category/categories đang được sử dụng và không thể xóa:
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto mb-4 admin-subpanel border rounded-lg p-3">
              <ul className="text-sm admin-modal-text space-y-2">
                {bulkDeleteUsageInfo.map((item) => {
                  if (item.usage_count === 0) return null;
                  return (
                    <li key={item.id} className="flex items-start gap-2 p-2 rounded" style={{ backgroundColor: 'var(--error-bg)' }}>
                      <span className="font-semibold admin-accent-strong flex-1">"{item.name}"</span>
                      <span className="text-xs" style={{ color: 'var(--error-text)' }}>
                        ({item.usage_count} content item{item.usage_count > 1 ? 's' : ''})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-sm admin-modal-text mb-4">
              Để xóa các categories này, bạn cần gỡ chúng khỏi tất cả content items trước. 
              Vui lòng vào trang quản lý từng content item và xóa categories khỏi chúng.
            </p>
            {bulkDeleteUsageInfo.some(c => c.usage_count === 0) && (
              <div className="mb-4 p-3 rounded-lg border-2" style={{ backgroundColor: 'var(--success)', borderColor: 'var(--success)', opacity: 0.2 }}>
                <p className="text-sm admin-modal-text">
                  Có <span className="admin-accent-strong font-semibold">{bulkDeleteUsageInfo.filter(c => c.usage_count === 0).length}</span> category/categories an toàn để xóa. 
                  Bạn có thể chọn lại và chỉ xóa những category đó.
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                className="admin-btn secondary"
                onClick={() => {
                  setConfirmBulkDelete(null);
                  setBulkDeleteUsageInfo(null);
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal - Only show if all categories are safe to delete */}
      {confirmBulkDelete && (!bulkDeleteUsageInfo || bulkDeleteUsageInfo.every(c => c.usage_count === 0)) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !isDeleting && (setConfirmBulkDelete(null), setBulkDeleteUsageInfo(null))}>
          <div 
            className="admin-modal-panel max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">Xác nhận xóa hàng loạt</h3>
            <p className="admin-modal-text mb-2">Bạn có chắc muốn xóa <span className="admin-accent-strong font-semibold">{confirmBulkDelete.items.length}</span> categories sau:</p>
            <div className="max-h-48 overflow-y-auto mb-4 admin-subpanel border rounded-lg p-3">
              <ul className="text-sm admin-modal-text space-y-1">
                {confirmBulkDelete.items.map((item, idx) => (
                  <li key={item.id} className="flex items-start gap-2">
                    <span className="admin-accent-strong font-mono">{idx + 1}.</span>
                    <span className="flex-1">
                      <span className="font-semibold admin-accent-strong">{item.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-sm admin-modal-text mb-6">Thao tác này sẽ xóa các categories khỏi hệ thống. Các categories này hiện không được sử dụng bởi content item nào. Không thể hoàn tác!</p>
            {deletionProgress && (
              <div className="mb-4 p-3 admin-subpanel border rounded-lg">
                <div className="text-sm font-semibold admin-accent-strong mb-2">{deletionProgress.stage}</div>
                <div className="text-xs admin-modal-text mb-2">{deletionProgress.details}</div>
                <ProgressBar percent={deletionPercent} />
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                className="admin-btn secondary"
                onClick={() => setConfirmBulkDelete(null)}
                disabled={isDeleting}
              >
                Huỷ
              </button>
              <button
                className="admin-btn danger"
                disabled={isDeleting}
                onClick={executeBulkDelete}
              >
                {isDeleting ? 'Đang xóa...' : `Xóa ${confirmBulkDelete.items.length} categories`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

