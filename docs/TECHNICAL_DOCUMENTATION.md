# 🛡️ Prawda w Sieci - Dokumentacja Techniczna

## Wersja: 1.0 | Data: 07.12.2025
## System Weryfikacji Autentyczności Stron Administracji Publicznej

---

# A. ARCHITEKTURA ROZWIĄZANIA (High-Level)

## 1. Przegląd Komponentów

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ARCHITEKTURA PRAWDA W SIECI                           │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────────┐
                                    │   CENTRALNA BAZA    │
                                    │   ZAUFANYCH DOMEN   │
                                    │  (allowed_domains)  │
                                    │   ~1400+ gov.pl     │
                                    └──────────┬──────────┘
                                               │
                                               │ Hot-reload 5min
                                               ▼
┌──────────────────┐         ┌─────────────────────────────┐         ┌──────────────────┐
│                  │   TLS   │                             │   TLS   │                  │
│  STRONA GOV.PL   │◄───────►│     BACKEND WERYFIKACJI     │◄───────►│   mOBYWATEL      │
│  (Web Widget)    │  1.3    │        (Node.js)            │  1.3    │   (Mobile App)   │
│                  │         │                             │         │                  │
└────────┬─────────┘         └─────────────┬───────────────┘         └────────┬─────────┘
         │                                 │                                  │
         │                                 │                                  │
         ▼                                 ▼                                  ▼
┌──────────────────┐         ┌─────────────────────────────┐         ┌──────────────────┐
│ • Widget React   │         │ • Token Store (In-memory)   │         │ • QR Scanner     │
│ • QR Generator   │         │ • Nonce Validation          │         │ • SSL Validator  │
│ • Auto-refresh   │         │ • SSL Certificate Check     │         │ • Result Display │
│ • Status Indicator│        │ • Rate Limiting             │         │ • History Log    │
│ • Lightweight    │         │ • HMAC Signing              │         │ • Haptic Feedback│
└──────────────────┘         └─────────────────────────────┘         └──────────────────┘
```

## 2. Flow Weryfikacji - Szczegółowy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FLOW WERYFIKACJI                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

  OBYWATEL                STRONA GOV.PL           BACKEND              mOBYWATEL
     │                         │                     │                     │
     │   1. Wchodzi na        │                     │                     │
     │      stronę            │                     │                     │
     │ ───────────────────►   │                     │                     │
     │                        │                     │                     │
     │                        │  2. POST /api/token/generate              │
     │                        │     {url, fingerprint, timestamp}         │
     │                        │ ────────────────────►                     │
     │                        │                     │                     │
     │                        │  3. Generuj Nonce   │                     │
     │                        │     - crypto.randomBytes(32)              │
     │                        │     - TTL: 5 minut  │                     │
     │                        │     - Bind to URL   │                     │
     │                        │                     │                     │
     │                        │  4. Response        │                     │
     │                        │  ◄────────────────────                    │
     │                        │  {nonce, expiresAt, │                     │
     │                        │   signature}        │                     │
     │                        │                     │                     │
     │   5. Widzi QR kod     │                     │                     │
     │ ◄───────────────────   │                     │                     │
     │                        │                     │                     │
     │   6. Skanuje QR        │                     │                     │
     │      w mObywatel       │                     │                     │
     │ ─────────────────────────────────────────────────────────────────► │
     │                        │                     │                     │
     │                        │                     │  7. POST /api/verify│
     │                        │                     │ ◄─────────────────── │
     │                        │                     │  {nonce, url,       │
     │                        │                     │   sslFingerprint}   │
     │                        │                     │                     │
     │                        │                     │  8. Walidacja:      │
     │                        │                     │  ┌─────────────────┐│
     │                        │                     │  │• Nonce valid?   ││
     │                        │                     │  │• Not expired?   ││
     │                        │                     │  │• Not used?      ││
     │                        │                     │  │• URL matches?   ││
     │                        │                     │  │• Domain trusted?││
     │                        │                     │  │• SSL valid?     ││
     │                        │                     │  └─────────────────┘│
     │                        │                     │                     │
     │                        │                     │  9. Response        │
     │                        │                     │ ────────────────────►│
     │                        │                     │  {verified, trusted,│
     │                        │                     │   sslStatus, code}  │
     │                        │                     │                     │
     │  10. Wynik weryfikacji │                     │                     │
     │ ◄───────────────────────────────────────────────────────────────── │
     │      ✅ lub ❌          │                     │                     │
     │                        │                     │                     │
```

---

## 3. MECHANIZM NONCE - Szczegółowa Specyfikacja

### 3.1 Generowanie Nonce

```javascript
// Pseudokod mechanizmu Nonce
function generateSecureNonce() {
    return {
        value: crypto.randomBytes(32).toString('hex'),  // 64 znaki hex
        createdAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000),        // 5 minut TTL
        usedAt: null,                                    // null = nieużyty
        boundUrl: null,                                  // URL strony źródłowej
        boundFingerprint: null,                          // Fingerprint sesji
        requestId: uuidv4()                              // ID audytowe
    };
}
```

