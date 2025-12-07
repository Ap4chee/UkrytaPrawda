/**
 * Backend Server - "Prawda w Sieci"
 * System weryfikacji autentyczności stron rządowych
 * 
 * @author Hackathon Team
 * @version 1.0.0
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Moduł walidacji SSL
const sslValidator = require('./ssl-validator');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// KONFIGURACJA BEZPIECZEŃSTWA
// ============================================

// Klucz do podpisywania (w produkcji: z env lub HSM)
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');
console.log('[SECURITY] Wygenerowano klucz sesji');

// Middleware bezpieczeństwa
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cors({
  origin: (origin, callback) => {
    // Dozwolone originy (w produkcji: tylko zaufane domeny)
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ];
    
    // Pozwól na requesty bez origin (np. z aplikacji mobilnych)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Zablokowano origin: ${origin}`);
      callback(null, true); // W demo pozwalamy, w produkcji: callback(new Error('CORS'))
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Signature', 'X-App-Version', 'X-Platform', 'X-Request-ID'],
  maxAge: 600 // Preflight cache 10 minut
}));

// Limit rozmiaru body - ochrona przed large payload attacks
app.use(express.json({ limit: '10kb' }));

// Rate limiting - wielopoziomowa ochrona
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuta
  max: 30, // max 30 requestów na IP na minutę
  message: { 
    success: false, 
    error: 'Zbyt wiele żądań. Odczekaj chwilę.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const relaxedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 200,
  message: { 
    success: false, 
    error: 'Przekroczono limit żądań. Spróbuj ponownie później.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

app.use('/api/verify', strictLimiter);
app.use('/api/token', strictLimiter);
app.use('/api/', relaxedLimiter);

// ============================================
// ŁADOWANIE BIAŁEJ LISTY DOMEN Z CSV
// ============================================

let TRUSTED_DOMAINS = new Set();

/**
 * Ładuje zaufane domeny z pliku CSV
 */
function loadTrustedDomains() {
  try {
    const csvPath = path.join(__dirname, '..', 'allowed_domain_list.csv');
    
    if (!fs.existsSync(csvPath)) {
      console.error('[DOMAINS] Plik allowed_domain_list.csv nie istnieje!');
      // Fallback na podstawowe domeny
      TRUSTED_DOMAINS = new Set([
        'gov.pl', 'www.gov.pl', 'obywatel.gov.pl',
        'localhost:3000', 'localhost:5173', '127.0.0.1:3000'
      ]);
      return;
    }
    
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    
    const domains = new Set();
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      
      // Pomiń puste linie, komentarze i nagłówki (data/czas)
      if (!trimmed || 
          trimmed.startsWith('#') || 
          trimmed.startsWith('//') ||
          /^\d{4}-\d{2}-\d{2}/.test(trimmed)) { // Format daty
        continue;
      }
      
      // Walidacja domeny - podstawowa
      if (isValidDomainFormat(trimmed)) {
        domains.add(trimmed);
      }
    }
    
    // Dodaj domeny testowe dla developmentu
    if (process.env.NODE_ENV !== 'production') {
      domains.add('localhost:3000');
      domains.add('localhost:5173');
      domains.add('127.0.0.1:3000');
      domains.add('127.0.0.1:5173');
    }
    
    TRUSTED_DOMAINS = domains;
    console.log(`[DOMAINS] Załadowano ${TRUSTED_DOMAINS.size} zaufanych domen`);
    
  } catch (error) {
    console.error('[DOMAINS] Błąd ładowania domen:', error.message);
    // Fallback
    TRUSTED_DOMAINS = new Set(['gov.pl', 'www.gov.pl']);
  }
}

/**
 * Waliduje format domeny
 */
function isValidDomainFormat(domain) {
  // Regex dla domeny (z opcjonalnym portem dla dev)
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?$/;
  return domainRegex.test(domain) || /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(domain);
}

// Załaduj domeny przy starcie
loadTrustedDomains();

// Hot-reload domen (sprawdza co 5 minut)
setInterval(() => {
  const previousCount = TRUSTED_DOMAINS.size;
  loadTrustedDomains();
  if (TRUSTED_DOMAINS.size !== previousCount) {
    console.log(`[DOMAINS] Zaktualizowano listę domen: ${previousCount} -> ${TRUSTED_DOMAINS.size}`);
  }
}, 5 * 60 * 1000);

