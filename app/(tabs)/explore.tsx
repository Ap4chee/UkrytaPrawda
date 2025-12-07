import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// Konfiguracja API - używaj IP komputera dla testów na prawdziwym urządzeniu
const __DEV__ = true;
const API_URL = __DEV__ 
  ? 'http://10.250.193.86:3001'  // IP komputera w sieci lokalnej
  : 'https://api.prawda-w-sieci.gov.pl';

// Dane testowe z urls.json
const SSL_TEST_DATA: Record<string, Array<{ name: string; url: string }>> = {
  "🎫 Certificate": [
    { name: "expired", url: "https://expired.badssl.com/" },
    { name: "wrong.host", url: "https://wrong.host.badssl.com/" },
    { name: "self-signed", url: "https://self-signed.badssl.com/" },
    { name: "untrusted-root", url: "https://untrusted-root.badssl.com/" },
    { name: "revoked", url: "https://revoked.badssl.com/" },
    { name: "pinning-test", url: "https://pinning-test.badssl.com/" },
    { name: "no-common-name", url: "https://no-common-name.badssl.com/" },
    { name: "no-subject", url: "https://no-subject.badssl.com/" },
    { name: "incomplete-chain", url: "https://incomplete-chain.badssl.com/" },
    { name: "sha256", url: "https://sha256.badssl.com/" },
    { name: "sha384", url: "https://sha384.badssl.com/" },
    { name: "sha512", url: "https://sha512.badssl.com/" },
    { name: "1000-sans", url: "https://1000-sans.badssl.com/" },
    { name: "10000-sans", url: "https://10000-sans.badssl.com/" },
    { name: "ecc256", url: "https://ecc256.badssl.com/" },
    { name: "ecc384", url: "https://ecc384.badssl.com/" },
    { name: "rsa2048", url: "https://rsa2048.badssl.com/" },
    { name: "rsa4096", url: "https://rsa4096.badssl.com/" },
    { name: "rsa8192", url: "https://rsa8192.badssl.com/" },
    { name: "extended-validation", url: "https://extended-validation.badssl.com/" },
  ],
  "🎟 Client Certificate": [
    { name: "client", url: "https://client.badssl.com/" },
    { name: "client-cert-missing", url: "https://client-cert-missing.badssl.com/" },
  ],
  "🖼 Mixed Content": [
    { name: "mixed-script", url: "https://mixed-script.badssl.com/" },
    { name: "very", url: "https://very.badssl.com/" },
    { name: "mixed", url: "https://mixed.badssl.com/" },
    { name: "mixed-favicon", url: "https://mixed-favicon.badssl.com/" },
    { name: "mixed-form", url: "https://mixed-form.badssl.com/" },
  ],
  "✏️ HTTP (nieszyfrowane)": [
    { name: "http", url: "http://http.badssl.com/" },
    { name: "http-textarea", url: "http://http-textarea.badssl.com/" },
    { name: "http-password", url: "http://http-password.badssl.com/" },
    { name: "http-login", url: "http://http-login.badssl.com/" },
    { name: "http-dynamic-login", url: "http://http-dynamic-login.badssl.com/" },
    { name: "http-credit-card", url: "http://http-credit-card.badssl.com/" },
  ],
  "🔀 Cipher Suite": [
    { name: "cbc", url: "https://cbc.badssl.com/" },
    { name: "rc4-md5", url: "https://rc4-md5.badssl.com/" },
    { name: "rc4", url: "https://rc4.badssl.com/" },
    { name: "3des", url: "https://3des.badssl.com/" },
    { name: "null", url: "https://null.badssl.com/" },
    { name: "mozilla-old", url: "https://mozilla-old.badssl.com/" },
    { name: "mozilla-intermediate", url: "https://mozilla-intermediate.badssl.com/" },
    { name: "mozilla-modern", url: "https://mozilla-modern.badssl.com/" },
  ],
  "🔑 Key Exchange": [
    { name: "dh480", url: "https://dh480.badssl.com/" },
    { name: "dh512", url: "https://dh512.badssl.com/" },
    { name: "dh1024", url: "https://dh1024.badssl.com/" },
    { name: "dh2048", url: "https://dh2048.badssl.com/" },
    { name: "dh-small-subgroup", url: "https://dh-small-subgroup.badssl.com/" },
    { name: "dh-composite", url: "https://dh-composite.badssl.com/" },
    { name: "static-rsa", url: "https://static-rsa.badssl.com/" },
  ],
  "↔️ Protocol": [
    { name: "tls-v1-0", url: "https://tls-v1-0.badssl.com:1010/" },
    { name: "tls-v1-1", url: "https://tls-v1-1.badssl.com:1011/" },
    { name: "tls-v1-2", url: "https://tls-v1-2.badssl.com:1012/" },
  ],
  "⬆️ Upgrade/HSTS": [
    { name: "hsts", url: "https://hsts.badssl.com/" },
    { name: "upgrade", url: "https://upgrade.badssl.com/" },
    { name: "preloaded-hsts", url: "https://preloaded-hsts.badssl.com/" },
    { name: "subdomain.preloaded-hsts", url: "https://subdomain.preloaded-hsts.badssl.com/" },
    { name: "https-everywhere", url: "https://https-everywhere.badssl.com/" },
  ],
  "❌ Known Bad": [
    { name: "(Lenovo) Superfish", url: "https://superfish.badssl.com/" },
    { name: "(Dell) eDellRoot", url: "https://edellroot.badssl.com/" },
    { name: "(Dell) DSD Test Provider", url: "https://dsdtestprovider.badssl.com/" },
    { name: "preact-cli", url: "https://preact-cli.badssl.com/" },
    { name: "webpack-dev-server", url: "https://webpack-dev-server.badssl.com/" },
  ],
  "☠️ Defunct": [
    { name: "sha1-2016", url: "https://sha1-2016.badssl.com/" },
    { name: "sha1-2017", url: "https://sha1-2017.badssl.com/" },
    { name: "sha1-intermediate", url: "https://sha1-intermediate.badssl.com/" },
    { name: "invalid-expected-sct", url: "https://invalid-expected-sct.badssl.com/" },
  ],
};