### 3.2 Struktura Tokena w QR Code

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRUKTURA DANYCH W QR                        │
└─────────────────────────────────────────────────────────────────┘

QR zawiera zakodowany JSON (base64):

{
  "v": 1,                                    // Wersja protokołu
  "n": "a1b2c3d4e5f6...64chars",            // Nonce (64 hex chars)
  "u": "https://gov.pl/uslugi",             // Canonical URL
  "t": 1702000000000,                        // Timestamp generacji
  "e": 1702000300000,                        // Expiry timestamp
  "d": "gov.pl",                             // Domena (cache)
  "s": "hmac-sha256-signature"               // Podpis całości
}

Rozmiar: ~300-400 bajtów → QR Version 6-8 (optymalne)
```

### 3.3 Walidacja Nonce - Kroki

```
┌─────────────────────────────────────────────────────────────────┐
│              ALGORYTM WALIDACJI NONCE (Backend)                 │
└─────────────────────────────────────────────────────────────────┘

   START
     │
     ▼
┌────────────────┐     NIE     ┌─────────────────────────────┐
│ Nonce istnieje │ ──────────► │ REJECT: INVALID_NONCE       │
│ w Store?       │             │ "Nieprawidłowy kod"         │
└───────┬────────┘             └─────────────────────────────┘
        │ TAK
        ▼
┌────────────────┐     TAK     ┌─────────────────────────────┐
│ Nonce.usedAt   │ ──────────► │ REJECT: TOKEN_ALREADY_USED  │
│ !== null?      │             │ "Token już wykorzystany"    │
└───────┬────────┘             └─────────────────────────────┘
        │ NIE
        ▼
┌────────────────┐     TAK     ┌─────────────────────────────┐
│ Date.now() >   │ ──────────► │ REJECT: TOKEN_EXPIRED       │
│ expiresAt?     │             │ "Token wygasł"              │
└───────┬────────┘             └─────────────────────────────┘
        │ NIE
        ▼
┌────────────────┐     NIE     ┌─────────────────────────────┐
│ URL z request  │ ──────────► │ REJECT: URL_MISMATCH        │
│ === boundUrl?  │             │ "🚨 Wykryto spoofing!"      │
└───────┬────────┘             └─────────────────────────────┘
        │ TAK
        ▼
┌────────────────┐     NIE     ┌─────────────────────────────┐
│ Domena w       │ ──────────► │ WARN: UNTRUSTED_DOMAIN      │
│ whitelist?     │             │ "⚠️ Strona niezaufana"      │
└───────┬────────┘             └─────────────────────────────┘
        │ TAK
        ▼
┌────────────────┐
│ Mark as USED   │
│ nonce.usedAt = │
│ Date.now()     │
└───────┬────────┘
        │
        ▼
   ┌─────────────────────────────┐
   │ SUCCESS: VERIFICATION_OK    │
   │ "✅ Strona zweryfikowana"   │
   └─────────────────────────────┘
```

### 3.4 Ochrona przed Spoofingiem QR

```
┌─────────────────────────────────────────────────────────────────┐
│              SCENARIUSZ ATAKU I OBRONA                          │
└─────────────────────────────────────────────────────────────────┘

ATAK: Oszust kopiuje QR z prawdziwej strony gov.pl na fake-gov.pl

   PRAWDZIWA STRONA              FAŁSZYWA STRONA
   gov.pl/uslugi                 fake-gov.pl/uslugi
        │                              │
        │ QR: nonce=abc123             │ QR: nonce=abc123
        │     url=gov.pl               │     url=gov.pl (skopiowany!)
        │                              │
        ▼                              ▼
   Użytkownik skanuje            Ofiara skanuje
        │                              │
        ▼                              ▼
   mObywatel wysyła:             mObywatel wysyła:
   {nonce: abc123,               {nonce: abc123,
    url: gov.pl,                  url: fake-gov.pl,    ← RÓŻNICA!
    currentUrl: gov.pl}           currentUrl: fake-gov.pl}
        │                              │
        ▼                              ▼
   Backend sprawdza:             Backend sprawdza:
   boundUrl == currentUrl?       boundUrl == currentUrl?
   gov.pl == gov.pl ✅           gov.pl != fake-gov.pl ❌
        │                              │
        ▼                              ▼
   ✅ SUKCES                      🚨 URL_MISMATCH
                                  "Wykryto spoofing!"