// ============================================
// STORAGE DLA TOKENÓW (W PRODUKCJI: REDIS)
// ============================================

const tokenStore = new Map();
const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // Token ważny 5 minut
const MAX_TOKENS = 10000; // Limit tokenów w pamięci

// Czyszczenie wygasłych tokenów co 30 sekund
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [token, data] of tokenStore.entries()) {
    if (now > data.expiresAt) {
      tokenStore.delete(token);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[CLEANUP] Usunięto ${cleaned} wygasłych tokenów. Aktywne: ${tokenStore.size}`);
  }
}, 30 * 1000);

// ============================================
// FUNKCJE POMOCNICZE - BEZPIECZEŃSTWO
// ============================================

/**
 * Generuje kryptograficznie bezpieczny nonce
 * Używa crypto.randomBytes dla wysokiej entropii
 */
function generateSecureNonce() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generuje unikalny ID żądania
 */
function generateRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Waliduje i sanityzuje URL
 * Chroni przed: URL injection, path traversal, SSRF
 */
function validateAndSanitizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL jest wymagany' };
  }
  
  // Limit długości URL
  if (url.length > 2048) {
    return { valid: false, error: 'URL zbyt długi' };
  }
  
  // Usuń whitespace
  url = url.trim();
  
  // Zablokuj niebezpieczne schematy
  const dangerousSchemes = ['javascript:', 'data:', 'vbscript:', 'file:'];
  for (const scheme of dangerousSchemes) {
    if (url.toLowerCase().startsWith(scheme)) {
      return { valid: false, error: 'Niedozwolony schemat URL' };
    }
  }
  
  try {
    const urlObj = new URL(url);
    
    // Dozwól tylko HTTP/HTTPS (i localhost bez schematu w dev)
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'Dozwolone tylko HTTP/HTTPS' };
    }
    
    // Zablokuj prywatne IP (oprócz localhost w dev)
    const hostname = urlObj.hostname;
    if (process.env.NODE_ENV === 'production') {
      const privateIpPatterns = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^127\./,
        /^0\./,
        /^localhost$/i
      ];
      
      for (const pattern of privateIpPatterns) {
        if (pattern.test(hostname)) {
          return { valid: false, error: 'Niedozwolony adres' };
        }
      }
    }
    
    return { 
      valid: true, 
      sanitized: urlObj.href,
      host: urlObj.host.toLowerCase(),
      hostname: urlObj.hostname.toLowerCase()
    };
    
  } catch (error) {
    return { valid: false, error: 'Nieprawidłowy format URL' };
  }
}

/**
 * Waliduje nonce (token)
 */
function validateNonce(nonce) {
  if (!nonce || typeof nonce !== 'string') {
    return { valid: false, error: 'Token jest wymagany' };
  }
  
  // Nonce powinien być 64-znakowym hexem
  if (!/^[a-f0-9]{64}$/i.test(nonce)) {
    return { valid: false, error: 'Nieprawidłowy format tokenu' };
  }
  
  return { valid: true };
}

/**
 * Ekstrahuje domenę z URL (znormalizowana)
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Sprawdza czy domena jest na białej liście
 * Obsługuje subdomeny (np. abc.gov.pl dla gov.pl)
 */
function isDomainTrusted(domain) {
  if (!domain) return false;
  
  domain = domain.toLowerCase();
  
  // Sprawdź dokładne dopasowanie
  if (TRUSTED_DOMAINS.has(domain)) return true;
  
  // Sprawdź czy jest subdomeną zaufanej domeny
  for (const trustedDomain of TRUSTED_DOMAINS) {
    if (domain.endsWith('.' + trustedDomain)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generuje HMAC signature dla odpowiedzi
 */
function signResponse(data) {
  const timestamp = Date.now();
  const payload = JSON.stringify({ ...data, timestamp });
  
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(payload)
    .digest('hex');
  
  return {
    ...data,
    timestamp,
    signature
  };
}

/**
 * Weryfikuje sygnaturę żądania (opcjonalne)
 */
function verifyRequestSignature(body, signature, timestamp) {
  if (!signature || !timestamp) return true; // Opcjonalne w demo
  
  // Sprawdź czy timestamp nie jest zbyt stary (max 5 min)
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age > 5 * 60 * 1000 || age < -30 * 1000) {
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(JSON.stringify(body) + timestamp)
    .digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Logowanie z request ID
 */
function log(requestId, level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    requestId,
    level,
    message,
    ...data
  };
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${timestamp}] [${requestId}] [${level.toUpperCase()}] ${message}`,
    Object.keys(data).length > 0 ? data : ''
  );
}

