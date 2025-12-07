import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUserProfile, getUserProgressData, getUserStats } from '../../services/userManagement';
import type { UserProfile, UserProgressData, UserStats } from '../../services/userManagement';
import { ArrowLeft, Mail, Calendar, Clock, Shield, UserCheck, UserX, BarChart3, Film, Tv, Heart, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import '../../styles/pages/admin/admin-user-detail.css';

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [progressData, setProgressData] = useState<UserProgressData | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [userProfile, progress, userStats] = await Promise.all([
          getUserProfile(userId),
          getUserProgressData(userId),
          getUserStats(userId)
        ]);
        
        if (!mounted) return;
        setUser(userProfile);
        setProgressData(progress);
        setStats(userStats);
      } catch (e) {
        if (!mounted) return;
        setError((e as Error).message);
        toast.error('Failed to load user details');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    
    return () => {
      mounted = false;
    };
  }, [userId]);

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDateShort = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="admin-user-detail-page">
        <div className="loading-state">Loading user details...</div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="admin-user-detail-page">
        <div className="error-state">
          <p>Error: {error || 'User not found'}</p>
          <button onClick={() => navigate('/admin/users')} className="back-btn">
            Back to Users
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-user-detail-page">
      {/* Header */}
      <div className="detail-header">
        <button onClick={() => navigate('/admin/users')} className="back-btn">
          <ArrowLeft className="w-4 h-4" />
          Back to Users
        </button>
        <h1>User Details</h1>
      </div>

      {/* User Profile Card */}
      <div className="detail-card user-profile-card">
        <div className="card-header">
          <h2>Profile Information</h2>
          <div className="status-badges">
            {user.is_admin ? (
              <span className="badge badge-admin">
                <Shield className="w-4 h-4" />
                Admin
              </span>
            ) : (
              <span className="badge badge-user">User</span>
            )}
            {user.is_active ? (
              <span className="badge badge-active">
                <UserCheck className="w-4 h-4" />
                Active
              </span>
            ) : (
              <span className="badge badge-inactive">
                <UserX className="w-4 h-4" />
                Inactive
              </span>
            )}
          </div>
        </div>
        
        <div className="profile-content">
          {user.photo_url && (
            <img src={user.photo_url} alt={user.display_name || 'User'} className="profile-photo" />
          )}
          
          <div className="profile-info">
            <div className="info-row">
              <span className="label">Display Name:</span>
              <span className="value">{user.display_name || 'No name'}</span>
            </div>
            
            <div className="info-row">
              <span className="label">
                <Mail className="w-4 h-4" />
                Email:
              </span>
              <span className="value">{user.email || '—'}</span>
            </div>
            
            <div className="info-row">
              <span className="label">User ID:</span>
              <span className="value monospace">{user.id}</span>
            </div>
            
            <div className="info-row">
              <span className="label">Auth Provider:</span>
              <span className="value">{user.auth_provider || 'local'}</span>
            </div>
            
            <div className="info-row">
              <span className="label">
                <Calendar className="w-4 h-4" />
                Joined:
              </span>
              <span className="value">{formatDate(user.created_at)}</span>
            </div>
            
            <div className="info-row">
              <span className="label">
                <Clock className="w-4 h-4" />
                Last Login:
              </span>
              <span className="value">{formatDate(user.last_login_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* User Preferences Card */}
      <div className="detail-card preferences-card">
        <div className="card-header">
          <h2>Preferences</h2>
        </div>
        
        <div className="preferences-grid">
          <div className="pref-item">
            <span className="pref-label">Main Language:</span>
            <span className="pref-value">{user.main_language || 'Not set'}</span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Subtitle Languages:</span>
            <span className="pref-value">
              {user.subtitle_languages 
                ? JSON.parse(user.subtitle_languages).join(', ') 
                : 'Not set'}
            </span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Require All Languages:</span>
            <span className="pref-value">{user.require_all_languages ? 'Yes' : 'No'}</span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Difficulty Range:</span>
            <span className="pref-value">
              {user.difficulty_min !== undefined && user.difficulty_max !== undefined
                ? `${user.difficulty_min} - ${user.difficulty_max}`
                : 'Not set'}
            </span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Auto Play:</span>
            <span className="pref-value">{user.auto_play ? 'Enabled' : 'Disabled'}</span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Playback Speed:</span>
            <span className="pref-value">{user.playback_speed || 1}x</span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Theme:</span>
            <span className="pref-value">{user.theme || 'Default'}</span>
          </div>
          
          <div className="pref-item">
            <span className="pref-label">Show Romanization:</span>
            <span className="pref-value">{user.show_romanization ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>

      {/* Statistics Card */}
      {stats && (
        <div className="detail-card stats-card">
          <div className="card-header">
            <h2>
              <BarChart3 className="w-5 h-5" />
              Learning Statistics
            </h2>
          </div>
          
          <div className="stats-grid">
            <div className="stat-box">
              <Film className="stat-icon" />
              <div className="stat-content">
                <span className="stat-value">{stats.films_studied || 0}</span>
                <span className="stat-label">Films Studied</span>
              </div>
            </div>
            
            <div className="stat-box">
              <Tv className="stat-icon" />
              <div className="stat-content">
                <span className="stat-value">{stats.episodes_studied || 0}</span>
                <span className="stat-label">Episodes Studied</span>
              </div>
            </div>
            
            <div className="stat-box">
              <TrendingUp className="stat-icon" />
              <div className="stat-content">
                <span className="stat-value">{stats.total_cards_completed || 0}</span>
                <span className="stat-label">Cards Completed</span>
              </div>
            </div>
            
            <div className="stat-box">
              <Heart className="stat-icon" />
              <div className="stat-content">
                <span className="stat-value">{stats.total_favorites || 0}</span>
                <span className="stat-label">Favorites</span>
              </div>
            </div>
          </div>
          
          <div className="stats-timeline">
            <div className="timeline-item">
              <span className="timeline-label">First Study:</span>
              <span className="timeline-value">{formatDateShort(stats.first_study_time)}</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Last Study:</span>
              <span className="timeline-value">{formatDateShort(stats.last_study_time)}</span>
            </div>
            <div className="timeline-item">
              <span className="timeline-label">Study Span:</span>
              <span className="timeline-value">
                {stats.study_days_span !== undefined 
                  ? `${stats.study_days_span} days` 
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Progress Data Card */}
      {progressData && (
        <div className="detail-card progress-card">
          <div className="card-header">
            <h2>Episode Progress</h2>
            <span className="episode-count">{progressData.episode_stats.length} episodes</span>
          </div>
          
          {progressData.episode_stats.length > 0 ? (
            <div className="episode-progress-list">
              {progressData.episode_stats.map((ep, idx) => (
                <div key={idx} className="episode-progress-item">
                  <div className="episode-header">
                    <div className="episode-info">
                      <span className="episode-film">{ep.film_id}</span>
                      {ep.episode_id && (
                        <span className="episode-id">Episode: {ep.episode_id}</span>
                      )}
                    </div>
                    <div className="episode-completion">
                      <span className="completion-percentage">
                        {ep.completion_percentage.toFixed(1)}%
                      </span>
                      <span className="completion-fraction">
                        {ep.completed_cards}/{ep.total_cards} cards
                      </span>
                    </div>
                  </div>
                  
                  <div className="episode-progress-bar">
                    <div 
                      className="episode-progress-fill" 
                      style={{ width: `${ep.completion_percentage}%` }}
                    ></div>
                  </div>
                  
                  <div className="episode-meta">
                    <span>Last card: {ep.last_card_index}</span>
                    <span>Last studied: {formatDateShort(ep.last_completed_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No progress data available</div>
          )}
        </div>
      )}

      {/* Recent Cards Card */}
      {progressData && progressData.recent_cards.length > 0 && (
        <div className="detail-card recent-cards-card">
          <div className="card-header">
            <h2>Recent Card Completions</h2>
            <span className="card-count">Last {progressData.recent_cards.length} cards</span>
          </div>
          
          <div className="recent-cards-table">
            <table>
              <thead>
                <tr>
                  <th>Film ID</th>
                  <th>Episode</th>
                  <th>Card Index</th>
                  <th>Card ID</th>
                  <th>Completed At</th>
                </tr>
              </thead>
              <tbody>
                {progressData.recent_cards.slice(0, 20).map((card, idx) => (
                  <tr key={idx}>
                    <td>{card.film_id}</td>
                    <td>{card.episode_id || '—'}</td>
                    <td className="card-index">{card.card_index}</td>
                    <td className="card-id monospace">{card.card_id}</td>
                    <td>{formatDate(card.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