DODATKOWA OCHRONA - APP VERIFIES CURRENT URL:
─────────────────────────────────────────────
Aplikacja mObywatel dodatkowo pobiera aktualny URL ze źródła
(nie z QR) i porównuje. Wymaga to:
1. Deep link z przeglądarki → App
2. Lub manualnego wpisania URL przez użytkownika
3. Lub WebView z rzeczywistym URL
```

---

## 4. WALIDACJA CERTYFIKATU SSL

### 4.1 Parametry Sprawdzane

```
┌─────────────────────────────────────────────────────────────────┐
│              CHECKLIST WALIDACJI SSL                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┬────────────────────┬──────────────┐
│ PARAMETR                    │ METODA SPRAWDZENIA │ WYMAGANIE    │
├─────────────────────────────┼────────────────────┼──────────────┤
│ Ważność czasowa             │ notBefore/notAfter │ Aktualny     │
│ Common Name (CN)            │ x509.subject.CN    │ = domena     │
│ Subject Alt Names (SAN)     │ x509.subjectAltName│ Zawiera domenę│
│ Chain of Trust              │ Weryfikacja CA     │ Zaufane CA   │
│ Revocation Status           │ OCSP / CRL         │ Nie odwołany │
│ Key Usage                   │ x509.keyUsage      │ digitalSign  │
│ Extended Key Usage          │ x509.extKeyUsage   │ serverAuth   │
│ Signature Algorithm         │ x509.sigAlg        │ ≥SHA256      │
│ Key Length                  │ publicKey.bits     │ RSA≥2048     │
│ Protocol Version            │ TLS handshake      │ ≥TLS 1.2     │
│ Cipher Suite                │ TLS negotiation    │ Bez RC4/3DES │
│ HSTS Header                 │ HTTP response      │ Zalecany     │
│ Certificate Transparency    │ SCT extension      │ Zalecany     │
└─────────────────────────────┴────────────────────┴──────────────┘
```

### 4.2 Implementacja Sprawdzania SSL (Koncepcja)

```javascript
// Backend: ssl-validator.js (koncepcja)

async function validateSSLCertificate(url) {
    const result = {
        valid: false,
        issues: [],
        details: {}
    };
    
    try {
        const { hostname } = new URL(url);
        
        // 1. Połącz i pobierz certyfikat
        const cert = await getCertificate(hostname, 443);
        
        // 2. Sprawdź ważność
        if (new Date() > cert.validTo) {
            result.issues.push({
                code: 'CERT_EXPIRED',
                severity: 'CRITICAL',
                message: 'Certyfikat wygasł'
            });
        }
        
        // 3. Sprawdź CN/SAN
        if (!cert.subjectAltNames.includes(hostname)) {
            result.issues.push({
                code: 'CERT_CN_MISMATCH',
                severity: 'CRITICAL',
                message: 'Nazwa w certyfikacie nie pasuje do domeny'
            });
        }
        
        // 4. Sprawdź Chain of Trust
        const chainValid = await verifyChain(cert);
        if (!chainValid) {
            result.issues.push({
                code: 'CERT_UNTRUSTED_ROOT',
                severity: 'CRITICAL',
                message: 'Niezaufany urząd certyfikacji'
            });
        }
        
        // 5. Sprawdź OCSP/CRL
        const revoked = await checkRevocation(cert);
        if (revoked) {
            result.issues.push({
                code: 'CERT_REVOKED',
                severity: 'CRITICAL',
                message: 'Certyfikat został odwołany'
            });
        }
        
        // 6. Sprawdź algorytm
        if (cert.signatureAlgorithm.includes('sha1')) {
            result.issues.push({
                code: 'CERT_WEAK_SIGNATURE',
                severity: 'HIGH',
                message: 'Słaby algorytm podpisu (SHA1)'
            });
        }
        
        // 7. Sprawdź długość klucza
        if (cert.publicKey.bits < 2048) {
            result.issues.push({
                code: 'CERT_WEAK_KEY',
                severity: 'HIGH',
                message: 'Za krótki klucz kryptograficzny'
            });
        }
        
        result.valid = result.issues.filter(i => i.severity === 'CRITICAL').length === 0;
        result.details = extractCertDetails(cert);
        
    } catch (error) {
        result.issues.push({
            code: 'SSL_CONNECTION_FAILED',
            severity: 'CRITICAL',
            message: 'Nie można nawiązać bezpiecznego połączenia'
        });
    }
    
    return result;
}
```

---

# B. SCENARIUSZE TESTOWE - Analiza bad_domains.txt

## Tabela Mapowania Błędów na Komunikaty

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    MAPOWANIE BŁĘDÓW TECHNICZNYCH NA KOMUNIKATY DLA OBYWATELA                               │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### CERTYFIKATY - Błędy Krytyczne

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 1 | `expired.badssl.com` | Certyfikat SSL wygasł (notAfter < now) | `CERT_EXPIRED` | 🔴 **"UWAGA! Zabezpieczenia tej strony wygasły. Nie wprowadzaj żadnych danych osobowych. Zamknij stronę."** |
| 2 | `wrong.host.badssl.com` | CN/SAN nie pasuje do domeny | `CERT_CN_MISMATCH` | 🔴 **"UWAGA! Ta strona podszywa się pod inną stronę. To może być oszustwo!"** |
| 3 | `self-signed.badssl.com` | Certyfikat samopodpisany (brak CA) | `CERT_SELF_SIGNED` | 🔴 **"Ta strona nie ma wiarygodnego certyfikatu. Prawdziwe strony urzędowe mają oficjalne certyfikaty."** |
| 4 | `untrusted-root.badssl.com` | Nieznany/niezaufany Root CA | `CERT_UNTRUSTED_ROOT` | 🔴 **"Nie można potwierdzić tożsamości tej strony. Certyfikat pochodzi z nieznanego źródła."** |
| 5 | `revoked.badssl.com` | Certyfikat odwołany (CRL/OCSP) | `CERT_REVOKED` | 🔴 **"NIEBEZPIECZEŃSTWO! Certyfikat tej strony został unieważniony. Strona może być zagrożona!"** |
| 6 | `no-common-name.badssl.com` | Brak CN w certyfikacie | `CERT_INVALID` | 🔴 **"Certyfikat strony jest uszkodzony lub nieprawidłowy."** |
| 7 | `incomplete-chain.badssl.com` | Niepełny łańcuch certyfikacji | `CERT_CHAIN_INCOMPLETE` | 🟠 **"Nie można w pełni zweryfikować strony. Brakuje części certyfikatu."** |

### HTTP - Brak Szyfrowania

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 8 | `http://http.badssl.com/` | Brak HTTPS (plaintext) | `NO_ENCRYPTION` | 🔴 **"NIEBEZPIECZNE! Ta strona nie jest szyfrowana. Twoje dane mogą być przechwycone!"** |
| 9 | `http://http-password.badssl.com/` | Hasło przesyłane bez szyfrowania | `PASSWORD_OVER_HTTP` | 🔴 **"STOP! Ta strona przesyła hasła bez szyfrowania. NIGDY nie wpisuj tu hasła!"** |
| 10 | `http://http-login.badssl.com/` | Formularz logowania przez HTTP | `LOGIN_OVER_HTTP` | 🔴 **"Ta strona logowania nie jest bezpieczna. Twoje dane mogą zostać skradzione."** |

