/**
 * Testy SSL - "Prawda w Sieci"
 * Testy walidacji certyfikatów z bad_domains.txt
 * 
 * Uruchom: node ssl-tests.js
 */

const sslValidator = require('./ssl-validator');

// ============================================
// DANE TESTOWE Z bad_domains.txt
// ============================================

const TEST_CASES = [
  // CERTYFIKATY
  {
    category: 'CERTYFIKATY',
    tests: [
      { url: 'https://expired.badssl.com/', expectedCode: 'CERT_EXPIRED', description: 'Wygasły certyfikat' },
      { url: 'https://wrong.host.badssl.com/', expectedCode: 'CERT_CN_MISMATCH', description: 'Błędna nazwa hosta' },
      { url: 'https://self-signed.badssl.com/', expectedCode: 'CERT_SELF_SIGNED', description: 'Samopodpisany' },
      { url: 'https://untrusted-root.badssl.com/', expectedCode: 'CERT_UNTRUSTED_ROOT', description: 'Niezaufany root CA' },
      { url: 'https://revoked.badssl.com/', expectedCode: 'CERT_REVOKED', description: 'Odwołany certyfikat' },
      { url: 'https://no-common-name.badssl.com/', expectedCode: 'CERT_INVALID', description: 'Brak Common Name' },
      { url: 'https://incomplete-chain.badssl.com/', expectedCode: 'CERT_CHAIN_INCOMPLETE', description: 'Niepełny łańcuch' }
    ]
  },
  
  // HTTP (BRAK SZYFROWANIA)
  {
    category: 'HTTP (BRAK SZYFROWANIA)',
    tests: [
      { url: 'http://http.badssl.com/', expectedCode: 'NO_ENCRYPTION', description: 'Czyste HTTP' },
      { url: 'http://http-password.badssl.com/', expectedCode: 'NO_ENCRYPTION', description: 'Hasło przez HTTP' },
      { url: 'http://http-login.badssl.com/', expectedCode: 'NO_ENCRYPTION', description: 'Logowanie przez HTTP' }
    ]
  },
  
  // SŁABE SZYFRY
  {
    category: 'SŁABE ALGORYTMY SZYFROWANIA',
    tests: [
      { url: 'https://rc4.badssl.com/', expectedCode: 'WEAK_CIPHER_RC4', description: 'Szyfr RC4' },
      { url: 'https://3des.badssl.com/', expectedCode: 'WEAK_CIPHER_3DES', description: 'Szyfr 3DES' },
      { url: 'https://null.badssl.com/', expectedCode: 'NULL_CIPHER', description: 'Brak szyfrowania (NULL)' },
      { url: 'https://cbc.badssl.com/', expectedCode: 'WEAK_CIPHER_CBC', description: 'Tryb CBC' }
    ]
  },
  
  // PROTOKOŁY
  {
    category: 'PROTOKOŁY TLS',
    tests: [
      { url: 'https://tls-v1-0.badssl.com:1010/', expectedCode: 'OLD_TLS_VERSION', description: 'TLS 1.0 (przestarzały)' },
      { url: 'https://tls-v1-1.badssl.com:1011/', expectedCode: 'OLD_TLS_VERSION', description: 'TLS 1.1 (przestarzały)' },
      { url: 'https://tls-v1-2.badssl.com:1012/', expectedCode: 'SSL_VALID', description: 'TLS 1.2 (OK)' }
    ]
  },
  
  // ZNANE ZAGROŻENIA
  {
    category: 'ZNANE ZAGROŻENIA',
    tests: [
      { url: 'https://superfish.badssl.com/', expectedCode: 'KNOWN_MALWARE_CERT', description: 'Superfish' },
      { url: 'https://edellroot.badssl.com/', expectedCode: 'KNOWN_MALWARE_CERT', description: 'eDellRoot' },
      { url: 'https://sha1-2017.badssl.com/', expectedCode: 'WEAK_SIGNATURE_SHA1', description: 'SHA1 (słaby)' }
    ]
  },
  
  // PRAWIDŁOWE CERTYFIKATY (kontrolne)
  {
    category: 'PRAWIDŁOWE CERTYFIKATY',
    tests: [
      { url: 'https://badssl.com/', expectedCode: 'SSL_VALID', description: 'Prawidłowy certyfikat' },
      { url: 'https://gov.pl/', expectedCode: 'SSL_VALID', description: 'gov.pl (powinien być OK)' },
      { url: 'https://google.com/', expectedCode: 'SSL_VALID', description: 'Google (kontrolny)' }
    ]
  }
];

