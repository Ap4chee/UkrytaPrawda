/**
 * SSL Certificate Validator - "Prawda w Sieci"
 * Moduł walidacji certyfikatów SSL/TLS
 * 
 * @author Hackathon Team
 * @version 1.0.0
 */

const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

// ============================================
// KONFIGURACJA
// ============================================

const SSL_CHECK_TIMEOUT = 10000; // 10 sekund timeout
const MIN_KEY_SIZE = 2048; // Minimalna długość klucza RSA
const MIN_TLS_VERSION = 'TLSv1.2';

// ============================================
// ZAUFANE URZĘDY CERTYFIKACJI DLA GOV.PL
// ============================================

// Lista zaufanych CA dla stron rządowych (gov.pl)
const TRUSTED_GOV_CERTIFICATE_AUTHORITIES = [
  // Certum - główny CA dla polskich stron rządowych
  'Certum Domain Validation CA SHA2',
  'Certum Trusted Network CA',
  'Certum Trusted Network CA 2',
  'Certum',
  'Unizeto Technologies S.A.',
  
  // Inne polskie CA
  'COPE SZAFIR - Pair A',
  'Centrum Certyfikacji COPE',
  'Sigillum',
  
  // Międzynarodowe CA używane przez niektóre strony gov.pl
  'DigiCert',
  'GlobalSign',
  'Comodo',
  'Sectigo',
  'Let\'s Encrypt',
  'ISRG Root',
];

// Wzorce organizacji w certyfikatach gov.pl
const GOV_PL_CERT_PATTERNS = {
  // Organizacje w polu Subject
  organizations: [
    'Centrum Informatyki',
    'Kancelaria Prezesa Rady Ministrów',
    'Ministerstwo',
    'NASK',
    'COI',
    'Centralny Ośrodek Informatyki',
  ],
  // Dozwolone domeny w SAN
  domains: [
    '.gov.pl',
    '.gob.pl',
    '.edu.pl',
  ]
};

// Znane niebezpieczne certyfikaty (fingerprints)
const KNOWN_BAD_CERTS = new Set([
  // Superfish
  'c864484869d41d2b0d32319c5a62f9315aaf2cbd',
  // eDellRoot  
  '98a04e4163357790c4a79e6d713ff0af51fe6927',
  // Więcej można dodać z bazy CVE
]);

// Słabe algorytmy szyfrowania
const WEAK_CIPHERS = [
  'RC4', 'DES', '3DES', 'MD5', 'NULL', 'EXPORT', 'anon'
];

// Przestarzałe algorytmy podpisu
const WEAK_SIGNATURES = [
  'md5', 'sha1'
];

// ============================================
// TYPY BŁĘDÓW SSL
// ============================================