type TestStatus = 'pending' | 'testing' | 'success' | 'warning' | 'error';

interface TestResult {
  url: string;
  status: TestStatus;
  message?: string;
  details?: {
    valid?: boolean;
    protocol?: string;
    issuer?: string;
    expiresIn?: number;
    errorCode?: string;
    errorMessage?: string;
  };
}

export default function SSLTestsScreen() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, tested: 0, success: 0, warning: 0, error: 0 });

  // Oblicz statystyki
  const calculateStats = useCallback((newResults: Record<string, TestResult>) => {
    let total = 0;
    let tested = 0;
    let success = 0;
    let warning = 0;
    let error = 0;

    Object.values(SSL_TEST_DATA).forEach(urls => {
      total += urls.length;
    });

    Object.values(newResults).forEach(result => {
      if (result.status !== 'pending' && result.status !== 'testing') {
        tested++;
        if (result.status === 'success') success++;
        else if (result.status === 'warning') warning++;
        else if (result.status === 'error') error++;
      }
    });

    setStats({ total, tested, success, warning, error });
  }, []);

  // Testuj pojedynczy URL
  const testUrl = async (url: string): Promise<TestResult> => {
    try {
      const response = await fetch(`${API_URL}/api/ssl/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      const validation = data.validation;

      if (validation?.valid) {
        return {
          url,
          status: 'success',
          message: 'Certyfikat OK',
          details: {
            valid: true,
            protocol: validation.certificate?.protocol,
            issuer: validation.certificate?.issuer,
            expiresIn: validation.certificate?.validTo ? 
              Math.floor((new Date(validation.certificate.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : undefined,
          },
        };
      } else {
        // Sprawdź czy to błąd krytyczny czy ostrzeżenie
        const issues = validation?.issues || [];
        const severity = validation?.overallSeverity || 'critical';
        const isWarning = severity === 'warning' || severity === 'info';
        const firstIssue = issues[0];
        
        return {
          url,
          status: isWarning ? 'warning' : 'error',
          message: firstIssue?.message || data.error || 'Błąd SSL',
          details: {
            valid: false,
            errorCode: firstIssue?.code,
            errorMessage: firstIssue?.userMessage || firstIssue?.message,
          },
        };
      }
    } catch (err: any) {
      return {
        url,
        status: 'error',
        message: err.message || 'Błąd połączenia',
        details: {
          valid: false,
          errorCode: 'CONNECTION_ERROR',
          errorMessage: err.message,
        },
      };
    }
  };

  // Testuj jeden URL z UI feedback
  const handleTestUrl = async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    setResults(prev => ({
      ...prev,
      [url]: { url, status: 'testing' },
    }));

    const result = await testUrl(url);
    
    setResults(prev => {
      const newResults = { ...prev, [url]: result };
      calculateStats(newResults);
      return newResults;
    });

    // Haptic feedback na wynik
    if (result.status === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (result.status === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  // Uruchom wszystkie testy
  const runAllTests = async () => {
    setIsRunningAll(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const allUrls: string[] = [];
    Object.values(SSL_TEST_DATA).forEach(urls => {
      urls.forEach(item => allUrls.push(item.url));
    });

    // Resetuj wyniki
    const initialResults: Record<string, TestResult> = {};
    allUrls.forEach(url => {
      initialResults[url] = { url, status: 'pending' };
    });
    setResults(initialResults);

    // Testuj równolegle w partiach po 5
    const batchSize = 5;
    for (let i = 0; i < allUrls.length; i += batchSize) {
      const batch = allUrls.slice(i, i + batchSize);
      
      // Oznacz jako testowane
      setResults(prev => {
        const updated = { ...prev };
        batch.forEach(url => {
          updated[url] = { url, status: 'testing' };
        });
        return updated;
      });

      // Wykonaj testy równolegle
      const batchResults = await Promise.all(batch.map(url => testUrl(url)));
      
      // Zapisz wyniki
      setResults(prev => {
        const updated = { ...prev };
        batchResults.forEach(result => {
          updated[result.url] = result;
        });
        calculateStats(updated);
        return updated;
      });

      // Krótka przerwa między partiami
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setIsRunningAll(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Toggle kategorii
  const toggleCategory = (category: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setResults({});
    setStats({ total: 0, tested: 0, success: 0, warning: 0, error: 0 });
    setRefreshing(false);
  }, []);

  // Pobierz ikonę statusu
  const getStatusIcon = (status: TestStatus) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'testing': return '🔄';
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return '❓';
    }
  };

  // Pobierz kolor statusu
  const getStatusColor = (status: TestStatus) => {
    switch (status) {
      case 'pending': return '#9ca3af';
      case 'testing': return '#3b82f6';
      case 'success': return '#22c55e';
      case 'warning': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  // Oblicz statystyki kategorii
  const getCategoryStats = (urls: Array<{ name: string; url: string }>) => {
    let success = 0, warning = 0, error = 0, pending = 0;
    urls.forEach(item => {
      const result = results[item.url];
      if (!result || result.status === 'pending' || result.status === 'testing') {
        pending++;
      } else if (result.status === 'success') {
        success++;
      } else if (result.status === 'warning') {
        warning++;
      } else {
        error++;
      }
    });
    return { success, warning, error, pending, total: urls.length };
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <LinearGradient
        colors={['#1e3a5f', '#0f2744']}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>🔐 SSL Tester</Text>
          <Text style={styles.headerSubtitle}>
            Testowanie certyfikatów z badssl.com
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Wszystkie</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>{stats.success}</Text>
            <Text style={styles.statLabel}>OK</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#f59e0b' }]}>{stats.warning}</Text>
            <Text style={styles.statLabel}>Ostrzeż.</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#ef4444' }]}>{stats.error}</Text>
            <Text style={styles.statLabel}>Błędy</Text>
          </View>
        </View>

        {/* Run All Button */}
        <TouchableOpacity
          style={[styles.runAllButton, isRunningAll && styles.runAllButtonDisabled]}
          onPress={runAllTests}
          disabled={isRunningAll}
        >
          {isRunningAll ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.runAllButtonText}>
                Testowanie... ({stats.tested}/{stats.total})
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.runAllButtonIcon}>🚀</Text>
              <Text style={styles.runAllButtonText}>Uruchom wszystkie testy</Text>
            </>
          )}
        </TouchableOpacity>
      </LinearGradient>

      {/* Test List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {Object.entries(SSL_TEST_DATA).map(([category, urls]) => {
          const categoryStats = getCategoryStats(urls);
          const isExpanded = expandedCategories[category];

          return (
            <View key={category} style={styles.categoryContainer}>
              {/* Category Header */}
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(category)}
              >
                <View style={styles.categoryTitleContainer}>
                  <Text style={styles.categoryTitle}>{category}</Text>
                  <View style={styles.categoryBadges}>
                    {categoryStats.success > 0 && (
                      <View style={[styles.badge, { backgroundColor: '#dcfce7' }]}>
                        <Text style={[styles.badgeText, { color: '#166534' }]}>
                          ✓ {categoryStats.success}
                        </Text>
                      </View>
                    )}
                    {categoryStats.warning > 0 && (
                      <View style={[styles.badge, { backgroundColor: '#fef3c7' }]}>
                        <Text style={[styles.badgeText, { color: '#92400e' }]}>
                          ⚠ {categoryStats.warning}
                        </Text>
                      </View>
                    )}
                    {categoryStats.error > 0 && (
                      <View style={[styles.badge, { backgroundColor: '#fee2e2' }]}>
                        <Text style={[styles.badgeText, { color: '#991b1b' }]}>
                          ✗ {categoryStats.error}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
              </TouchableOpacity>

              {/* URL List */}
              {isExpanded && (
                <View style={styles.urlList}>
                  {urls.map((item, index) => {
                    const result = results[item.url];
                    const status = result?.status || 'pending';

                    return (
                      <TouchableOpacity
                        key={index}
                        style={styles.urlItem}
                        onPress={() => handleTestUrl(item.url)}
                        disabled={status === 'testing'}
                      >
                        <View style={styles.urlContent}>
                          <View style={styles.urlHeader}>
                            <Text style={styles.urlName}>{item.name}</Text>
                            {status === 'testing' ? (
                              <ActivityIndicator size="small" color="#3b82f6" />
                            ) : (
                              <Text style={styles.statusIcon}>{getStatusIcon(status)}</Text>
                            )}
                          </View>
                          <Text style={styles.urlText} numberOfLines={1}>
                            {item.url}
                          </Text>
                          {result?.message && status !== 'pending' && (
                            <Text
                              style={[styles.resultMessage, { color: getStatusColor(status) }]}
                              numberOfLines={2}
                            >
                              {result.message}
                            </Text>
                          )}
                          {result?.details?.protocol && status === 'success' && (
                            <Text style={styles.detailsText}>
                              {result.details.protocol} • {result.details.issuer}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {/* Info Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Dane testowe pochodzą z badssl.com
          </Text>
          <Text style={styles.footerSubtext}>
            Dotknij URL aby przetestować • Pociągnij w dół aby zresetować
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerContent: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  runAllButton: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  runAllButtonDisabled: {
    backgroundColor: '#6b7280',
  },
  runAllButtonIcon: {
    fontSize: 18,
  },
  runAllButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  categoryContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  categoryTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  categoryBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  expandIcon: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 8,
  },
  urlList: {
    padding: 8,
  },
  urlItem: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#f9fafb',
  },
  urlContent: {
    flex: 1,
  },
  urlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  urlName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    flex: 1,
  },
  statusIcon: {
    fontSize: 16,
    marginLeft: 8,
  },
  urlText: {
    fontSize: 12,
    color: '#6b7280',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  resultMessage: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
  },
  detailsText: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