### SŁABE ALGORYTMY SZYFROWANIA

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 11 | `rc4.badssl.com` | Szyfr RC4 (złamany) | `WEAK_CIPHER_RC4` | 🟠 **"Ta strona używa przestarzałego szyfrowania. Zalecamy ostrożność."** |
| 12 | `3des.badssl.com` | Szyfr 3DES (słaby) | `WEAK_CIPHER_3DES` | 🟠 **"Szyfrowanie tej strony jest przestarzałe. Unikaj wrażliwych operacji."** |
| 13 | `null.badssl.com` | Brak szyfrowania (NULL cipher) | `NULL_CIPHER` | 🔴 **"BŁĄD KRYTYCZNY! Ta strona w ogóle nie szyfruje połączenia!"** |
| 14 | `cbc.badssl.com` | CBC mode (podatny na BEAST) | `WEAK_CIPHER_CBC` | 🟡 **"Szyfrowanie strony może mieć słabe punkty. Zachowaj ostrożność."** |

### PRZESTARZAŁE PROTOKOŁY

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 15 | `tls-v1-0.badssl.com` | TLS 1.0 (deprecated) | `OLD_TLS_VERSION` | 🟠 **"Ta strona używa przestarzałej wersji zabezpieczeń. Nowoczesne strony używają nowszych."** |
| 16 | `tls-v1-1.badssl.com` | TLS 1.1 (deprecated) | `OLD_TLS_VERSION` | 🟠 **"Wersja zabezpieczeń tej strony jest nieaktualna."** |
| 17 | `tls-v1-2.badssl.com` | TLS 1.2 (OK) | `TLS_OK` | 🟢 **"Połączenie zabezpieczone standardowym protokołem."** |

### MIESZANA ZAWARTOŚĆ

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 18 | `mixed-script.badssl.com` | Skrypt ładowany po HTTP | `MIXED_CONTENT_SCRIPT` | 🔴 **"UWAGA! Część tej strony nie jest bezpieczna i może być podmieniona przez oszustów."** |
| 19 | `mixed.badssl.com` | Elementy po HTTP | `MIXED_CONTENT` | 🟠 **"Niektóre elementy strony nie są szyfrowane."** |
| 20 | `mixed-favicon.badssl.com` | Favicon po HTTP | `MIXED_CONTENT_MINOR` | 🟡 **"Drobne elementy strony są nieszyfrowane."** |

### ZNANE ZAGROŻENIA

| # | Link testowy | Problem Techniczny | Reakcja Systemu | Komunikat w mObywatel |
|---|--------------|-------------------|-----------------|----------------------|
| 21 | `superfish.badssl.com` | Znany malware Superfish | `KNOWN_MALWARE_CERT` | 🔴 **"WYKRYTO ZŁOŚLIWE OPROGRAMOWANIE! Ta strona używa certyfikatu powiązanego z wirusem."** |
| 22 | `edellroot.badssl.com` | Znany malware eDellRoot | `KNOWN_MALWARE_CERT` | 🔴 **"ZAGROŻENIE! Certyfikat tej strony jest powiązany ze znanym zagrożeniem."** |
| 23 | `sha1-2017.badssl.com` | SHA1 (słaby hash) | `WEAK_SIGNATURE_SHA1` | 🟠 **"Certyfikat strony używa przestarzałego podpisu. Zachowaj ostrożność."** |