const SSL_ERROR_CODES = {
  // Certyfikat
  CERT_EXPIRED: {
    code: 'CERT_EXPIRED',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat SSL wygasł',
    userMessage: 'UWAGA! Zabezpieczenia tej strony wygasły. Nie wprowadzaj żadnych danych osobowych. Zamknij stronę.',
    icon: '🔴'
  },
  CERT_NOT_YET_VALID: {
    code: 'CERT_NOT_YET_VALID',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat jeszcze nie jest ważny',
    userMessage: 'Certyfikat tej strony jest nieprawidłowy. Strona może być fałszywa.',
    icon: '🔴'
  },
  CERT_CN_MISMATCH: {
    code: 'CERT_CN_MISMATCH',
    severity: 'CRITICAL',
    technicalDesc: 'Nazwa w certyfikacie nie pasuje do domeny',
    userMessage: 'UWAGA! Ta strona podszywa się pod inną stronę. To może być oszustwo!',
    icon: '🔴'
  },
  CERT_SELF_SIGNED: {
    code: 'CERT_SELF_SIGNED',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat samopodpisany',
    userMessage: 'Ta strona nie ma wiarygodnego certyfikatu. Prawdziwe strony urzędowe mają oficjalne certyfikaty.',
    icon: '🔴'
  },
  CERT_UNTRUSTED_ROOT: {
    code: 'CERT_UNTRUSTED_ROOT',
    severity: 'CRITICAL',
    technicalDesc: 'Nieznany/niezaufany główny urząd certyfikacji',
    userMessage: 'Nie można potwierdzić tożsamości tej strony. Certyfikat pochodzi z nieznanego źródła.',
    icon: '🔴'
  },
  CERT_REVOKED: {
    code: 'CERT_REVOKED',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat został odwołany (OCSP/CRL)',
    userMessage: 'NIEBEZPIECZEŃSTWO! Certyfikat tej strony został unieważniony. Strona może być zagrożona!',
    icon: '🔴'
  },
  CERT_CHAIN_INCOMPLETE: {
    code: 'CERT_CHAIN_INCOMPLETE',
    severity: 'HIGH',
    technicalDesc: 'Niepełny łańcuch certyfikacji',
    userMessage: 'Nie można w pełni zweryfikować strony. Brakuje części certyfikatu.',
    icon: '🟠'
  },
  CERT_INVALID: {
    code: 'CERT_INVALID',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat jest uszkodzony lub nieprawidłowy',
    userMessage: 'Certyfikat strony jest uszkodzony lub nieprawidłowy.',
    icon: '🔴'
  },
  
  // Szyfrowanie
  NO_ENCRYPTION: {
    code: 'NO_ENCRYPTION',
    severity: 'CRITICAL',
    technicalDesc: 'Brak szyfrowania HTTPS (plaintext HTTP)',
    userMessage: 'NIEBEZPIECZNE! Ta strona nie jest szyfrowana. Twoje dane mogą być przechwycone!',
    icon: '🔴'
  },
  NULL_CIPHER: {
    code: 'NULL_CIPHER',
    severity: 'CRITICAL',
    technicalDesc: 'Cipher suite bez szyfrowania (NULL)',
    userMessage: 'BŁĄD KRYTYCZNY! Ta strona w ogóle nie szyfruje połączenia!',
    icon: '🔴'
  },
  WEAK_CIPHER_RC4: {
    code: 'WEAK_CIPHER_RC4',
    severity: 'HIGH',
    technicalDesc: 'Użyto złamanego szyfru RC4',
    userMessage: 'Ta strona używa przestarzałego szyfrowania. Zalecamy ostrożność.',
    icon: '🟠'
  },
  WEAK_CIPHER_3DES: {
    code: 'WEAK_CIPHER_3DES',
    severity: 'HIGH',
    technicalDesc: 'Użyto słabego szyfru 3DES',
    userMessage: 'Szyfrowanie tej strony jest przestarzałe. Unikaj wrażliwych operacji.',
    icon: '🟠'
  },
  WEAK_CIPHER_CBC: {
    code: 'WEAK_CIPHER_CBC',
    severity: 'MEDIUM',
    technicalDesc: 'Użyto trybu CBC (podatny na BEAST)',
    userMessage: 'Szyfrowanie strony może mieć słabe punkty. Zachowaj ostrożność.',
    icon: '🟡'
  },
  
  // Protokół
  OLD_TLS_VERSION: {
    code: 'OLD_TLS_VERSION',
    severity: 'MEDIUM',
    technicalDesc: 'Przestarzały protokół TLS (< 1.2)',
    userMessage: 'Ta strona używa przestarzałej wersji zabezpieczeń. Nowoczesne strony używają nowszych.',
    icon: '🟠'
  },
  
  // Klucz
  WEAK_KEY_SIZE: {
    code: 'WEAK_KEY_SIZE',
    severity: 'HIGH',
    technicalDesc: 'Za krótki klucz kryptograficzny (< 2048 bit)',
    userMessage: 'Zabezpieczenia tej strony są za słabe dla ochrony Twoich danych.',
    icon: '🟠'
  },
  
  // Podpis
  WEAK_SIGNATURE_SHA1: {
    code: 'WEAK_SIGNATURE_SHA1',
    severity: 'MEDIUM',
    technicalDesc: 'Certyfikat podpisany słabym algorytmem SHA1',
    userMessage: 'Certyfikat strony używa przestarzałego podpisu. Zachowaj ostrożność.',
    icon: '🟠'
  },
  WEAK_SIGNATURE_MD5: {
    code: 'WEAK_SIGNATURE_MD5',
    severity: 'HIGH',
    technicalDesc: 'Certyfikat podpisany złamanym algorytmem MD5',
    userMessage: 'UWAGA! Certyfikat używa niebezpiecznego podpisu. Strona może być fałszywa.',
    icon: '🟠'
  },
  
  // Mixed content
  MIXED_CONTENT_SCRIPT: {
    code: 'MIXED_CONTENT_SCRIPT',
    severity: 'HIGH',
    technicalDesc: 'Skrypt ładowany przez HTTP na stronie HTTPS',
    userMessage: 'UWAGA! Część tej strony nie jest bezpieczna i może być podmieniona przez oszustów.',
    icon: '🔴'
  },
  MIXED_CONTENT: {
    code: 'MIXED_CONTENT',
    severity: 'MEDIUM',
    technicalDesc: 'Elementy strony ładowane przez HTTP',
    userMessage: 'Niektóre elementy strony nie są szyfrowane.',
    icon: '🟠'
  },
  
  // Znane zagrożenia
  KNOWN_MALWARE_CERT: {
    code: 'KNOWN_MALWARE_CERT',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat powiązany ze znanym malware',
    userMessage: 'WYKRYTO ZŁOŚLIWE OPROGRAMOWANIE! Ta strona używa certyfikatu powiązanego z wirusem.',
    icon: '🔴'
  },
  
  // Połączenie
  SSL_CONNECTION_FAILED: {
    code: 'SSL_CONNECTION_FAILED',
    severity: 'CRITICAL',
    technicalDesc: 'Nie można nawiązać połączenia SSL',
    userMessage: 'Nie można nawiązać bezpiecznego połączenia ze stroną.',
    icon: '🔴'
  },
  CONNECTION_TIMEOUT: {
    code: 'CONNECTION_TIMEOUT',
    severity: 'MEDIUM',
    technicalDesc: 'Timeout podczas sprawdzania certyfikatu',
    userMessage: 'Weryfikacja trwa zbyt długo. Sprawdź połączenie internetowe.',
    icon: '🟡'
  },
  
  // Weryfikacja GOV.PL
  GOV_UNTRUSTED_CA: {
    code: 'GOV_UNTRUSTED_CA',
    severity: 'CRITICAL',
    technicalDesc: 'Certyfikat nie pochodzi od zaufanego CA dla gov.pl',
    userMessage: 'UWAGA! Ta strona gov.pl używa podejrzanego certyfikatu! Prawdziwe strony rządowe mają certyfikaty od polskich urzędów certyfikacji.',
    icon: '🔴'
  },
  GOV_CERT_VALID: {
    code: 'GOV_CERT_VALID',
    severity: 'OK',
    technicalDesc: 'Certyfikat pochodzi od zaufanego CA dla gov.pl (Certum)',
    userMessage: 'Certyfikat tej strony rządowej jest prawidłowy i pochodzi od zaufanego polskiego urzędu certyfikacji.',
    icon: '🟢'
  },
  
  // OK
  SSL_VALID: {
    code: 'SSL_VALID',
    severity: 'OK',
    technicalDesc: 'Certyfikat SSL jest prawidłowy',
    userMessage: 'Połączenie jest bezpieczne i szyfrowane.',
    icon: '🟢'
  }
};

