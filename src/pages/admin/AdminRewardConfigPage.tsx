import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiGetRewardsConfig, apiUpdateRewardsConfig, type RewardConfig } from '../../services/cfApi';
import { Settings, Save, AlertCircle, Info, X } from 'lucide-react';
import toast from 'react-hot-toast';
import '../../styles/pages/admin/admin-level-management.css';

export default function AdminRewardConfigPage() {
  const { isSuperAdmin } = useUser();
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<RewardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<Record<number, Partial<RewardConfig>>>({});

  // Only SuperAdmin can access this page
  useEffect(() => {
    if (!isSuperAdmin()) {
      navigate('/admin/content');
      toast.error('Access denied: SuperAdmin role required');
    }
  }, [isSuperAdmin, navigate]);

  // Load rewards config
  useEffect(() => {
    if (!isSuperAdmin()) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await apiGetRewardsConfig();
        if (mounted) {
          setConfigs(data);
          // Initialize editing state with current values
          const editState: Record<number, Partial<RewardConfig>> = {};
          data.forEach((config) => {
            editState[config.id] = {};
          });
          setEditing(editState);
        }
      } catch (error: any) {
        console.error('Failed to load rewards config:', error);
        if (mounted) {
          toast.error(error.message || 'Failed to load rewards config');
          setConfigs([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => { mounted = false; };
  }, [isSuperAdmin]);

  const handleUpdate = async (config: RewardConfig) => {
    const updates = editing[config.id];
    if (!updates || Object.keys(updates).length === 0) {
      toast.error('No changes to save');
      return;
    }

    try {
      setSaving(prev => ({ ...prev, [config.id]: true }));
      // Filter out null values and convert description null to undefined
      const sanitizedUpdates = {
        ...updates,
        description: updates.description === null ? undefined : updates.description
      };
      // Remove null description if it exists
      if (sanitizedUpdates.description === undefined && 'description' in updates) {
        delete sanitizedUpdates.description;
      }
      const updated = await apiUpdateRewardsConfig(config.id, sanitizedUpdates);
      
      // Update local state
      setConfigs(prev => prev.map(c => c.id === config.id ? updated : c));
      setEditing(prev => ({ ...prev, [config.id]: {} }));
      toast.success(`Updated ${config.action_type} config`);
    } catch (error: any) {
      console.error('Failed to update rewards config:', error);
      toast.error(error.message || 'Failed to update rewards config');
    } finally {
      setSaving(prev => ({ ...prev, [config.id]: false }));
    }
  };

  const handleFieldChange = (configId: number, field: keyof RewardConfig, value: any) => {
    setEditing(prev => ({
      ...prev,
      [configId]: {
        ...prev[configId],
        [field]: value === '' ? null : (typeof value === 'string' && (field === 'xp_amount' || field === 'coin_amount' || field === 'interval_seconds') ? parseInt(value) || 0 : value)
      }
    }));
  };

  const hasChanges = (configId: number) => {
    const changes = editing[configId];
    return changes && Object.keys(changes).length > 0;
  };

  const resetChanges = (configId: number) => {
    setEditing(prev => ({ ...prev, [configId]: {} }));
  };

  if (loading) {
    return (
      <div className="admin-page-container">
        <div className="admin-page-header">
          <h1 className="admin-page-title">Rewards Configuration</h1>
        </div>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div>
          <p className="mt-4 text-gray-600">Loading rewards config...</p>
        </div>
      </div>
    );
  }

  // Group configs by reward_type
  const configsByType = configs.reduce((acc, config) => {
    const type = config.reward_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(config);
    return acc;
  }, {} as Record<string, RewardConfig[]>);

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-pink-600" />
          <h1 className="admin-page-title">Rewards Configuration</h1>
        </div>
        <p className="admin-page-description mt-2">
          Configure XP, Coins, and intervals for different user actions. Changes take effect immediately.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">About Intervals:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>interval_seconds</strong>: Time interval (in seconds) for awarding XP. Used for listening/reading time tracking.</li>
              <li>Example: If interval_seconds = 5, user earns XP every 5 seconds of listening.</li>
              <li>Set to NULL if the action doesn't use time-based intervals.</li>
            </ul>
          </div>
        </div>
      </div>

      {Object.entries(configsByType).map(([type, typeConfigs]) => (
        <div key={type} className="mb-8">
          <h2 className="text-xl font-semibold mb-4 capitalize text-gray-800 border-b pb-2">
            {type} Rewards
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    Action Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    XP Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    Coin Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    Interval (seconds)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {typeConfigs.map((config) => {
                  const isEditing = hasChanges(config.id);
                  const currentValues = {
                    xp_amount: (editing[config.id]?.xp_amount !== undefined ? editing[config.id].xp_amount : config.xp_amount) as number,
                    coin_amount: (editing[config.id]?.coin_amount !== undefined ? editing[config.id].coin_amount : config.coin_amount) as number,
                    interval_seconds: editing[config.id]?.interval_seconds !== undefined ? editing[config.id].interval_seconds : config.interval_seconds,
                    description: (editing[config.id]?.description !== undefined ? editing[config.id].description : config.description) || ''
                  };

                  return (
                    <tr key={config.id} className={isEditing ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 border-b">
                        <code className="px-2 py-1 bg-gray-100 rounded text-xs">{config.action_type}</code>
                      </td>
                      <td className="px-4 py-3 border-b">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={currentValues.xp_amount}
                          onChange={(e) => handleFieldChange(config.id, 'xp_amount', e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                      </td>
                      <td className="px-4 py-3 border-b">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={currentValues.coin_amount}
                          onChange={(e) => handleFieldChange(config.id, 'coin_amount', e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                      </td>
                      <td className="px-4 py-3 border-b">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={currentValues.interval_seconds ?? ''}
                          onChange={(e) => handleFieldChange(config.id, 'interval_seconds', e.target.value === '' ? null : e.target.value)}
                          placeholder="NULL"
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                        {config.action_type === 'listening_5s' || config.action_type === 'reading_8s' ? (
                          <span className="ml-2 text-xs text-gray-500">(required)</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 border-b">
                        <input
                          type="text"
                          value={currentValues.description || ''}
                          onChange={(e) => handleFieldChange(config.id, 'description', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                      </td>
                      <td className="px-4 py-3 border-b">
                        <div className="flex items-center gap-2">
                          {isEditing && (
                            <>
                              <button
                                onClick={() => handleUpdate(config)}
                                disabled={saving[config.id]}
                                className="px-3 py-1.5 bg-pink-600 text-white rounded text-xs font-medium hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                              >
                                <Save className="w-3 h-3" />
                                {saving[config.id] ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => resetChanges(config.id)}
                                className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-400 flex items-center gap-1"
                              >
                                <X className="w-3 h-3" />
                                Cancel
                              </button>
                            </>
                          )}
                          {!isEditing && (
                            <span className="text-xs text-gray-400">No changes</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {configs.length === 0 && !loading && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No rewards config found</p>
        </div>
      )}
    </div>
  );
}