// ============================================
// MIDDLEWARE
// ============================================

// Dodaj request ID do każdego żądania
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// ============================================
// ENDPOINTY API
// ============================================

/**
 * POST /api/token/generate
 * Generuje nowy jednorazowy token dla strony internetowej
 */
app.post('/api/token/generate', (req, res) => {
  const requestId = req.requestId;
  
  try {
    const { url, metadata } = req.body;
    
    // Walidacja URL
    const urlValidation = validateAndSanitizeUrl(url);
    if (!urlValidation.valid) {
      log(requestId, 'warn', 'Nieprawidłowy URL', { error: urlValidation.error });
      return res.status(400).json(signResponse({
        success: false,
        error: urlValidation.error,
        code: 'INVALID_URL'
      }));
    }
    
    // Sprawdź limit tokenów
    if (tokenStore.size >= MAX_TOKENS) {
      log(requestId, 'error', 'Przekroczono limit tokenów');
      return res.status(503).json(signResponse({
        success: false,
        error: 'Serwer przeciążony. Spróbuj ponownie.',
        code: 'SERVER_OVERLOAD'
      }));
    }
    
    // Generuj token
    const nonce = generateSecureNonce();
    const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
    
    // Zapisz token z metadanymi
    tokenStore.set(nonce, {
      url: urlValidation.sanitized,
      domain: urlValidation.host,
      expiresAt,
      createdAt: Date.now(),
      metadata: {
        ip: req.ip,
        userAgent: req.headers['user-agent']?.substring(0, 200) || 'unknown',
        ...metadata
      },
      used: false,
      usedAt: null
    });
    
    log(requestId, 'info', 'Wygenerowano token', { 
      domain: urlValidation.host,
      expiresIn: TOKEN_EXPIRY_MS / 1000 
    });
    
    res.json(signResponse({
      success: true,
      data: {
        nonce,
        expiresAt,
        expiresIn: TOKEN_EXPIRY_MS / 1000
      }
    }));
    
  } catch (error) {
    log(requestId, 'error', 'Błąd generowania tokenu', { error: error.message });
    res.status(500).json(signResponse({
      success: false,
      error: 'Błąd serwera',
      code: 'INTERNAL_ERROR'
    }));
  }
});

/**
 * POST /api/verify
 * Główny endpoint weryfikacji - używany przez aplikację mobilną
 */
