# 🛡️ Prawda w Sieci

System weryfikacji autentyczności stron rządowych za pomocą aplikacji mobilnej (symulacja mObywatel).

## 📋 Opis projektu

**Prawda w Sieci** to innowacyjny system pozwalający obywatelom zweryfikować, czy strona internetowa, na której się znajdują, jest prawdziwą stroną rządową (np. gov.pl). Rozwiązanie składa się z trzech komponentów:

1. **📱 Aplikacja mobilna** (React Native/Expo) - symulacja mObywatel ze skanerem QR
2. **🖥️ Web Widget** (React.js) - lekki komponent wyświetlający kod QR na stronie
3. **⚙️ Backend API** (Node.js/Express) - serwer walidujący tokeny i białą listę domen

## 🔄 Flow weryfikacji

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Strona WWW    │      │     Backend     │      │   Aplikacja     │
│   (z widgetem)  │      │      API        │      │   mObywatel     │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │  1. Generuj token      │                        │
         │ ───────────────────>   │                        │
         │                        │                        │
         │  2. Token + QR code    │                        │
         │ <───────────────────   │                        │
         │                        │                        │
         │       3. Skanuj QR     │                        │
         │ ──────────────────────────────────────────────> │
         │                        │                        │
         │                        │   4. Weryfikuj token   │
         │                        │ <───────────────────── │
         │                        │                        │
         │                        │   5. Wynik weryfikacji │
         │                        │ ─────────────────────> │
         │                        │                        │
         │                        │   6. Pokaż wynik       │
         │                        │        ✅ / ⚠️ / ❌     │
         │                        │                        │
```

## 🚀 Szybki start

### 1. Backend

```bash
cd backend
npm install
npm run dev  # lub npm start
```

Serwer uruchomi się na `http://localhost:3001`

### 2. Web Widget (przykładowa strona)

```bash
cd web-widget
npm install
npm start
```

Strona otworzy się na `http://localhost:3000`

### 3. Aplikacja mobilna

```bash
# W głównym katalogu projektu
npm install
npx expo install expo-camera expo-linear-gradient
npx expo start
```

Zeskanuj kod QR aplikacją Expo Go lub uruchom na emulatorze.

> **⚠️ WAŻNE:** Przed uruchomieniem aplikacji mobilnej, zmień adres IP backendu w pliku `app/(tabs)/index.tsx`:
> ```typescript
> const CONFIG = {
>   BACKEND_URL: 'http://TWOJE_IP:3001',
>   ...
> };
> ```

## 📁 Struktura projektu

```
prawda-w-sieci/
├── allowed_domain_list.csv       # Oficjalna lista 1400+ domen gov.pl
├── app/                          # Aplikacja Expo (React Native)
│   ├── (tabs)/
│   │   ├── index.tsx            # Główny ekran ze skanerem QR
│   │   └── explore.tsx          # Zakładka "Explore"
│   └── _layout.tsx              # Layout nawigacji
│
├── backend/                      # Backend API (Node.js)
│   ├── server.js                # Główny serwer Express
│   └── package.json
│
├── web-widget/                   # Widget dla stron WWW
│   ├── GovVerificationWidget.jsx  # Komponent React
│   ├── index.html               # Przykładowa strona gov.pl
│   ├── vite.config.js
│   └── package.json
│
├── package.json                  # Zależności aplikacji mobilnej
└── README.md
```

## 🔐 Bezpieczeństwo

### Implementowane mechanizmy:

| Mechanizm | Opis |
|-----------|------|
| **Nonce jednorazowy** | Każdy QR zawiera unikalny token (64-char hex), ważny 5 min, używalny tylko raz |
| **Biała lista domen** | Weryfikacja z oficjalną listą **1400+ domen** gov.pl (hot-reload z CSV) |
| **Rate limiting** | Wielopoziomowa ochrona: 30 req/min (strict), 200 req/15min (relaxed) |
| **HMAC-SHA256** | Każda odpowiedź serwera jest podpisana kryptograficznie |
| **Anti-spoofing** | Weryfikacja zgodności URL z tokenem - wykrywanie manipulacji |
| **Sanityzacja URL** | Ochrona przed URL injection, path traversal, SSRF |
| **Helmet.js** | CSP, HSTS, X-Frame-Options, no-sniff i inne nagłówki bezpieczeństwa |
| **Request ID** | Każde żądanie ma unikalny ID dla audytu i debugowania |
| **Timing-safe compare** | Ochrona przed timing attacks przy weryfikacji podpisów |

### Obsługa przypadków błędnych:

| Scenariusz | Kod błędu | Komunikat dla użytkownika |
|------------|-----------|---------------------------|
| Brak połączenia | `NETWORK_ERROR` | "Sprawdź połączenie internetowe" |
| Nieprawidłowy QR | `INVALID_NONCE` | "Nieprawidłowy kod QR" |
| QR wygasł | `TOKEN_EXPIRED` | "Token wygasł - odśwież stronę" |
| QR już zeskanowany | `TOKEN_ALREADY_USED` | "Token już został wykorzystany" |
| Próba spoofingu | `URL_MISMATCH` | "🚨 Wykryto próbę spoofingu!" |
| Niezaufana strona | `UNTRUSTED_DOMAIN` | "⚠️ Strona NIE jest zaufana" |
| Przeciążenie | `SERVER_OVERLOAD` | "Serwer przeciążony" |
| Za dużo żądań | `RATE_LIMIT_EXCEEDED` | "Odczekaj chwilę" |