---

## Matryca Severity

```
┌─────────────────────────────────────────────────────────────────┐
│              MATRYCA SEVERITY - REAKCJA SYSTEMU                 │
└─────────────────────────────────────────────────────────────────┘

  SEVERITY    KOLOR      IKONA     AKCJA              DŹWIĘK/HAPTIC
  ─────────────────────────────────────────────────────────────────
  CRITICAL    🔴 Czerwony  ⛔🚨     Blokada + Alert    Wibracja 3x
  HIGH        🟠 Pomarańcz ⚠️       Ostrzeżenie        Wibracja 1x
  MEDIUM      🟡 Żółty     ⚡       Informacja         Brak
  LOW         🟢 Zielony   ✅       Sukces             Brak
  ─────────────────────────────────────────────────────────────────

  MAPOWANIE KODÓW NA SEVERITY:
  
  CRITICAL (Blokuj natychmiast):
  ├── CERT_EXPIRED
  ├── CERT_CN_MISMATCH
  ├── CERT_SELF_SIGNED
  ├── CERT_UNTRUSTED_ROOT
  ├── CERT_REVOKED
  ├── NO_ENCRYPTION
  ├── NULL_CIPHER
  ├── MIXED_CONTENT_SCRIPT
  ├── KNOWN_MALWARE_CERT
  └── URL_MISMATCH (spoofing)
  
  HIGH (Silne ostrzeżenie):
  ├── WEAK_CIPHER_RC4
  ├── WEAK_CIPHER_3DES
  ├── WEAK_SIGNATURE_SHA1
  └── CERT_CHAIN_INCOMPLETE
  
  MEDIUM (Informacja):
  ├── OLD_TLS_VERSION
  ├── WEAK_CIPHER_CBC
  └── MIXED_CONTENT_MINOR
```

---

# C. UX/UI - MAKIETY LO-FI (Opis Słowny)

## 1. SCENARIUSZ POZYTYWNY - Sukces Weryfikacji

### Widok na Stronie Internetowej (Widget)

```
┌─────────────────────────────────────────────────────────────────┐
│                      STRONA GOV.PL                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │              [ Zawartość strony urzędu ]                │   │
│  │                                                         │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              ┌─────────────────────────────┐   │
│                              │  🛡️ PRAWDA W SIECI         │   │
│                              │  ─────────────────────────  │   │
│                              │   ┌─────────────────────┐   │   │
│                              │   │                     │   │   │
│                              │   │    [  QR CODE  ]    │   │   │
│                              │   │                     │   │   │
│                              │   └─────────────────────┘   │   │
│                              │                             │   │
│                              │   🟢 Aktywny • 4:32        │   │
│                              │   Zeskanuj w mObywatel     │   │
│                              │                             │   │
│                              │   ▼ Rozwiń szczegóły       │   │
│                              └─────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

ELEMENTY:
• Widget w prawym dolnym rogu (floating)
• Subtelny, nie przeszkadza w korzystaniu ze strony
• Zielona kropka = token aktywny
• Countdown do wygaśnięcia (auto-refresh)
• Możliwość rozwinięcia szczegółów (certyfikat, domena)
```

### Widok w Aplikacji mObywatel - Skanowanie

```
┌───────────────────────────────────────┐
│  ◀ Wstecz      mObywatel      ☰     │
├───────────────────────────────────────┤
│                                       │
│         🛡️ PRAWDA W SIECI            │
│         ─────────────────────        │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │                                 │ │
│  │                                 │ │
│  │        [ PODGLĄD KAMERY ]       │ │
│  │                                 │ │
│  │    ┌─────────────────────┐      │ │
│  │    │                     │      │ │
│  │    │   [ Ramka skanera ] │      │ │
│  │    │                     │      │ │
│  │    └─────────────────────┘      │ │
│  │                                 │ │
│  │ ━━━━━━━━━━━━ (linia skanująca)  │ │
│  │                                 │ │
│  └─────────────────────────────────┘ │
│                                       │
│    📷 Skieruj kamerę na kod QR       │
│    znajdujący się na stronie urzędu  │
│                                       │
│    💡 Historia weryfikacji (3)       │
│                                       │
└───────────────────────────────────────┘
```

### Widok w Aplikacji - Sukces ✅

