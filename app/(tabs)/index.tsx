/**
 * Główny ekran aplikacji mObywatel - "Prawda w Sieci"
 * Skaner QR do weryfikacji autentyczności stron rządowych
 * 
 * @author Hackathon Team
 * @version 1.0.0
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';

// ============================================
// KONFIGURACJA
// ============================================
const CONFIG = {
  BACKEND_URL: __DEV__ 
    ? 'http://10.250.193.86:3001' // IP komputera w sieci lokalnej
    : 'https://api.prawda-w-sieci.gov.pl',
  REQUEST_TIMEOUT: 10000, // 10 sekund
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================
// TYPY
// ============================================

type VerificationStatus = 'idle' | 'scanning' | 'verifying' | 'success' | 'warning' | 'error';

interface VerificationResult {
  status: VerificationStatus;
  message: string;
  details?: {
    domain?: string;
    verifiedAt?: string;
    certificateInfo?: {
      issuer: string;
      validUntil: string;
      status: string;
    };
    reason?: string;
  };
  warning?: string;
}

interface QRPayload {
  type: string;
  version: string;
  nonce: string;
  url: string;
  timestamp: number;
  domain: string;
}

// ============================================
// GŁÓWNY KOMPONENT
// ============================================

export default function VerificationScanner() {
  // Stan aplikacji
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [scanHistory, setScanHistory] = useState<Array<{
    domain: string;
    status: string;
    timestamp: Date;
  }>>([]);

  // Animacje
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Referencja do blokady skanowania (zapobiega wielokrotnemu skanowaniu)
  const scanLockRef = useRef(false);

  // ============================================
  // ANIMACJE
  // ============================================

  useEffect(() => {
    // Animacja pulsowania przycisku
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  useEffect(() => {
    // Animacja linii skanowania
    if (isScanning) {
      const scanLine = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
      scanLine.start();
      return () => scanLine.stop();
    }
  }, [isScanning]);

  // ============================================
  // FUNKCJE POMOCNICZE
  // ============================================

  /**
   * Dekoduje payload z kodu QR
   */
  const decodeQRPayload = (data: string): QRPayload | null => {
    try {
      // Próba dekodowania base64
      const decoded = atob(data);
      const payload = JSON.parse(decoded);
      
      // Walidacja struktury
      if (payload.type !== 'GOV_VERIFY' || !payload.nonce || !payload.url) {
        console.warn('[Scanner] Nieprawidłowa struktura QR:', payload);
        return null;
      }
      
      return payload;
    } catch (error) {
      console.error('[Scanner] Błąd dekodowania QR:', error);
      return null;
    }
  };

  /**
   * Wysyła żądanie weryfikacji do backendu
   */
  const verifyWithBackend = async (payload: QRPayload): Promise<VerificationResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
      console.log('[Scanner] Wysyłanie żądania weryfikacji...');
      
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Version': '1.0.0',
          'X-Platform': Platform.OS,
        },
        body: JSON.stringify({
          nonce: payload.nonce,
          url: payload.url,
          appVersion: '1.0.0',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      console.log('[Scanner] Odpowiedź serwera:', data);

      if (data.success && data.trusted === true) {
        return {
          status: 'success',
          message: data.message || '✅ Strona jest zaufana',
          details: data.details,
        };
      } else if (data.success && data.trusted === false) {
        return {
          status: 'warning',
          message: data.message || '⚠️ Strona NIE jest na liście zaufanych',
          warning: data.warning,
          details: data.details,
        };
      } else {
        return {
          status: 'error',
          message: data.error || 'Błąd weryfikacji',
          warning: data.warning,
        };
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        return {
          status: 'error',
          message: '⏱️ Przekroczono czas oczekiwania',
          warning: 'Sprawdź połączenie internetowe i spróbuj ponownie.',
        };
      }
      
      console.error('[Scanner] Błąd połączenia:', error);
      return {
        status: 'error',
        message: '❌ Brak połączenia z serwerem',
        warning: 'Nie można zweryfikować strony. Sprawdź połączenie internetowe.',
      };
    }
  };

  /**
   * Obsługa zeskanowania kodu QR
   */
  const handleBarCodeScanned = useCallback(async ({ data }: { data: string }) => {
    // Blokada wielokrotnego skanowania
    if (scanLockRef.current || isVerifying) return;
    scanLockRef.current = true;

    console.log('[Scanner] Zeskanowano kod QR');
    
    // Feedback haptyczny
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Vibration.vibrate(100);
    }

    setIsScanning(false);
    setIsVerifying(true);
    setIsModalVisible(true);

    // Dekoduj payload
    const payload = decodeQRPayload(data);

    if (!payload) {
      setVerificationResult({
        status: 'error',
        message: '❌ Nieprawidłowy kod QR',
        warning: 'Ten kod nie pochodzi z systemu "Prawda w Sieci".',
      });
      setIsVerifying(false);
      scanLockRef.current = false;
      return;
    }

    // Sprawdź czy kod nie jest zbyt stary (max 5 minut)
    const codeAge = Date.now() - payload.timestamp;
    if (codeAge > 5 * 60 * 1000) {
      setVerificationResult({
        status: 'warning',
        message: '⏰ Kod QR wygasł',
        warning: 'Odśwież stronę internetową i zeskanuj nowy kod.',
      });
      setIsVerifying(false);
      scanLockRef.current = false;
      return;
    }

    // Weryfikacja z backendem
    const result = await verifyWithBackend(payload);
    setVerificationResult(result);
    setIsVerifying(false);

    // Dodaj do historii
    setScanHistory(prev => [
      {
        domain: payload.domain,
        status: result.status,
        timestamp: new Date(),
      },
      ...prev.slice(0, 9), // Ostatnie 10 skanów
    ]);

    // Feedback haptyczny dla wyniku
    if (Platform.OS !== 'web') {
      if (result.status === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (result.status === 'warning') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }

    // Odblokuj skanowanie po 2 sekundach
    setTimeout(() => {
      scanLockRef.current = false;
    }, 2000);
  }, [isVerifying]);

  /**
   * Testowanie certyfikatu SSL strony rządowej
   */
  const testSSLCertificate = async (url: string, name: string) => {
    // Pokaż modal z ładowaniem
    setIsModalVisible(true);
    setIsVerifying(true);
    setVerificationResult(null);

    // Feedback haptyczny
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      console.log(`[SSL] Testowanie certyfikatu dla: ${url}`);

      const response = await fetch(`${CONFIG.BACKEND_URL}/api/ssl/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Version': '1.0.0',
          'X-Platform': Platform.OS,
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      console.log('[SSL] Odpowiedź:', data);

      if (data.valid) {
        // Sprawdź czy certyfikat jest od zaufanego CA rządowego
        const isTrustedGovCA = data.certificate?.isTrustedGovCA;
        
        if (isTrustedGovCA) {
          setVerificationResult({
            status: 'success',
            message: `✅ Certyfikat SSL dla ${name} jest prawidłowy i pochodzi od zaufanego urzędu certyfikacji!`,
            details: {
              domain: data.domain,
              verifiedAt: new Date().toLocaleString('pl-PL'),
              certificateInfo: {
                issuer: data.certificate?.issuer || 'Nieznany',
                validUntil: data.certificate?.validTo ? new Date(data.certificate.validTo).toLocaleDateString('pl-PL') : 'Nieznana',
                status: 'Zaufany certyfikat rządowy',
              },
            },
          });
        } else {
          setVerificationResult({
            status: 'warning',
            message: `⚠️ Certyfikat SSL dla ${name} jest ważny, ale nie pochodzi od standardowego urzędu certyfikacji rządowego.`,
            warning: `Wydawca: ${data.certificate?.issuer || 'Nieznany'}`,
            details: {
              domain: data.domain,
              verifiedAt: new Date().toLocaleString('pl-PL'),
              certificateInfo: {
                issuer: data.certificate?.issuer || 'Nieznany',
                validUntil: data.certificate?.validTo ? new Date(data.certificate.validTo).toLocaleDateString('pl-PL') : 'Nieznana',
                status: 'Certyfikat ważny (inny CA)',
              },
            },
          });
        }

        // Feedback sukcesu
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        // Certyfikat nieważny lub problem
        const issues = data.issues?.map((i: any) => `${i.code}: ${i.message}`).join('\n') || 'Nieznany błąd';
        
        setVerificationResult({
          status: 'error',
          message: `❌ Problem z certyfikatem SSL dla ${name}`,
          warning: issues,
          details: {
            domain: data.domain,
            verifiedAt: new Date().toLocaleString('pl-PL'),
            certificateInfo: {
              issuer: data.certificate?.issuer || 'Nieznany',
              validUntil: 'N/A',
              status: 'Certyfikat nieważny lub wygasły',
            },
          },
        });

        // Feedback błędu
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }

      // Dodaj do historii
      setScanHistory(prev => [
        {
          domain: name,
          status: data.valid ? 'success' : 'error',
          timestamp: new Date(),
        },
        ...prev.slice(0, 9),
      ]);

    } catch (error) {
      console.error('[SSL] Błąd:', error);
      
      setVerificationResult({
        status: 'error',
        message: `❌ Nie można połączyć się z serwerem weryfikacji`,
        warning: 'Sprawdź połączenie internetowe i czy backend jest uruchomiony.',
      });

      // Feedback błędu
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  /**
   * Rozpocznij skanowanie
   */
  const startScanning = () => {
    setVerificationResult(null);
    setIsScanning(true);
  };

  /**
   * Zamknij modal wyników
   */
  const closeResultModal = () => {
    setIsModalVisible(false);
    setVerificationResult(null);
  };

  // ============================================
  // RENDEROWANIE - EKRAN UPRAWNIEŃ
  // ============================================

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color="#dc2626" />
        <Text style={styles.permissionText}>Ładowanie...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <LinearGradient
          colors={['#1a1a2e', '#16213e', '#0f3460']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.permissionContent}>
          <MaterialCommunityIcons name="camera-off" size={80} color="#dc2626" />
          <Text style={styles.permissionTitle}>Wymagany dostęp do kamery</Text>
          <Text style={styles.permissionDescription}>
            Aby zeskanować kod QR i zweryfikować stronę internetową, 
            aplikacja potrzebuje dostępu do aparatu.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Zezwól na dostęp</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================
  // RENDEROWANIE - GŁÓWNY EKRAN
  // ============================================

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#1a1a2e', '#16213e', '#0f3460']}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoEmoji}>🏛️</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>mObywatel</Text>
            <Text style={styles.headerSubtitle}>Prawda w Sieci</Text>
          </View>
        </View>
      </View>

      {/* Główna zawartość */}
      {isScanning ? (
        // Widok skanera
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          >
            {/* Overlay skanera */}
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerFrame}>
                {/* Rogi ramki */}
                <View style={[styles.cornerTopLeft, styles.corner]} />
                <View style={[styles.cornerTopRight, styles.corner]} />
                <View style={[styles.cornerBottomLeft, styles.corner]} />
                <View style={[styles.cornerBottomRight, styles.corner]} />
                
                {/* Animowana linia skanowania */}
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [
                        {
                          translateY: scanLineAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 230],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              </View>
            </View>
          </CameraView>

          {/* Instrukcje */}
          <View style={styles.scannerInstructions}>
            <Text style={styles.scannerInstructionText}>
              Skieruj kamerę na kod QR
            </Text>
            <Text style={styles.scannerInstructionSubtext}>
              Kod znajdziesz w prawym dolnym rogu strony internetowej
            </Text>
          </View>

          {/* Przycisk anulowania */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setIsScanning(false)}
          >
            <Ionicons name="close" size={24} color="#fff" />
            <Text style={styles.cancelButtonText}>Anuluj</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Ekran główny
        <View style={styles.mainContent}>
          {/* Ilustracja */}
          <View style={styles.illustration}>
            <View style={styles.shieldContainer}>
              <LinearGradient
                colors={['#dc2626', '#b91c1c']}
                style={styles.shieldGradient}
              >
                <MaterialCommunityIcons name="shield-check" size={60} color="#fff" />
              </LinearGradient>
            </View>
          </View>

          {/* Opis */}
          <View style={styles.descriptionContainer}>
            <Text style={styles.mainTitle}>Zweryfikuj stronę</Text>
            <Text style={styles.mainDescription}>
              Zeskanuj kod QR wyświetlany na stronie internetowej, 
              aby sprawdzić czy jest to prawdziwa strona rządowa.
            </Text>
          </View>

          {/* Przycisk skanowania */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={styles.scanButton}
              onPress={startScanning}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#dc2626', '#b91c1c']}
                style={styles.scanButtonGradient}
              >
                <MaterialCommunityIcons name="qrcode-scan" size={32} color="#fff" />
                <Text style={styles.scanButtonText}>Skanuj kod QR</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Ostrzeżenia */}
          <View style={styles.warningBox}>
            <Ionicons name="information-circle" size={20} color="#f59e0b" />
            <Text style={styles.warningText}>
              Nigdy nie podawaj danych osobowych na stronie, której autentyczności nie zweryfikowałeś.
            </Text>
          </View>

          {/* Szybka weryfikacja SSL stron rządowych */}
          <View style={styles.govLinksSection}>
            <Text style={styles.govLinksTitle}>🔐 Sprawdź certyfikat SSL</Text>
            <Text style={styles.govLinksSubtitle}>
              Kliknij, aby zweryfikować certyfikat SSL strony rządowej
            </Text>
            
            <View style={styles.govLinksList}>
              {[
                { url: 'https://gov.pl', name: 'gov.pl', icon: '🏛️' },
                { url: 'https://dane.gov.pl', name: 'dane.gov.pl', icon: '📊' },
                { url: 'https://obywatel.gov.pl', name: 'obywatel.gov.pl', icon: '👤' },
                { url: 'https://biznes.gov.pl', name: 'biznes.gov.pl', icon: '💼' },
                { url: 'https://moj.gov.pl', name: 'moj.gov.pl', icon: '📋' },
                { url: 'https://epuap.gov.pl', name: 'epuap.gov.pl', icon: '📨' },
              ].map((site, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.govLinkItem}
                  onPress={() => testSSLCertificate(site.url, site.name)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.govLinkIcon}>{site.icon}</Text>
                  <Text style={styles.govLinkName}>{site.name}</Text>
                  <Ionicons name="shield-checkmark" size={16} color="#10b981" />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Historia skanów */}
          {scanHistory.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Ostatnie weryfikacje</Text>
              {scanHistory.slice(0, 3).map((item, index) => (
                <View key={index} style={styles.historyItem}>
                  <View style={[
                    styles.historyStatusDot,
                    item.status === 'success' && styles.statusSuccess,
                    item.status === 'warning' && styles.statusWarning,
                    item.status === 'error' && styles.statusError,
                  ]} />
                  <Text style={styles.historyDomain}>{item.domain}</Text>
                  <Text style={styles.historyTime}>
                    {item.timestamp.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Modal wyników */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={closeResultModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {isVerifying ? (
              // Stan weryfikacji
              <View style={styles.verifyingContainer}>
                <ActivityIndicator size="large" color="#dc2626" />
                <Text style={styles.verifyingText}>Weryfikacja w toku...</Text>
                <Text style={styles.verifyingSubtext}>
                  Sprawdzanie autentyczności strony
                </Text>
              </View>
            ) : verificationResult ? (
              // Wynik weryfikacji
              <>
                {/* Ikona statusu */}
                <View style={[
                  styles.resultIconContainer,
                  verificationResult.status === 'success' && styles.resultIconSuccess,
                  verificationResult.status === 'warning' && styles.resultIconWarning,
                  verificationResult.status === 'error' && styles.resultIconError,
                ]}>
                  {verificationResult.status === 'success' && (
                    <MaterialCommunityIcons name="shield-check" size={60} color="#10b981" />
                  )}
                  {verificationResult.status === 'warning' && (
                    <MaterialCommunityIcons name="shield-alert" size={60} color="#f59e0b" />
                  )}
                  {verificationResult.status === 'error' && (
                    <MaterialCommunityIcons name="shield-off" size={60} color="#ef4444" />
                  )}
                </View>

                {/* Wiadomość */}
                <Text style={[
                  styles.resultTitle,
                  verificationResult.status === 'success' && styles.textSuccess,
                  verificationResult.status === 'warning' && styles.textWarning,
                  verificationResult.status === 'error' && styles.textError,
                ]}>
                  {verificationResult.status === 'success' && 'Strona zweryfikowana!'}
                  {verificationResult.status === 'warning' && 'Uwaga!'}
                  {verificationResult.status === 'error' && 'Błąd weryfikacji'}
                </Text>

                <Text style={styles.resultMessage}>
                  {verificationResult.message}
                </Text>

                {verificationResult.warning && (
                  <View style={styles.resultWarningBox}>
                    <Ionicons name="warning" size={20} color="#f59e0b" />
                    <Text style={styles.resultWarningText}>
                      {verificationResult.warning}
                    </Text>
                  </View>
                )}

                {/* Szczegóły */}
                {verificationResult.details && (
                  <View style={styles.detailsContainer}>
                    {verificationResult.details.domain && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Domena:</Text>
                        <Text style={styles.detailValue}>
                          {verificationResult.details.domain}
                        </Text>
                      </View>
                    )}
                    {verificationResult.details.verifiedAt && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Czas weryfikacji:</Text>
                        <Text style={styles.detailValue}>
                          {new Date(verificationResult.details.verifiedAt).toLocaleString('pl-PL')}
                        </Text>
                      </View>
                    )}
                    {verificationResult.details.certificateInfo && (
                      <>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Wydawca certyfikatu:</Text>
                          <Text style={styles.detailValue}>
                            {verificationResult.details.certificateInfo.issuer}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Status:</Text>
                          <Text style={[styles.detailValue, styles.textSuccess]}>
                            {verificationResult.details.certificateInfo.status}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                )}

                {/* Przyciski akcji */}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalButton}
                    onPress={closeResultModal}
                  >
                    <Text style={styles.modalButtonText}>Zamknij</Text>
                  </TouchableOpacity>

                  {verificationResult.status === 'success' && (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonPrimary]}
                      onPress={() => {
                        closeResultModal();
                        // Można dodać nawigację do strony
                      }}
                    >
                      <Text style={styles.modalButtonPrimaryText}>
                        Kontynuuj bezpiecznie
                      </Text>
                    </TouchableOpacity>
                  )}

                  {verificationResult.status === 'warning' && (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonDanger]}
                      onPress={() => {
                        closeResultModal();
                        // Możliwość zgłoszenia
                      }}
                    >
                      <Text style={styles.modalButtonDangerText}>
                        Zgłoś stronę
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================
// STYLE
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  
  // Header
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoEmoji: {
    fontSize: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },

  // Permission Screen
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  permissionContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 24,
    textAlign: 'center',
  },
  permissionDescription: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  permissionText: {
    color: '#fff',
    marginTop: 16,
  },
  permissionButton: {
    marginTop: 32,
    backgroundColor: '#dc2626',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Main Content
  mainContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  illustration: {
    alignItems: 'center',
    marginBottom: 32,
  },
  shieldContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  shieldGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  descriptionContainer: {
    marginBottom: 32,
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  mainDescription: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 24,
  },

  // Scan Button
  scanButton: {
    marginBottom: 24,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  scanButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 12,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },

  // Warning Box
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#fcd34d',
    lineHeight: 20,
  },

  // Scanner View
  scannerContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#dc2626',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  scanLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 2,
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  scannerInstructions: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scannerInstructionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  scannerInstructionSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  cancelButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },

  // History Section
  historySection: {
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  historyStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusSuccess: {
    backgroundColor: '#10b981',
  },
  statusWarning: {
    backgroundColor: '#f59e0b',
  },
  statusError: {
    backgroundColor: '#ef4444',
  },
  historyDomain: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
  },
  historyTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: SCREEN_HEIGHT * 0.5,
  },
  verifyingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  verifyingText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 20,
  },
  verifyingSubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
  },

  // Result
  resultIconContainer: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  resultIconSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  resultIconWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  resultIconError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  textSuccess: {
    color: '#10b981',
  },
  textWarning: {
    color: '#f59e0b',
  },
  textError: {
    color: '#ef4444',
  },
  resultMessage: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 24,
  },
  resultWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  resultWarningText: {
    flex: 1,
    fontSize: 14,
    color: '#fcd34d',
    lineHeight: 20,
  },
  detailsContainer: {
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  detailLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  detailValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonPrimary: {
    backgroundColor: '#10b981',
  },
  modalButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonDanger: {
    backgroundColor: '#ef4444',
  },
  modalButtonDangerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },

  // Gov Links Section - SSL Check
  govLinksSection: {
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  govLinksTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  govLinksSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 16,
  },
  govLinksList: {
    gap: 8,
  },
  govLinkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  govLinkIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  govLinkName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});