### Zabezpieczenia przed atakami:

- ✅ **Replay attacks** - token jednorazowy + timestamp validation
- ✅ **QR spoofing** - weryfikacja URL w tokenie vs URL wysłany
- ✅ **DDoS** - rate limiting + limit rozmiaru payload (10KB)
- ✅ **Injection** - sanityzacja wszystkich parametrów wejściowych
- ✅ **MITM** - HTTPS required (w produkcji), HMAC signatures

## 📡 API Endpoints

### POST `/api/token/generate`
Generuje nowy token weryfikacyjny.

**Request:**
```json
{
  "url": "https://gov.pl/uslugi",
  "metadata": { "userAgent": "..." }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nonce": "a1b2c3d4e5f6...",
    "expiresAt": 1702000000000,
    "expiresIn": 300
  },
  "timestamp": 1701999700000,
  "signature": "hmac-sha256-signature"
}
```

### POST `/api/verify`
Weryfikuje token i stronę.

**Request:**
```json
{
  "nonce": "a1b2c3d4e5f6...",
  "url": "https://gov.pl/uslugi",
  "appVersion": "1.0.0"
}
```

**Response (sukces - strona zaufana):**
```json
{
  "success": true,
  "verified": true,
  "trusted": true,
  "message": "✅ Strona jest zaufana",
  "details": {
    "domain": "gov.pl",
    "verifiedAt": "2025-12-07T12:00:00Z",
    "certificateInfo": {
      "issuer": "Centrum Certyfikacji GOV.PL",
      "status": "VALID"
    }
  },
  "code": "VERIFICATION_SUCCESS"
}
```

**Response (strona niezaufana):**
```json
{
  "success": true,
  "verified": true,
  "trusted": false,
  "message": "⚠️ Ta strona NIE jest zaufana!",
  "warning": "Możliwa próba phishingu.",
  "code": "UNTRUSTED_DOMAIN"
}
```

### GET `/api/domains/count`
Liczba zaufanych domen.

### GET `/api/domains/check/:domain`
Sprawdza czy domena jest zaufana.

### GET `/api/health`
Health check serwera.

## 🎨 Scenariusze użycia

### ✅ Scenariusz pozytywny (strona zaufana)
1. Użytkownik wchodzi na stronę `gov.pl`
2. W rogu strony widzi widget "Prawda w Sieci" z kodem QR
3. Otwiera aplikację mObywatel i skanuje kod
4. Aplikacja wyświetla **zielony komunikat**: "Strona jest zaufana"

### ⚠️ Scenariusz negatywny (phishing)
1. Użytkownik wchodzi na fałszywą stronę `g0v-pl.fake.com`
2. Strona może próbować wyświetlić widget (ale z własnym URL)
3. Po zeskanowaniu QR, backend sprawdza białą listę
4. Aplikacja wyświetla **czerwone ostrzeżenie**: "UWAGA: Ta strona NIE jest zaufana!"

### 🚨 Scenariusz spoofingu (próba manipulacji)
1. Atakujący próbuje podmienić URL w kodzie QR
2. Backend wykrywa niezgodność między tokenem a przesłanym URL
3. Aplikacja wyświetla: "Wykryto próbę spoofingu!"

## 🛠️ Technologie

- **Frontend Mobile:** React Native, Expo, TypeScript, expo-camera
- **Frontend Web:** React.js, Vite, qrcode
- **Backend:** Node.js, Express.js
- **Bezpieczeństwo:** helmet, express-rate-limit, crypto (HMAC-SHA256)
- **Dane:** CSV (biała lista), In-memory Map (tokeny)

## 📊 Propozycja integracji z mObywatel

```
┌────────────────────────────────────────────────────────────┐
│                    mObywatel App                           │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Dokumenty   │  │   Usługi     │  │ PRAWDA W     │    │
│  │              │  │              │  │ SIECI 🛡️     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                             │             │
│                                             ▼             │
│                    ┌────────────────────────────────┐     │
│                    │     Skaner QR Weryfikacji     │     │
│                    │   ┌────────────────────────┐  │     │
│                    │   │                        │  │     │
│                    │   │     [ Skaner QR ]     │  │     │
│                    │   │                        │  │     │
│                    │   └────────────────────────┘  │     │
│                    └────────────────────────────────┘     │
│                                             │             │
│                                             ▼             │
│                    ┌────────────────────────────────┐     │
│                    │   Wynik: ✅ Strona zaufana    │     │
│                    │   gov.pl - Zweryfikowano      │     │
│                    └────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
```

## 👨‍💻 Autorzy

Hackathon Team - "Prawda w Sieci"

## 📄 Licencja

MIT