// ============================================
// FUNKCJE WALIDACJI
// ============================================

/**
 * Główna funkcja walidacji SSL
 * @param {string} url - URL do sprawdzenia
 * @returns {Promise<Object>} Wynik walidacji
 */
async function validateSSL(url) {
  const result = {
    valid: false,
    issues: [],
    details: {},
    overallSeverity: 'OK',
    timestamp: new Date().toISOString()
  };
  
  try {
    // Parsuj URL
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const port = urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80);
    
    result.details.hostname = hostname;
    result.details.port = port;
    result.details.protocol = urlObj.protocol;
    
    // Sprawdź czy w ogóle jest HTTPS
    if (urlObj.protocol !== 'https:') {
      result.issues.push(SSL_ERROR_CODES.NO_ENCRYPTION);
      result.overallSeverity = 'CRITICAL';
      return result;
    }
    
    // Pobierz certyfikat i informacje o połączeniu
    const certInfo = await getCertificateInfo(hostname, port);
    
    if (certInfo.error) {
      result.issues.push({
        ...SSL_ERROR_CODES.SSL_CONNECTION_FAILED,
        technicalDesc: certInfo.error
      });
      result.overallSeverity = 'CRITICAL';
      return result;
    }
    
    result.details.certificate = certInfo.certificate;
    result.details.connection = certInfo.connection;
    
    // Sprawdź ważność czasową
    const validityIssues = checkCertificateValidity(certInfo.certificate);
    result.issues.push(...validityIssues);
    
    // Sprawdź CN/SAN
    const identityIssues = checkCertificateIdentity(certInfo.certificate, hostname);
    result.issues.push(...identityIssues);
    
    // Sprawdź łańcuch zaufania
    const chainIssues = checkChainOfTrust(certInfo);
    result.issues.push(...chainIssues);
    
    // Sprawdź algorytm podpisu
    const signatureIssues = checkSignatureAlgorithm(certInfo.certificate);
    result.issues.push(...signatureIssues);
    
    // Sprawdź długość klucza
    const keyIssues = checkKeyStrength(certInfo.certificate);
    result.issues.push(...keyIssues);
    
    // Sprawdź wersję TLS
    const tlsIssues = checkTLSVersion(certInfo.connection);
    result.issues.push(...tlsIssues);
    
    // Sprawdź cipher suite
    const cipherIssues = checkCipherSuite(certInfo.connection);
    result.issues.push(...cipherIssues);
    
    // Sprawdź znane złe certyfikaty
    const malwareIssues = checkKnownBadCerts(certInfo.certificate);
    result.issues.push(...malwareIssues);
    
    // NOWE: Sprawdź CA dla stron gov.pl
    const govIssues = checkGovPlCertificate(certInfo.certificate, hostname);
    result.issues.push(...govIssues);
    
    // Dodaj info o CA do szczegółów
    result.details.isGovPl = hostname.endsWith('.gov.pl');
    result.details.issuerCA = certInfo.certificate?.issuer?.CN || certInfo.certificate?.issuer?.O || 'unknown';
    result.details.isTrustedGovCA = isFromTrustedGovCA(certInfo.certificate);
    
    // Oblicz overall severity
    result.overallSeverity = calculateOverallSeverity(result.issues);
    result.valid = result.overallSeverity === 'OK' || result.overallSeverity === 'LOW';
    
    // Dodaj sukces jeśli brak problemów
    if (result.issues.length === 0) {
      result.issues.push(SSL_ERROR_CODES.SSL_VALID);
    }
    
  } catch (error) {
    result.issues.push({
      ...SSL_ERROR_CODES.SSL_CONNECTION_FAILED,
      technicalDesc: error.message
    });
    result.overallSeverity = 'CRITICAL';
  }
  
  return result;
}