```
┌───────────────────────────────────────┐
│  ◀ Wstecz      mObywatel      ☰     │
├───────────────────────────────────────┤
│                                       │
│                                       │
│         ╔═══════════════════╗        │
│         ║                   ║        │
│         ║     🛡️ ✅         ║        │
│         ║                   ║        │
│         ║  STRONA ZAUFANA   ║        │
│         ║                   ║        │
│         ╚═══════════════════╝        │
│                                       │
│    ┌─────────────────────────────┐   │
│    │  🏛️  gov.pl                │   │
│    │  Portal Rzeczypospolitej    │   │
│    │  Polskiej                   │   │
│    │                             │   │
│    │  ────────────────────────   │   │
│    │                             │   │
│    │  📜 Certyfikat: Ważny       │   │
│    │  🔒 Szyfrowanie: TLS 1.3    │   │
│    │  🏢 Wydawca: NASK           │   │
│    │  📅 Ważny do: 15.06.2026    │   │
│    │                             │   │
│    │  ✓ Domena na oficjalnej     │   │
│    │    liście rządowej          │   │
│    └─────────────────────────────┘   │
│                                       │
│    Zweryfikowano: 07.12.2025 14:32   │
│                                       │
│    ┌─────────────────────────────┐   │
│    │        [ ZAMKNIJ ]          │   │
│    └─────────────────────────────┘   │
│                                       │
└───────────────────────────────────────┘

FEEDBACK:
• Delikatna wibracja sukcesu (haptic)
• Zielone tło gradientowe
• Animacja tarczy z checkmarkiem
• Szczegóły certyfikatu do rozwinięcia
```

---

## 2. SCENARIUSZ NEGATYWNY - Atak/Błąd

### Widok w Aplikacji - Strona Niebezpieczna 🔴

```
┌───────────────────────────────────────┐
│  ◀ Wstecz      mObywatel      ☰     │
├───────────────────────────────────────┤
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓                                 ▓▓│
│▓▓         ⛔ UWAGA! ⛔            ▓▓│
│▓▓                                 ▓▓│
│▓▓      ╔═══════════════════╗      ▓▓│
│▓▓      ║                   ║      ▓▓│
│▓▓      ║     🚨 ❌         ║      ▓▓│
│▓▓      ║                   ║      ▓▓│
│▓▓      ║   NIEBEZPIECZNA   ║      ▓▓│
│▓▓      ║      STRONA       ║      ▓▓│
│▓▓      ║                   ║      ▓▓│
│▓▓      ╚═══════════════════╝      ▓▓│
│▓▓                                 ▓▓│
│▓▓  ┌─────────────────────────┐    ▓▓│
│▓▓  │  ⚠️ fake-gov.pl         │    ▓▓│
│▓▓  │                         │    ▓▓│
│▓▓  │  Ta strona NIE jest     │    ▓▓│
│▓▓  │  oficjalną stroną       │    ▓▓│
│▓▓  │  rządową!               │    ▓▓│
│▓▓  │                         │    ▓▓│
│▓▓  │  🔴 Certyfikat wygasł   │    ▓▓│
│▓▓  │  🔴 Domena niezaufana   │    ▓▓│
│▓▓  │                         │    ▓▓│
│▓▓  │  NIE WPROWADZAJ         │    ▓▓│
│▓▓  │  ŻADNYCH DANYCH!        │    ▓▓│
│▓▓  └─────────────────────────┘    ▓▓│
│▓▓                                 ▓▓│
│▓▓  ┌─────────────────────────┐    ▓▓│
│▓▓  │   [ ZGŁOŚ STRONĘ ]      │    ▓▓│
│▓▓  └─────────────────────────┘    ▓▓│
│▓▓                                 ▓▓│
│▓▓  ┌─────────────────────────┐    ▓▓│
│▓▓  │   [ ZAMKNIJ ]           │    ▓▓│
│▓▓  └─────────────────────────┘    ▓▓│
│▓▓                                 ▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└───────────────────────────────────────┘

FEEDBACK:
• Intensywna wibracja ostrzegawcza (3x)
• Pulsujące czerwone tło
• Duża ikona ostrzeżenia
• Blokada - wymaga świadomego zamknięcia
• Opcja "Zgłoś stronę" do CERT
```

### Widok - Wykryto Spoofing QR 🚨

```
┌───────────────────────────────────────┐
│  ◀ Wstecz      mObywatel      ☰     │
├───────────────────────────────────────┤
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░                                 ░░│
│░░      🚨 ALERT BEZPIECZEŃSTWA 🚨 ░░│
│░░                                 ░░│
│░░      ╔═══════════════════╗      ░░│
│░░      ║   ⚠️ SPOOFING!   ║      ░░│
│░░      ╚═══════════════════╝      ░░│
│░░                                 ░░│
│░░  Wykryto próbę oszustwa!        ░░│
│░░                                 ░░│
│░░  Kod QR pochodził z:            ░░│
│░░  ✓ gov.pl                       ░░│
│░░                                 ░░│
│░░  Ale jesteś na stronie:         ░░│
│░░  ✗ phishing-site.com            ░░│
│░░                                 ░░│
│░░  ─────────────────────────────  ░░│
│░░                                 ░░│
│░░  Oszust skopiował kod QR        ░░│
│░░  z prawdziwej strony na         ░░│
│░░  fałszywą stronę!               ░░│
│░░                                 ░░│
│░░  🛡️ System ochronił Cię przed  ░░│
│░░     potencjalnym atakiem.       ░░│
│░░                                 ░░│
│░░  ┌─────────────────────────┐    ░░│
│░░  │ [ ZGŁOŚ DO CERT POLSKA ]│    ░░│
│░░  └─────────────────────────┘    ░░│
│░░                                 ░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└───────────────────────────────────────┘
```