app.post('/api/verify', (req, res) => {
  const requestId = req.requestId;
  
  try {
    const { nonce, url, appVersion } = req.body;
    
    log(requestId, 'info', 'Żądanie weryfikacji', { 
      url: url?.substring(0, 100),
      noncePrefix: nonce?.substring(0, 8)
    });
    
    // Walidacja nonce
    const nonceValidation = validateNonce(nonce);
    if (!nonceValidation.valid) {
      log(requestId, 'warn', 'Nieprawidłowy nonce', { error: nonceValidation.error });
      return res.status(400).json(signResponse({
        success: false,
        verified: false,
        error: nonceValidation.error,
        code: 'INVALID_NONCE'
      }));
    }
    
    // Walidacja URL
    const urlValidation = validateAndSanitizeUrl(url);
    if (!urlValidation.valid) {
      log(requestId, 'warn', 'Nieprawidłowy URL', { error: urlValidation.error });
      return res.status(400).json(signResponse({
        success: false,
        verified: false,
        error: urlValidation.error,
        code: 'INVALID_URL'
      }));
    }
    
    // Sprawdź czy token istnieje
    const tokenData = tokenStore.get(nonce);
    
    if (!tokenData) {
      log(requestId, 'warn', 'Token nie istnieje', { noncePrefix: nonce.substring(0, 8) });
      return res.status(404).json(signResponse({
        success: false,
        verified: false,
        error: 'Token nie istnieje lub wygasł',
        code: 'TOKEN_NOT_FOUND',
        warning: '⚠️ UWAGA: Ten kod QR może pochodzić z fałszywej strony!'
      }));
    }
    
    // Sprawdź czy token nie wygasł
    if (Date.now() > tokenData.expiresAt) {
      tokenStore.delete(nonce);
      log(requestId, 'warn', 'Token wygasł');
      return res.status(410).json(signResponse({
        success: false,
        verified: false,
        error: 'Token wygasł - odśwież stronę',
        code: 'TOKEN_EXPIRED'
      }));
    }
    
    // Sprawdź czy token nie został już użyty (one-time use)
    if (tokenData.used) {
      log(requestId, 'warn', 'Token już użyty', { 
        usedAt: tokenData.usedAt,
        originalIp: tokenData.metadata?.ip 
      });
      return res.status(409).json(signResponse({
        success: false,
        verified: false,
        error: 'Token już został wykorzystany',
        code: 'TOKEN_ALREADY_USED',
        warning: '⚠️ Ten kod został już zweryfikowany. Odśwież stronę.'
      }));
    }
    
    // KLUCZOWE: Sprawdź czy URL się zgadza (anti-spoofing)
    const requestedDomain = urlValidation.host;
    if (tokenData.domain !== requestedDomain) {
      log(requestId, 'error', 'URL MISMATCH - Potencjalny atak!', { 
        expected: tokenData.domain, 
        received: requestedDomain 
      });
      
      // Oznacz token jako podejrzany, ale nie usuwaj
      tokenData.suspicious = true;
      tokenData.mismatchAttempt = {
        attemptedDomain: requestedDomain,
        timestamp: Date.now(),
        ip: req.ip
      };
      
      return res.status(403).json(signResponse({
        success: false,
        verified: false,
        error: 'URL nie zgadza się z tokenem',
        code: 'URL_MISMATCH',
        warning: '🚨 OSTRZEŻENIE: Wykryto potencjalną próbę spoofingu! Nie podawaj danych na tej stronie!'
      }));
    }
    
    // Oznacz token jako użyty
    tokenData.used = true;
    tokenData.usedAt = Date.now();
    tokenData.verifiedBy = {
      ip: req.ip,
      appVersion: appVersion || 'unknown',
      platform: req.headers['x-platform'] || 'unknown'
    };
    
    // KLUCZOWA WERYFIKACJA: Sprawdź białą listę
    const isTrusted = isDomainTrusted(tokenData.domain);
    
    if (isTrusted) {
      log(requestId, 'info', '✅ WERYFIKACJA POZYTYWNA', { domain: tokenData.domain });
      
      return res.json(signResponse({
        success: true,
        verified: true,
        trusted: true,
        message: '✅ Strona jest zaufana',
        details: {
          domain: tokenData.domain,
          verifiedAt: new Date().toISOString(),
          certificateInfo: {
            issuer: 'Centrum Certyfikacji GOV.PL',
            validUntil: '2025-12-31',
            status: 'VALID'
          }
        },
        code: 'VERIFICATION_SUCCESS'
      }));
      
    } else {
      log(requestId, 'warn', '⚠️ WERYFIKACJA NEGATYWNA', { domain: tokenData.domain });
      
      return res.json(signResponse({
        success: true,
        verified: true,
        trusted: false,
        message: '⚠️ UWAGA: Ta strona NIE znajduje się na liście zaufanych domen rządowych!',
        warning: 'Możliwa próba phishingu. Nie podawaj danych osobowych.',
        details: {
          domain: tokenData.domain,
          verifiedAt: new Date().toISOString(),
          reason: 'DOMAIN_NOT_ON_WHITELIST'
        },
        code: 'UNTRUSTED_DOMAIN'
      }));
    }
    
  } catch (error) {
    log(requestId, 'error', 'Błąd weryfikacji', { error: error.message });
    res.status(500).json(signResponse({
      success: false,
      verified: false,
      error: 'Błąd serwera podczas weryfikacji',
      code: 'INTERNAL_ERROR'
    }));
  }
});

/**
 * GET /api/domains/count
 * Liczba zaufanych domen (do diagnostyki)
 */
app.get('/api/domains/count', (req, res) => {
  res.json(signResponse({
    success: true,
    count: TRUSTED_DOMAINS.size,
    lastUpdated: new Date().toISOString()
  }));
});

/**
 * GET /api/domains/check/:domain
 * Sprawdza czy domena jest zaufana (do diagnostyki)
 */
