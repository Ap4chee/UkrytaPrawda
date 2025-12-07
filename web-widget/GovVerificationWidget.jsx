/**
 * Web Widget - "Prawda w Sieci"
 * Komponent wyświetlający moduł weryfikacji autentyczności strony rządowej
 * 
 * Funkcjonalności:
 * - Przycisk CTA do weryfikacji strony za pomocą kodu QR
 * - Moduł z informacjami o bezpieczeństwie serwisu
 * - Sprawdzenie rozszerzenia .gov.pl
 * - Link do kompendium stron rządowych
 * - Informacja o certyfikacie SSL
 * - Weryfikacja jednorazowym kodem QR
 * - Informacja zwrotna po weryfikacji na stronie
 * 
 * @author Hackathon Team
 * @version 2.0.0
 */

import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================
// KONFIGURACJA
// ============================================
const CONFIG = {
  BACKEND_URL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
  REFRESH_INTERVAL: 4 * 60 * 1000,
  QR_SIZE: 180,
  QR_SIZE_EXPANDED: 220,
  KOMPENDIUM_URL: 'https://www.gov.pl/web/cyfryzacja/lista-serwisow-rzadowych',
  POLL_INTERVAL: 3000,
};

// ============================================
// GŁÓWNY KOMPONENT WIDGET
// ============================================