/**
 * Pobiera informacje o certyfikacie SSL
 */
function getCertificateInfo(hostname, port) {
  return new Promise((resolve) => {
    const options = {
      host: hostname,
      port: port,
      servername: hostname,
      rejectUnauthorized: false, // Chcemy sprawdzić nawet nieprawidłowe certy
      timeout: SSL_CHECK_TIMEOUT,
      requestCert: true
    };
    
    const socket = tls.connect(options, () => {
      try {
        const cert = socket.getPeerCertificate(true);
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();
        const authorized = socket.authorized;
        const authError = socket.authorizationError;
        
        // Bezpieczna ekstrakcja danych bez circular references
        const safeCertData = {
          subject: cert.subject ? { ...cert.subject } : null,
          issuer: cert.issuer ? { ...cert.issuer } : null,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          fingerprint: cert.fingerprint,
          fingerprint256: cert.fingerprint256,
          serialNumber: cert.serialNumber,
          subjectAltNames: parseSubjectAltNames(cert.subjectaltname),
          signatureAlgorithm: cert.sigalg || extractSignatureAlgorithm(cert),
          publicKey: {
            type: cert.pubkey ? 'RSA' : 'unknown',
            bits: cert.bits || estimateKeyBits(cert.modulus)
          }
          // NIE dodajemy 'raw: cert' - ma circular reference
        };
        
        resolve({
          certificate: safeCertData,
          connection: {
            protocol,
            cipher: cipher?.name,
            cipherVersion: cipher?.version,
            authorized,
            authorizationError: authError
          }
        });
        
        socket.end();
      } catch (err) {
        resolve({ error: err.message });
        socket.destroy();
      }
    });
    
    socket.on('error', (err) => {
      resolve({ error: err.message });
    });
    
    socket.setTimeout(SSL_CHECK_TIMEOUT, () => {
      resolve({ error: 'Connection timeout' });
      socket.destroy();
    });
  });
}