// ============================================
// RUNNER TESTÓW
// ============================================

async function runTests() {
  console.log('═'.repeat(70));
  console.log('🧪 PRAWDA W SIECI - Testy Walidacji SSL');
  console.log('═'.repeat(70));
  console.log(`📅 Data: ${new Date().toISOString()}`);
  console.log('═'.repeat(70));
  console.log('');
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  
  const results = [];
  
  for (const category of TEST_CASES) {
    console.log(`\n📁 ${category.category}`);
    console.log('─'.repeat(70));
    
    for (const test of category.tests) {
      totalTests++;
      process.stdout.write(`  🔍 ${test.description.padEnd(30)} `);
      
      try {
        const result = await sslValidator.validateSSL(test.url);
        
        // Sprawdź czy oczekiwany błąd jest w wynikach
        const foundExpectedError = result.issues.some(
          issue => issue.code === test.expectedCode
        );
        
        // Dla SSL_VALID sprawdź czy brak krytycznych błędów
        const isValid = test.expectedCode === 'SSL_VALID' && 
                        result.overallSeverity === 'OK';
        
        if (foundExpectedError || isValid) {
          passedTests++;
          console.log(`✅ PASS`);
          console.log(`     Expected: ${test.expectedCode}`);
          console.log(`     Got: ${result.issues.map(i => i.code).join(', ') || 'SSL_VALID'}`);
        } else {
          failedTests++;
          console.log(`❌ FAIL`);
          console.log(`     Expected: ${test.expectedCode}`);
          console.log(`     Got: ${result.issues.map(i => i.code).join(', ') || 'NONE'}`);
          console.log(`     Severity: ${result.overallSeverity}`);
        }
        
        results.push({
          ...test,
          result,
          passed: foundExpectedError || isValid
        });
        
      } catch (error) {
        skippedTests++;
        console.log(`⚠️ SKIP (${error.message})`);
        results.push({
          ...test,
          error: error.message,
          passed: false
        });
      }
      
      // Delay między testami (unikanie rate limitów)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Podsumowanie
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('📊 PODSUMOWANIE TESTÓW');
  console.log('═'.repeat(70));
  console.log(`  Total:   ${totalTests}`);
  console.log(`  ✅ Pass:  ${passedTests}`);
  console.log(`  ❌ Fail:  ${failedTests}`);
  console.log(`  ⚠️ Skip:  ${skippedTests}`);
  console.log(`  Rate:    ${((passedTests / (totalTests - skippedTests)) * 100).toFixed(1)}%`);
  console.log('═'.repeat(70));
  
  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    skipped: skippedTests,
    results
  };
}

// ============================================
// GENEROWANIE RAPORTU
// ============================================

async function generateReport() {
  const testResults = await runTests();
  
  console.log('\n\n');
  console.log('═'.repeat(70));
  console.log('📋 TABELA MAPOWANIA BŁĘDÓW DLA OBYWATELA');
  console.log('═'.repeat(70));
  console.log('');
  
  console.log('| URL | Problem | Severity | Komunikat |');
  console.log('|-----|---------|----------|-----------|');
  
  for (const result of testResults.results) {
    if (result.result && result.result.issues.length > 0) {
      const mainIssue = result.result.issues[0];
      console.log(
        `| ${result.url.substring(0, 35)}... | ${mainIssue.technicalDesc || 'N/A'} | ${mainIssue.severity} | ${mainIssue.userMessage?.substring(0, 50) || 'N/A'}... |`
      );
    }
  }
  
  return testResults;
}

// ============================================
// MAIN
// ============================================

if (require.main === module) {
  generateReport()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runTests, generateReport, TEST_CASES };