### Widok - Błąd Sieci / Timeout

```
┌───────────────────────────────────────┐
│  ◀ Wstecz      mObywatel      ☰     │
├───────────────────────────────────────┤
│                                       │
│                                       │
│         ╔═══════════════════╗        │
│         ║                   ║        │
│         ║      📶 ❌        ║        │
│         ║                   ║        │
│         ║  BRAK POŁĄCZENIA  ║        │
│         ║                   ║        │
│         ╚═══════════════════╝        │
│                                       │
│    ┌─────────────────────────────┐   │
│    │                             │   │
│    │  Nie udało się połączyć     │   │
│    │  z serwerem weryfikacji.    │   │
│    │                             │   │
│    │  Sprawdź:                   │   │
│    │  • Połączenie internetowe   │   │
│    │  • Tryb samolotowy          │   │
│    │  • Siłę sygnału             │   │
│    │                             │   │
│    └─────────────────────────────┘   │
│                                       │
│    ┌─────────────────────────────┐   │
│    │     [ SPRÓBUJ PONOWNIE ]    │   │
│    └─────────────────────────────┘   │
│                                       │
│    ┌─────────────────────────────┐   │
│    │     [ ANULUJ ]              │   │
│    └─────────────────────────────┘   │
│                                       │
└───────────────────────────────────────┘
```

---

# D. BEZPIECZEŃSTWO - Szczegółowa Analiza

## 1. Parametry Certyfikatu - Pełna Lista Sprawdzeń

```
┌─────────────────────────────────────────────────────────────────┐
│          KOMPLETNA WALIDACJA CERTYFIKATU SSL/TLS               │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────┐
│ KATEGORIA          │ PARAMETR                │ SPRAWDZENIE           │ WYNIK  │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ WAŻNOŚĆ            │ notBefore               │ ≤ current time        │ ✓/✗    │
│                    │ notAfter                │ ≥ current time        │ ✓/✗    │
│                    │ Time to expiry          │ > 7 dni (warning)     │ ⚠️/✓   │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ TOŻSAMOŚĆ          │ Common Name (CN)        │ = requested hostname  │ ✓/✗    │
│                    │ Subject Alt Names       │ includes hostname     │ ✓/✗    │
│                    │ Wildcard validation     │ *.gov.pl → x.gov.pl   │ ✓/✗    │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ CHAIN OF TRUST     │ Issuer Certificate      │ Valid & trusted       │ ✓/✗    │
│                    │ Root CA                 │ In trusted store      │ ✓/✗    │
│                    │ Intermediate CAs        │ Complete chain        │ ✓/✗    │
│                    │ Path length             │ ≤ defined constraint  │ ✓/✗    │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ REVOCATION         │ OCSP Response           │ "good" status         │ ✓/✗    │
│                    │ OCSP Stapling           │ Valid if present      │ ✓/✗    │
│                    │ CRL Check               │ Not on revocation list│ ✓/✗    │
│                    │ OCSP Must-Staple        │ Enforced if flagged   │ ✓/✗    │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ KRYPTOGRAFIA       │ Signature Algorithm     │ ≥ SHA256withRSA       │ ✓/✗    │
│                    │ Public Key Size         │ RSA ≥ 2048 bit        │ ✓/✗    │
│                    │                         │ ECDSA ≥ 256 bit       │ ✓/✗    │
│                    │ Key Usage               │ digitalSignature      │ ✓/✗    │
│                    │ Extended Key Usage      │ serverAuth            │ ✓/✗    │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ PROTOKÓŁ TLS       │ Protocol Version        │ ≥ TLS 1.2             │ ✓/✗    │
│                    │ Cipher Suite            │ No RC4, 3DES, NULL    │ ✓/✗    │
│                    │ Forward Secrecy         │ ECDHE or DHE          │ ✓/⚠️   │
│                    │ Compression             │ Disabled              │ ✓/✗    │
├────────────────────┼─────────────────────────┼───────────────────────┼────────┤
│ DODATKOWE          │ Certificate Transparency│ SCT present           │ ✓/⚠️   │
│                    │ HSTS Header             │ Present               │ ✓/⚠️   │
│                    │ HSTS Preload            │ On preload list       │ ✓/⚠️   │
│                    │ CAA Record              │ Matches issuer        │ ✓/⚠️   │
└────────────────────┴─────────────────────────┴───────────────────────┴────────┘
```

## 2. Wektory Ataku - Odporność Systemu