/**
 * Parsuje Subject Alt Names
 */
function parseSubjectAltNames(san) {
  if (!san) return [];
  return san.split(', ').map(entry => {
    const parts = entry.split(':');
    return parts.length > 1 ? parts[1] : entry;
  });
}

/**
 * Ekstrakcja algorytmu podpisu
 */
function extractSignatureAlgorithm(cert) {
  if (cert.infoAccess) {
    // Próba ekstrakcji z innych pól
  }
  return 'unknown';
}

/**
 * Estymacja rozmiaru klucza
 */
function estimateKeyBits(modulus) {
  if (!modulus) return 0;
  return modulus.length * 4; // Przybliżenie dla hex
}

/**
 * Sprawdza ważność czasową certyfikatu
 */
function checkCertificateValidity(cert) {
  const issues = [];
  const now = new Date();
  
  if (cert.validTo) {
    const validTo = new Date(cert.validTo);
    if (now > validTo) {
      issues.push(SSL_ERROR_CODES.CERT_EXPIRED);
    }
  }
  
  if (cert.validFrom) {
    const validFrom = new Date(cert.validFrom);
    if (now < validFrom) {
      issues.push(SSL_ERROR_CODES.CERT_NOT_YET_VALID);
    }
  }
  
  return issues;
}

/**
 * Sprawdza zgodność CN/SAN z hostname
 */
function checkCertificateIdentity(cert, hostname) {
  const issues = [];
  
  // Sprawdź SAN
  if (cert.subjectAltNames && cert.subjectAltNames.length > 0) {
    const matchesSAN = cert.subjectAltNames.some(san => {
      if (san.startsWith('*.')) {
        // Wildcard
        const domain = san.slice(2);
        return hostname.endsWith(domain) && 
               hostname.split('.').length === san.split('.').length;
      }
      return san.toLowerCase() === hostname.toLowerCase();
    });
    
    if (!matchesSAN) {
      issues.push(SSL_ERROR_CODES.CERT_CN_MISMATCH);
    }
  } else if (cert.subject?.CN) {
    // Fallback do CN
    const cn = cert.subject.CN.toLowerCase();
    if (cn.startsWith('*.')) {
      const domain = cn.slice(2);
      if (!hostname.endsWith(domain)) {
        issues.push(SSL_ERROR_CODES.CERT_CN_MISMATCH);
      }
    } else if (cn !== hostname.toLowerCase()) {
      issues.push(SSL_ERROR_CODES.CERT_CN_MISMATCH);
    }
  }
  
  return issues;
}

/**
 * Sprawdza łańcuch zaufania
 */
function checkChainOfTrust(certInfo) {
  const issues = [];
  
  if (certInfo.connection) {
    if (!certInfo.connection.authorized) {
      const error = certInfo.connection.authorizationError;
      
      if (error?.includes('SELF_SIGNED') || error?.includes('self signed')) {
        issues.push(SSL_ERROR_CODES.CERT_SELF_SIGNED);
      } else if (error?.includes('UNABLE_TO_GET_ISSUER') || 
                 error?.includes('UNABLE_TO_VERIFY')) {
        issues.push(SSL_ERROR_CODES.CERT_UNTRUSTED_ROOT);
      } else if (error?.includes('CERT_CHAIN')) {
        issues.push(SSL_ERROR_CODES.CERT_CHAIN_INCOMPLETE);
      } else if (error?.includes('CERT_REVOKED')) {
        issues.push(SSL_ERROR_CODES.CERT_REVOKED);
      }
    }
  }
  
  return issues;
}

/**
 * Sprawdza algorytm podpisu
 */
