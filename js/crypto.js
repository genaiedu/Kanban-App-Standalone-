// js/crypto.js — Kryptographiemodul (AES-GCM + RSA-OAEP + PBKDF2)
// Web Crypto API — läuft vollständig lokal, kein Server nötig

function _toB64(arr) {
  let s = '';
  const b = new Uint8Array(arr);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function _fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function _deriveKey(password, salt) {
  const mat = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

window.kfCrypto = {

  // ── SYMMETRISCH: String mit Passwort ver-/entschlüsseln ──
  async encryptStr(str, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await _deriveKey(password, salt);
    const enc  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(str)
    );
    return { salt: _toB64(salt), iv: _toB64(iv), data: _toB64(new Uint8Array(enc)) };
  },

  async decryptStr(obj, password) {
    const key = await _deriveKey(password, _fromB64(obj.salt));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _fromB64(obj.iv) }, key, _fromB64(obj.data)
    );
    return new TextDecoder().decode(dec);
  },

  // ── ZUFÄLLIGER AES-DATENSCHLÜSSEL ────────────────────────
  async genDataKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },
  async exportKey(k)   { return _toB64(await crypto.subtle.exportKey('raw', k)); },
  async importKey(b64) {
    return crypto.subtle.importKey('raw', _fromB64(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },
  async encryptWithKey(str, key) {
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(str)
    );
    return { iv: _toB64(iv), data: _toB64(new Uint8Array(enc)) };
  },
  async decryptWithKey(obj, key) {
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _fromB64(obj.iv) }, key, _fromB64(obj.data)
    );
    return new TextDecoder().decode(dec);
  },

  // ── RSA-OAEP ─────────────────────────────────────────────
  async genRSAKeyPair() {
    return crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
  },
  async exportPubJwk(k)  { return crypto.subtle.exportKey('jwk', k); },
  async exportPrivJwk(k) { return crypto.subtle.exportKey('jwk', k); },
  async importPubJwk(j)  { return crypto.subtle.importKey('jwk', j, { name:'RSA-OAEP', hash:'SHA-256' }, false, ['encrypt']); },
  async importPrivJwk(j) { return crypto.subtle.importKey('jwk', j, { name:'RSA-OAEP', hash:'SHA-256' }, false, ['decrypt']); },

  // AES-Key (als B64-String) mit RSA ver-/entschlüsseln
  async rsaEncryptKey(keyB64, pubKey) {
    const enc = await crypto.subtle.encrypt({ name:'RSA-OAEP' }, pubKey, _fromB64(keyB64));
    return _toB64(new Uint8Array(enc));
  },
  async rsaDecryptKey(encB64, privKey) {
    const dec = await crypto.subtle.decrypt({ name:'RSA-OAEP' }, privKey, _fromB64(encB64));
    return _toB64(new Uint8Array(dec));
  },

  // ── VERIFIKATIONSTOKEN (Login-Passwort prüfen) ────────────
  async createToken(password) { return this.encryptStr('kf_verified_v1', password); },
  async checkToken(tok, password) {
    try { return (await this.decryptStr(tok, password)) === 'kf_verified_v1'; }
    catch(e) { return false; }
  },

  // ── INI-DATEI (Tutor-Schlüsselpaar) ─────────────────────
  async createIni(teacherName, masterPassword) {
    const pair    = await this.genRSAKeyPair();
    const pubJwk  = await this.exportPubJwk(pair.publicKey);
    const privJwk = await this.exportPrivJwk(pair.privateKey);
    const encPriv = await this.encryptStr(JSON.stringify(privJwk), masterPassword);
    return JSON.stringify({
      kanbanfluss_ini: true, version: 1,
      teacherName, publicKey: pubJwk, encryptedPrivateKey: encPriv,
      createdAt: new Date().toISOString()
    }, null, 2);
  },

  async getPrivKeyFromIni(iniObj, masterPassword) {
    const jwkStr = await this.decryptStr(iniObj.encryptedPrivateKey, masterPassword);
    return this.importPrivJwk(JSON.parse(jwkStr));
  },
  async getPubKeyFromIni(iniObj) { return this.importPubJwk(iniObj.publicKey); },

  // ── DOPPELT VERSCHLÜSSELTES BACKUP (Schüler) ─────────────
  // Schüler können mit eigenem Passwort öffnen,
  // Tutor mit Masterpasswort + INI-Datei
  async encryptDual(jsonStr, studentPassword, teacherPubKey, teacherName) {
    const dataKey    = await this.genDataKey();
    const dataKeyB64 = await this.exportKey(dataKey);
    const encData    = await this.encryptWithKey(jsonStr, dataKey);
    const stuKeyEnc  = await this.encryptStr(dataKeyB64, studentPassword);
    const tchKeyEnc  = await this.rsaEncryptKey(dataKeyB64, teacherPubKey);
    return JSON.stringify({
      kanbanfluss: true, encrypted: true, version: 2,
      teacherName, stuKeyEnc, tchKeyEnc, encData,
      exportedAt: new Date().toISOString()
    });
  },

  async decryptDualStudent(obj, studentPassword) {
    const keyB64 = await this.decryptStr(obj.stuKeyEnc, studentPassword);
    return this.decryptWithKey(obj.encData, await this.importKey(keyB64));
  },

  async decryptDualTeacher(obj, teacherPrivKey) {
    const keyB64 = await this.rsaDecryptKey(obj.tchKeyEnc, teacherPrivKey);
    return this.decryptWithKey(obj.encData, await this.importKey(keyB64));
  },

  // Gibt { data, dataKeyB64, stuKeyEnc } zurück — für Rückgabe-Export an Schüler nötig
  async decryptDualTeacherFull(obj, teacherPrivKey) {
    const dataKeyB64 = await this.rsaDecryptKey(obj.tchKeyEnc, teacherPrivKey);
    const data = await this.decryptWithKey(obj.encData, await this.importKey(dataKeyB64));
    return { data, dataKeyB64, stuKeyEnc: obj.stuKeyEnc };
  },

  // Re-verschlüsselt modifizierte Daten mit gleichem dataKey + originalem stuKeyEnc
  // Schüler kann die zurückgegebene Datei mit seinem eigenen Passwort öffnen
  async encryptDualReturn(jsonStr, dataKeyB64, stuKeyEnc, teacherPubKey, teacherName) {
    const dataKey   = await this.importKey(dataKeyB64);
    const encData   = await this.encryptWithKey(jsonStr, dataKey);
    const tchKeyEnc = await this.rsaEncryptKey(dataKeyB64, teacherPubKey);
    return JSON.stringify({
      kanbanfluss: true, encrypted: true, version: 2,
      teacherName, stuKeyEnc, tchKeyEnc, encData,
      exportedAt: new Date().toISOString()
    });
  },
};

// INI-Dateien vom lokalen HTTP-Server auflisten
window.listIniFiles = async function() {
  try {
    const res  = await fetch(window.location.origin + '/');
    const html = await res.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('a')]
      .map(a => decodeURIComponent(a.getAttribute('href') || ''))
      .filter(h => h.endsWith('.ini'))
      .map(h => h.replace(/\.ini$/, ''));
  } catch(e) { return []; }
};

window.fetchIniFile = async function(name) {
  const res = await fetch(`${window.location.origin}/${encodeURIComponent(name)}.ini`);
  if (!res.ok) throw new Error(`INI-Datei "${name}.ini" nicht gefunden`);
  return JSON.parse(await res.text());
};