```
┌─────────────────────────────────────────────────────────────────┐
│              ANALIZA WEKTORÓW ATAKU I OBRONA                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ WEKTOR ATAKU              │ OPIS                           │ OBRONA W SYSTEMIE              │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ QR Code Spoofing          │ Oszust kopiuje QR z prawdziwej │ URL binding w tokenie +        │
│                           │ strony na fałszywą             │ weryfikacja currentUrl         │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Replay Attack             │ Przechwycenie i ponowne        │ Nonce jednorazowy + timestamp  │
│                           │ użycie tokena                  │ + natychmiastowe unieważnienie │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Token Expiry Bypass       │ Próba użycia wygasłego tokena  │ TTL 5 min + server-side check  │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Man-in-the-Middle         │ Przechwycenie komunikacji      │ TLS 1.3 + Certificate Pinning  │
│                           │ między komponentami            │ + HMAC signatures              │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Domain Squatting          │ Rejestracja podobnej domeny    │ Biała lista 1400+ domen +      │
│                           │ (g0v.pl zamiast gov.pl)        │ exact match validation         │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ SSL Stripping             │ Downgrade HTTPS → HTTP         │ HSTS enforcement + protocol    │
│                           │                                │ validation w aplikacji         │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Phishing z fałszywym cert │ Strona z certyfikatem Let's    │ Walidacja pełnego chain +      │
│                           │ Encrypt na podobnej domenie    │ whitelist domen                │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Widget Injection          │ Wstrzyknięcie fałszywego       │ CSP headers + widget integrity │
│                           │ widgetu na stronie             │ check + signed responses       │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ API Abuse / DDoS          │ Flooding API requestami        │ Multi-tier rate limiting +     │
│                           │                                │ request ID tracking            │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Parameter Tampering       │ Modyfikacja parametrów URL     │ URL canonicalization +         │
│                           │ w tokenie                      │ HMAC signature verification    │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Timing Attacks            │ Analiza czasu odpowiedzi       │ crypto.timingSafeEqual() +     │
│                           │ dla enumeracji                 │ constant-time comparisons      │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Certificate Impersonation │ Użycie ważnego cert dla        │ SAN/CN validation +            │
│                           │ niewłaściwej domeny            │ hostname verification          │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Revoked Certificate Usage │ Strona ze starym, odwołanym    │ OCSP/CRL checking w real-time  │
│                           │ certyfikatem                   │                                │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Mixed Content Injection   │ Wstrzyknięcie HTTP content     │ Mixed content detection +      │
│                           │ na HTTPS stronie               │ warning w aplikacji            │
├───────────────────────────┼────────────────────────────────┼────────────────────────────────┤
│ Malware Certificate       │ Użycie certyfikatu ze znanego  │ Blacklist known bad certs      │
│                           │ malware (Superfish, eDellRoot) │ (fingerprint matching)         │
└───────────────────────────┴────────────────────────────────┴────────────────────────────────┘
```

## 3. Dodatkowe Mechanizmy Bezpieczeństwa

```
┌─────────────────────────────────────────────────────────────────┐
│              DEFENSE IN DEPTH - WARSTWY OCHRONY                 │
└─────────────────────────────────────────────────────────────────┘

WARSTWA 1: TRANSPORT
├── TLS 1.3 (minimum TLS 1.2)
├── Strong cipher suites only
├── Certificate pinning (mobile app)
└── HSTS with preload

WARSTWA 2: APLIKACJA
├── Input validation & sanitization
├── Output encoding
├── Rate limiting (multi-tier)
├── Request ID tracking
└── Audit logging

WARSTWA 3: TOKEN/NONCE
├── Cryptographic randomness (crypto.randomBytes)
├── Short TTL (5 minutes)
├── One-time use enforcement
├── URL binding
└── HMAC signatures

WARSTWA 4: WERYFIKACJA
├── Domain whitelist (1400+ gov.pl)
├── SSL certificate validation
├── OCSP/CRL revocation check
├── Chain of Trust verification
└── Known-bad certificate blacklist

WARSTWA 5: UX/FEEDBACK
├── Clear visual indicators
├── Haptic feedback for warnings
├── Non-dismissable critical alerts
├── Incident reporting capability
└── Educational messages
```

---

# PODSUMOWANIE

## Kluczowe Cechy Systemu

| Cecha | Implementacja |
|-------|---------------|
| **Bezpieczeństwo** | Multi-layer defense, cryptographic nonce, HMAC signing |
| **Wydajność** | Lightweight widget (<50KB), 5-min token caching, hot-reload domains |
| **UX** | Intuicyjne komunikaty, haptic feedback, wizualne wskaźniki |
| **Skalowalność** | Stateless verification, in-memory token store, rate limiting |
| **Audytowalność** | Request IDs, audit logs, incident reporting |

## Rekomendacje do Wdrożenia Produkcyjnego

1. **Integracja z mObywatel** - Native module zamiast standalone app
2. **HSM dla kluczy** - Hardware Security Module dla HMAC keys
3. **Distributed backend** - Multi-region deployment
4. **Real-time OCSP** - Dedykowany OCSP responder cache
5. **Threat Intelligence** - Integracja z CERT Polska feeds
6. **A/B Testing UX** - Optymalizacja komunikatów dla różnych grup wiekowych

---

**Dokument przygotowany dla hackathonu "Prawda w Sieci"**
**Data: 07.12.2025**