function checkSignatureAlgorithm(cert) {
  const issues = [];
  const sigAlg = (cert.signatureAlgorithm || '').toLowerCase();
  
  if (sigAlg.includes('md5')) {
    issues.push(SSL_ERROR_CODES.WEAK_SIGNATURE_MD5);
  } else if (sigAlg.includes('sha1') && !sigAlg.includes('sha1with')) {
    // SHA1 jest słaby, ale sha1WithRSA był powszechny
    issues.push(SSL_ERROR_CODES.WEAK_SIGNATURE_SHA1);
  }
  
  return issues;
}

/**
 * Sprawdza siłę klucza
 */
function checkKeyStrength(cert) {
  const issues = [];
  
  if (cert.publicKey?.bits && cert.publicKey.bits < MIN_KEY_SIZE) {
    issues.push(SSL_ERROR_CODES.WEAK_KEY_SIZE);
  }
  
  return issues;
}

/**
 * Sprawdza wersję TLS
 */
function checkTLSVersion(connection) {
  const issues = [];
  
  if (connection?.protocol) {
    const protocol = connection.protocol;
    
    if (protocol === 'TLSv1' || protocol === 'TLSv1.1' || 
        protocol === 'SSLv3' || protocol === 'SSLv2') {
      issues.push(SSL_ERROR_CODES.OLD_TLS_VERSION);
    }
  }
  
  return issues;
}

/**
 * Sprawdza cipher suite
 */
function checkCipherSuite(connection) {
  const issues = [];
  
  if (connection?.cipher) {
    const cipher = connection.cipher.toUpperCase();
    
    if (cipher.includes('NULL')) {
      issues.push(SSL_ERROR_CODES.NULL_CIPHER);
    } else if (cipher.includes('RC4')) {
      issues.push(SSL_ERROR_CODES.WEAK_CIPHER_RC4);
    } else if (cipher.includes('3DES') || cipher.includes('DES-CBC3')) {
      issues.push(SSL_ERROR_CODES.WEAK_CIPHER_3DES);
    } else if (cipher.includes('-CBC-') || cipher.includes('_CBC_')) {
      issues.push(SSL_ERROR_CODES.WEAK_CIPHER_CBC);
    }
  }
  
  return issues;
}

/**
 * Sprawdza znane złe certyfikaty
 */
function checkKnownBadCerts(cert) {
  const issues = [];
  
  if (cert.fingerprint) {
    const fp = cert.fingerprint.replace(/:/g, '').toLowerCase();
    if (KNOWN_BAD_CERTS.has(fp)) {
      issues.push(SSL_ERROR_CODES.KNOWN_MALWARE_CERT);
    }
  }
  
  // Sprawdź też po issuer
  if (cert.issuer) {
    const issuerStr = JSON.stringify(cert.issuer).toLowerCase();
    if (issuerStr.includes('superfish') || issuerStr.includes('edellroot')) {
      issues.push(SSL_ERROR_CODES.KNOWN_MALWARE_CERT);
    }
  }
  
  return issues;
}

/**
 * Sprawdza czy certyfikat pochodzi od zaufanego CA dla gov.pl
 * @param {Object} cert - Obiekt certyfikatu
 * @returns {boolean}
 */
function isFromTrustedGovCA(cert) {
  if (!cert || !cert.issuer) return false;
  
  const issuerCN = cert.issuer.CN || '';
  const issuerO = cert.issuer.O || '';
  const issuerOU = cert.issuer.OU || '';
  
  // Sprawdź każdy zaufany CA
  for (const trustedCA of TRUSTED_GOV_CERTIFICATE_AUTHORITIES) {
    if (issuerCN.includes(trustedCA) || 
        issuerO.includes(trustedCA) ||
        issuerOU.includes(trustedCA)) {
      return true;
    }
  }
  
  // Dodatkowe sprawdzenie dla Certum (główny CA dla gov.pl)
  if (issuerCN.toLowerCase().includes('certum') ||
      issuerO.toLowerCase().includes('certum') ||
      issuerO.toLowerCase().includes('unizeto')) {
    return true;
  }
  
  return false;
}

/**
 * Sprawdza certyfikat dla stron gov.pl
 * @param {Object} cert - Obiekt certyfikatu
 * @param {string} hostname - Nazwa hosta
 * @returns {Array} Lista problemów
 */