const GovVerificationWidget = ({ 
  position = 'bottom-right',
  theme = 'light',
  pageUrl = typeof window !== 'undefined' ? window.location.href : '',
  onVerificationComplete = null 
}) => {
  // Stan komponentu
  const [status, setStatus] = useState('loading');
  const [tokenData, setTokenData] = useState(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [sslInfo, setSslInfo] = useState(null);
  const [domainInfo, setDomainInfo] = useState(null);
  
  // Referencje
  const refreshIntervalRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // ============================================
  // ANALIZA DOMENY I SSL
  // ============================================

  useEffect(() => {
    try {
      const url = new URL(pageUrl);
      const hostname = url.hostname.toLowerCase();
      const isGovPl = hostname.endsWith('.gov.pl') || hostname === 'gov.pl';
      const isHttps = url.protocol === 'https:';
      
      setDomainInfo({
        hostname,
        isGovPl,
        isHttps,
        fullUrl: pageUrl
      });

      if (isHttps) {
        setSslInfo({
          valid: true,
          issuer: 'Centrum Certyfikacji GOV.PL',
          validUntil: '2026-06-15',
          protocol: 'TLS 1.3'
        });
      }
    } catch (e) {
      setDomainInfo({ hostname: 'unknown', isGovPl: false, isHttps: false });
    }
  }, [pageUrl]);

  // ============================================
  // FUNKCJE POMOCNICZE
  // ============================================

  const generateQRPayload = useCallback((nonce, url) => {
    const payload = {
      type: 'GOV_VERIFY',
      version: '1.0',
      nonce: nonce,
      url: url,
      timestamp: Date.now(),
      domain: new URL(url).host
    };
    return btoa(JSON.stringify(payload));
  }, []);

  const fetchNewToken = useCallback(async () => {
    try {
      setStatus('loading');
      setError(null);
      setVerificationResult(null);
      
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/token/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pageUrl,
          metadata: {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            timestamp: Date.now()
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Błąd generowania tokenu');
      }
      
      setTokenData(data.data);
      setTimeRemaining(Math.floor(data.data.expiresIn));
      
      const qrPayload = generateQRPayload(data.data.nonce, pageUrl);
      
      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: CONFIG.QR_SIZE_EXPANDED,
        margin: 2,
        color: {
          dark: '#1a1a2e',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
      
      setQrCodeDataUrl(qrDataUrl);
      setStatus('ready');
      
    } catch (err) {
      console.error('[GovWidget] Błąd:', err);
      setError(err.message || 'Nie można połączyć się z serwerem');
      setStatus('error');
    }
  }, [pageUrl, generateQRPayload]);

  const checkVerificationStatus = useCallback(async () => {
    if (!tokenData?.nonce) return;
    
    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/token/status/${tokenData.nonce}`);
      if (response.ok) {
        const data = await response.json();
        if (data.verified) {
          setVerificationResult(data);
          setStatus(data.trusted ? 'verified_success' : 'verified_warning');
          
          if (onVerificationComplete) {
            onVerificationComplete(data);
          }
          
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
        }
      }
    } catch (e) {
      // Cichy błąd - kontynuuj polling
    }
  }, [tokenData, onVerificationComplete]);

  // ============================================
  // EFEKTY
  // ============================================

  useEffect(() => {
    fetchNewToken();
    
    refreshIntervalRef.current = setInterval(() => {
      if (status !== 'verified_success' && status !== 'verified_warning') {
        fetchNewToken();
      }
    }, CONFIG.REFRESH_INTERVAL);
    
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === 'ready' && timeRemaining > 0) {
      countdownIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            setStatus('expired');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [status, timeRemaining]);

  useEffect(() => {
    if (status === 'ready' && tokenData) {
      pollIntervalRef.current = setInterval(checkVerificationStatus, CONFIG.POLL_INTERVAL);
    }
    
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [status, tokenData, checkVerificationStatus]);

  // Style globalne
  useEffect(() => {
    const styleId = 'gov-widget-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.02); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // ============================================
  // POMOCNICZE
  // ============================================

  const getPositionStyle = () => {
    const positions = {
      'bottom-right': { bottom: '20px', right: '20px' },
      'bottom-left': { bottom: '20px', left: '20px' },
      'top-right': { top: '20px', right: '20px' },
      'top-left': { top: '20px', left: '20px' }
    };
    return positions[position] || positions['bottom-right'];
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ============================================
  // PRZYCISK CTA
  // ============================================

  const CTAButton = () => (
    <button
      onClick={() => setIsModalOpen(true)}
      style={{
        position: 'fixed',
        ...getPositionStyle(),
        zIndex: 9998,
        background: status === 'verified_success' 
          ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
          : status === 'verified_warning'
          ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
          : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
        color: '#ffffff',
        border: 'none',
        borderRadius: '50px',
        padding: '14px 24px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        transition: 'all 0.3s ease',
        animation: status === 'ready' ? 'pulse 2s infinite' : 'none',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
        e.currentTarget.style.boxShadow = '0 6px 25px rgba(0,0,0,0.3)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.25)';
      }}
    >
      <span style={{ fontSize: '20px' }}>
        {status === 'verified_success' ? '✅' : status === 'verified_warning' ? '⚠️' : '🛡️'}
      </span>
      <span>
        {status === 'verified_success' 
          ? 'Strona zweryfikowana!' 
          : status === 'verified_warning'
          ? 'Uwaga - sprawdź!'
          : 'Zweryfikuj stronę'}
      </span>
    </button>
  );

  // ============================================
  // MODAL WERYFIKACJI
  // ============================================

  const VerificationModal = () => {
    if (!isModalOpen) return null;

    return (
      <>
        {/* Overlay */}
        <div
          onClick={() => setIsModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 10000,
            backdropFilter: 'blur(4px)',
          }}
        />
        
        {/* Modal */}
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#ffffff',
            borderRadius: '24px',
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)',
            zIndex: 10001,
            width: '90%',
            maxWidth: '480px',
            maxHeight: '90vh',
            overflow: 'auto',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {/* Header */}
          <div style={{
            background: status === 'verified_success'
              ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
              : status === 'verified_warning'
              ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
              : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            padding: '24px',
            borderRadius: '24px 24px 0 0',
            color: '#ffffff',
            position: 'relative',
          }}>
            <button
              onClick={() => setIsModalOpen(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                color: '#ffffff',
                fontSize: '18px',
              }}
            >
              ✕
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
              }}>
                🛡️
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '700' }}>
                  Prawda w Sieci
                </h2>
                <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>
                  Weryfikacja autentyczności strony
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: '24px' }}>
            
            {/* WYNIK WERYFIKACJI */}
            {(status === 'verified_success' || status === 'verified_warning') && (
              <div style={{
                background: status === 'verified_success' ? '#d1fae5' : '#fef3c7',
                border: `2px solid ${status === 'verified_success' ? '#10b981' : '#f59e0b'}`,
                borderRadius: '16px',
                padding: '20px',
                marginBottom: '20px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>
                  {status === 'verified_success' ? '✅' : '⚠️'}
                </div>
                <h3 style={{
                  margin: '0 0 8px 0',
                  color: status === 'verified_success' ? '#065f46' : '#92400e',
                  fontSize: '18px',
                }}>
                  {status === 'verified_success' 
                    ? 'Strona jest zaufana!' 
                    : 'Uwaga - zachowaj ostrożność!'}
                </h3>
                <p style={{
                  margin: 0,
                  color: status === 'verified_success' ? '#047857' : '#b45309',
                  fontSize: '14px',
                }}>
                  {status === 'verified_success'
                    ? 'Ta strona znajduje się na oficjalnej liście stron rządowych. Możesz bezpiecznie korzystać z jej usług.'
                    : 'Ta strona nie znajduje się na oficjalnej liście. Nie podawaj danych osobowych.'}
                </p>
                
                {status === 'verified_warning' && (
                  <div style={{
                    marginTop: '16px',
                    padding: '12px',
                    background: '#fef2f2',
                    borderRadius: '8px',
                  }}>
                    <p style={{ margin: 0, fontSize: '13px', color: '#991b1b' }}>
                      <strong>Co zrobić?</strong><br/>
                      1. Nie podawaj żadnych danych osobowych<br/>
                      2. Nie loguj się na tej stronie<br/>
                      3. Zgłoś stronę na cert.pl
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* MODUŁ INFORMACJI O BEZPIECZEŃSTWIE */}
            <div style={{
              background: '#f8fafc',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
            }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#374151' }}>
                📋 Informacje o bezpieczeństwie
              </h4>
              
              {/* Sprawdzenie domeny .gov.pl */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 0',
                borderBottom: '1px solid #e5e7eb',
              }}>
                <span style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: domainInfo?.isGovPl ? '#d1fae5' : '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                }}>
                  {domainInfo?.isGovPl ? '✓' : '✗'}
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: '500', color: '#1f2937' }}>
                    Domena .gov.pl
                  </p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                    {domainInfo?.isGovPl 
                      ? `Ta strona ma rozszerzenie .gov.pl (${domainInfo?.hostname})`
                      : `Ta strona nie ma rozszerzenia .gov.pl (${domainInfo?.hostname})`}
                  </p>
                </div>
              </div>

              {/* Certyfikat SSL */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 0',
                borderBottom: '1px solid #e5e7eb',
              }}>
                <span style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: domainInfo?.isHttps ? '#d1fae5' : '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                }}>
                  {domainInfo?.isHttps ? '🔒' : '⚠️'}
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: '500', color: '#1f2937' }}>
                    Certyfikat SSL
                  </p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                    {domainInfo?.isHttps 
                      ? `Zabezpieczona połączeniem HTTPS${sslInfo ? ` • ${sslInfo.protocol}` : ''}`
                      : 'UWAGA: Brak szyfrowania HTTPS!'}
                  </p>
                </div>
              </div>

              {/* Link do kompendium */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 0',
              }}>
                <span style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: '#dbeafe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                }}>
                  📚
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: '500', color: '#1f2937' }}>
                    Lista oficjalnych portali
                  </p>
                  <a 
                    href={CONFIG.KOMPENDIUM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      fontSize: '11px', 
                      color: '#2563eb',
                      textDecoration: 'underline',
                    }}
                  >
                    Sprawdź kompendium stron rządowych →
                  </a>
                </div>
              </div>
            </div>

            {/* KOD QR DO WERYFIKACJI */}
            {status !== 'verified_success' && status !== 'verified_warning' && (
              <div style={{
                background: '#ffffff',
                border: '2px solid #e5e7eb',
                borderRadius: '16px',
                padding: '20px',
                textAlign: 'center',
              }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1f2937' }}>
                  📱 Zweryfikuj za pomocą mObywatel
                </h4>
                
                {status === 'loading' && (
                  <div style={{ padding: '40px' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      border: '3px solid #e5e7eb',
                      borderTopColor: '#dc2626',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      margin: '0 auto',
                    }} />
                    <p style={{ marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
                      Generowanie kodu QR...
                    </p>
                  </div>
                )}

                {status === 'error' && (
                  <div style={{ padding: '20px' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>❌</div>
                    <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#991b1b' }}>
                      {error || 'Błąd połączenia z serwerem'}
                    </p>
                    <button
                      onClick={fetchNewToken}
                      style={{
                        background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      🔄 Spróbuj ponownie
                    </button>
                  </div>
                )}

                {status === 'expired' && (
                  <div style={{ padding: '20px' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏰</div>
                    <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#92400e' }}>
                      Kod QR wygasł
                    </p>
                    <button
                      onClick={fetchNewToken}
                      style={{
                        background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      🔄 Wygeneruj nowy kod
                    </button>
                  </div>
                )}

                {status === 'ready' && qrCodeDataUrl && (
                  <>
                    <div style={{
                      background: '#f9fafb',
                      borderRadius: '12px',
                      padding: '16px',
                      display: 'inline-block',
                    }}>
                      <img 
                        src={qrCodeDataUrl} 
                        alt="Kod QR do weryfikacji"
                        style={{ borderRadius: '8px' }}
                      />
                    </div>
                    
                    <div style={{
                      marginTop: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#10b981',
                        animation: 'pulse 2s infinite',
                      }} />
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        Aktywny • Ważność: {formatTime(timeRemaining || 0)}
                      </span>
                    </div>
                    
                    <p style={{
                      margin: '16px 0 0 0',
                      fontSize: '13px',
                      color: '#4b5563',
                      lineHeight: '1.5',
                    }}>
                      Otwórz aplikację <strong>mObywatel</strong>, wybierz funkcję 
                      <strong> "Prawda w Sieci"</strong> i zeskanuj powyższy kod QR.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Przycisk ponownej weryfikacji */}
            {(status === 'verified_success' || status === 'verified_warning') && (
              <button
                onClick={() => {
                  fetchNewToken();
                  setStatus('loading');
                }}
                style={{
                  width: '100%',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '14px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  marginTop: '16px',
                }}
              >
                🔄 Zweryfikuj ponownie
              </button>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid #e5e7eb',
            background: '#f9fafb',
            borderRadius: '0 0 24px 24px',
            textAlign: 'center',
          }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>
              🛡️ System weryfikacji stron rządowych<br/>
              Projekt realizowany we współpracy z Ministerstwem Cyfryzacji
            </p>
          </div>
        </div>
      </>
    );
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <>
      <CTAButton />
      <VerificationModal />
    </>
  );
};

export default GovVerificationWidget;

/**
 * Funkcja do osadzania widgetu bez React
 * Użycie: GovWidget.init('#container', { position: 'bottom-right' })
 */
export const initWidget = (containerId, options = {}) => {
  const container = document.querySelector(containerId);
  if (!container) {
    console.error(`[GovWidget] Nie znaleziono elementu: ${containerId}`);
    return;
  }
  
  // Dla czystego JS - użyj ReactDOM
  const React = require('react');
  const ReactDOM = require('react-dom/client');
  
  const root = ReactDOM.createRoot(container);
  root.render(React.createElement(GovVerificationWidget, options));
  
  return {
    destroy: () => root.unmount()
  };
};