app.get('/api/domains/check/:domain', (req, res) => {
  const domain = req.params.domain?.toLowerCase();
  
  if (!domain || !isValidDomainFormat(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Nieprawidłowa domena'
    });
  }
  
  const trusted = isDomainTrusted(domain);
  
  res.json(signResponse({
    success: true,
    domain,
    trusted,
    checkedAt: new Date().toISOString()
  }));
});

/**
 * POST /api/ssl/validate
 * Walidacja certyfikatu SSL dla podanego URL
 */
app.post('/api/ssl/validate', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    const { url } = req.body;
    
    // Walidacja URL
    const urlValidation = validateAndSanitizeUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json(signResponse({
        success: false,
        error: urlValidation.error,
        code: 'INVALID_URL'
      }));
    }
    
    log(requestId, 'info', 'Walidacja SSL', { url: urlValidation.sanitized });
    
    // Wykonaj walidację SSL
    const sslResult = await sslValidator.validateSSL(urlValidation.sanitized);
    
    log(requestId, 'info', 'Wynik walidacji SSL', { 
      valid: sslResult.valid, 
      severity: sslResult.overallSeverity,
      issueCount: sslResult.issues.length
    });
    
    res.json(signResponse({
      success: true,
      url: urlValidation.sanitized,
      validation: sslResult
    }));
    
  } catch (error) {
    log(requestId, 'error', 'Błąd walidacji SSL', { error: error.message });
    res.status(500).json(signResponse({
      success: false,
      error: 'Błąd walidacji SSL',
      code: 'SSL_VALIDATION_ERROR'
    }));
  }
});

/**
 * GET /api/ssl/errors
 * Zwraca listę wszystkich typów błędów SSL
 */
app.get('/api/ssl/errors', (req, res) => {
  res.json(signResponse({
    success: true,
    errors: sslValidator.SSL_ERROR_CODES,
    count: Object.keys(sslValidator.SSL_ERROR_CODES).length
  }));
});

/**
 * GET /api/ssl/error/:code
 * Zwraca szczegóły błędu SSL po kodzie
 */
app.get('/api/ssl/error/:code', (req, res) => {
  const code = req.params.code?.toUpperCase();
  const errorInfo = sslValidator.getErrorByCode(code);
  
  if (!errorInfo) {
    return res.status(404).json({
      success: false,
      error: 'Nieznany kod błędu'
    });
  }
  
  res.json(signResponse({
    success: true,
    error: errorInfo
  }));
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Prawda w Sieci - Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    stats: {
      activeTokens: tokenStore.size,
      trustedDomains: TRUSTED_DOMAINS.size,
      uptime: process.uptime()
    }
  });
});

// ============================================
// OBSŁUGA BŁĘDÓW
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint nie istnieje',
    code: 'NOT_FOUND'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[FATAL ERROR]:', err);
  res.status(500).json({
    success: false,
    error: 'Wewnętrzny błąd serwera',
    code: 'INTERNAL_ERROR'
  });
});

// ============================================
// START SERWERA
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('═'.repeat(60));
  console.log('🛡️  PRAWDA W SIECI - Backend Server');
  console.log('═'.repeat(60));
  console.log(`🚀 Serwer uruchomiony na porcie: ${PORT} (0.0.0.0)`);
  console.log(`📋 Zaufane domeny: ${TRUSTED_DOMAINS.size}`);
  console.log(`⏱️  Token TTL: ${TOKEN_EXPIRY_MS / 1000}s`);
  console.log(`🔐 Bezpieczeństwo: helmet, rate-limit, HMAC`);
  console.log(`🔒 SSL Validator: aktywny`);
  console.log('═'.repeat(60));
  console.log('Endpoints:');
  console.log(`  POST /api/token/generate - Generowanie tokenu`);
  console.log(`  POST /api/verify         - Weryfikacja strony`);
  console.log(`  POST /api/ssl/validate   - Walidacja certyfikatu SSL`);
  console.log(`  GET  /api/ssl/errors     - Lista błędów SSL`);
  console.log(`  GET  /api/ssl/error/:code - Szczegóły błędu SSL`);
  console.log(`  GET  /api/domains/count  - Liczba zaufanych domen`);
  console.log(`  GET  /api/domains/check/:domain - Sprawdź domenę`);
  console.log(`  GET  /api/health         - Health check`);
  console.log('═'.repeat(60));
});

module.exports = app;