function checkGovPlCertificate(cert, hostname) {
  const issues = [];
  
  // Sprawdzaj tylko dla domen gov.pl
  if (!hostname.endsWith('.gov.pl')) {
    return issues;
  }
  
  // Sprawdź czy CA jest zaufany dla gov.pl
  const isTrusted = isFromTrustedGovCA(cert);
  
  if (isTrusted) {
    // Dodaj pozytywną informację
    issues.push({
      ...SSL_ERROR_CODES.GOV_CERT_VALID,
      technicalDesc: `Certyfikat wydany przez: ${cert.issuer?.CN || cert.issuer?.O || 'Zaufany CA'}`
    });
  } else {
    // Certyfikat od niezaufanego CA - to podejrzane dla gov.pl!
    issues.push({
      ...SSL_ERROR_CODES.GOV_UNTRUSTED_CA,
      technicalDesc: `Certyfikat wydany przez niezaufanego CA: ${cert.issuer?.CN || cert.issuer?.O || 'Nieznany'}`
    });
  }
  
  return issues;
}

/**
 * Oblicza ogólną severity
 */
function calculateOverallSeverity(issues) {
  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OK'];
  
  for (const severity of severityOrder) {
    if (issues.some(issue => issue.severity === severity)) {
      return severity;
    }
  }
  
  return 'OK';
}

/**
 * Pobiera kod błędu po nazwie
 */
function getErrorByCode(code) {
  return SSL_ERROR_CODES[code] || null;
}

/**
 * Sprawdza URL z bad_domains.txt
 */
async function checkBadDomainUrl(url) {
  // Mapowanie znanych domen testowych na oczekiwane błędy
  const expectedErrors = {
    'expired.badssl.com': 'CERT_EXPIRED',
    'wrong.host.badssl.com': 'CERT_CN_MISMATCH',
    'self-signed.badssl.com': 'CERT_SELF_SIGNED',
    'untrusted-root.badssl.com': 'CERT_UNTRUSTED_ROOT',
    'revoked.badssl.com': 'CERT_REVOKED',
    'no-common-name.badssl.com': 'CERT_INVALID',
    'incomplete-chain.badssl.com': 'CERT_CHAIN_INCOMPLETE',
    'rc4.badssl.com': 'WEAK_CIPHER_RC4',
    '3des.badssl.com': 'WEAK_CIPHER_3DES',
    'null.badssl.com': 'NULL_CIPHER',
    'cbc.badssl.com': 'WEAK_CIPHER_CBC',
    'tls-v1-0.badssl.com': 'OLD_TLS_VERSION',
    'tls-v1-1.badssl.com': 'OLD_TLS_VERSION',
    'superfish.badssl.com': 'KNOWN_MALWARE_CERT',
    'edellroot.badssl.com': 'KNOWN_MALWARE_CERT',
    'sha1-2017.badssl.com': 'WEAK_SIGNATURE_SHA1',
    'mixed-script.badssl.com': 'MIXED_CONTENT_SCRIPT',
    'mixed.badssl.com': 'MIXED_CONTENT',
    'http.badssl.com': 'NO_ENCRYPTION',
    'http-password.badssl.com': 'NO_ENCRYPTION',
    'http-login.badssl.com': 'NO_ENCRYPTION'
  };
  
  try {
    const hostname = new URL(url).hostname;
    const expected = expectedErrors[hostname];
    
    const result = await validateSSL(url);
    
    return {
      url,
      hostname,
      expectedError: expected,
      actualResult: result,
      expectedCode: expected ? SSL_ERROR_CODES[expected] : null
    };
  } catch (error) {
    return {
      url,
      error: error.message
    };
  }
}

// ============================================
// EKSPORT
// ============================================

module.exports = {
  validateSSL,
  getCertificateInfo,
  SSL_ERROR_CODES,
  TRUSTED_GOV_CERTIFICATE_AUTHORITIES,
  getErrorByCode,
  checkBadDomainUrl,
  checkCertificateValidity,
  checkCertificateIdentity,
  checkChainOfTrust,
  checkSignatureAlgorithm,
  checkKeyStrength,
  checkTLSVersion,
  checkCipherSuite,
  checkKnownBadCerts,
  checkGovPlCertificate,
  isFromTrustedGovCA
};
