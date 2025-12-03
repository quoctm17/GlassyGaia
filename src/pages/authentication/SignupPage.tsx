import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { Mail, Lock, User, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { signupWithEmailPassword } from '../../services/authentication';
import '../../styles/authentication/auth.css';

export default function SignupPage() {
  const navigate = useNavigate();
  const { signInGoogle, signInEmailPassword } = useUser();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);

  const checkPasswordStrength = (pass: string) => {
    if (pass.length === 0) {
      setPasswordStrength(null);
      return;
    }
    if (pass.length < 6) {
      setPasswordStrength('weak');
    } else if (pass.length < 10 || !/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) {
      setPasswordStrength('medium');
    } else {
      setPasswordStrength('strong');
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'password') {
      checkPasswordStrength(value);
    }
  };

  const validateForm = () => {
    if (!formData.email || !formData.password || !formData.displayName) {
      setError('Please fill in all required fields');
      return false;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email address');
      return false;
    }

    return true;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const result = await signupWithEmailPassword({
        email: formData.email,
        password: formData.password,
        displayName: formData.displayName,
      });

      if (result.success) {
        toast.success('Account created successfully! Logging you in...');
        
        // Auto-login after successful signup
        const loginResult = await signInEmailPassword(formData.email, formData.password);
        
        if (loginResult.success) {
          navigate('/');
        } else {
          // If auto-login fails, redirect to login page
          toast.error('Please log in with your new account');
          navigate('/auth/login');
        }
      } else {
        setError(result.error || 'Signup failed');
        toast.error(result.error || 'Signup failed');
      }
    } catch (err) {
      const errorMessage = (err as Error).message || 'An error occurred during signup';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    try {
      await signInGoogle();
      toast.success('Signed up with Google!');
      navigate('/');
    } catch {
      toast.error('Google signup failed');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">
              <img src="/favicon.jpg" alt="Glassy Gaia" />
            </div>
            <h1 className="auth-title">Create Account</h1>
            <p className="auth-subtitle">Join us and start your learning journey</p>
          </div>

          <form onSubmit={handleSignup} className="auth-form">
            {error && (
              <div className="auth-error">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-input-group">
              <label htmlFor="displayName" className="auth-label">
                Display Name <span className="text-pink-400">*</span>
              </label>
              <div className="auth-input-wrapper">
                <User className="auth-input-icon" />
                <input
                  id="displayName"
                  type="text"
                  className="auth-input"
                  placeholder="Enter your name"
                  value={formData.displayName}
                  onChange={(e) => handleInputChange('displayName', e.target.value)}
                  disabled={loading}
                  autoComplete="name"
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label htmlFor="email" className="auth-label">
                Email <span className="text-pink-400">*</span>
              </label>
              <div className="auth-input-wrapper">
                <Mail className="auth-input-icon" />
                <input
                  id="email"
                  type="email"
                  className="auth-input"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label htmlFor="password" className="auth-label">
                Password <span className="text-pink-400">*</span>
              </label>
              <div className="auth-input-wrapper">
                <Lock className="auth-input-icon" />
                <input
                  id="password"
                  type="password"
                  className="auth-input"
                  placeholder="Create a password (min 6 characters)"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              {passwordStrength && (
                <div className="password-strength">
                  <div className={`strength-bar strength-${passwordStrength}`}>
                    <div className="strength-fill"></div>
                  </div>
                  <span className={`strength-text strength-${passwordStrength}`}>
                    {passwordStrength === 'weak' && 'Weak password'}
                    {passwordStrength === 'medium' && 'Medium strength'}
                    {passwordStrength === 'strong' && (
                      <>
                        <CheckCircle className="w-3 h-3" />
                        Strong password
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="auth-input-group">
              <label htmlFor="confirmPassword" className="auth-label">
                Confirm Password <span className="text-pink-400">*</span>
              </label>
              <div className="auth-input-wrapper">
                <Lock className="auth-input-icon" />
                <input
                  id="confirmPassword"
                  type="password"
                  className="auth-input"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              className="auth-btn primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating account...</span>
                </>
              ) : (
                <span>Create Account</span>
              )}
            </button>
          </form>

          <div className="auth-divider">
            <span>OR</span>
          </div>

          <button
            type="button"
            className="auth-btn google"
            onClick={handleGoogleSignup}
            disabled={loading}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Sign up with Google</span>
          </button>

          <div className="auth-footer">
            <p>
              Already have an account?{' '}
              <Link to="/auth/login" className="auth-link">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
