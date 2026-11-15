const crypto = require('crypto');

function encryptionKey() {
  const key = process.env.BANK_DETAILS_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('BANK_DETAILS_ENCRYPTION_KEY must be a 32-byte hexadecimal key');
  }
  return Buffer.from(key, 'hex');
}

function encryptBankDetails(details) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(details), 'utf8'),
    cipher.final()
  ]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}

function decryptBankDetails(value) {
  const [ivValue, tagValue, ciphertextValue] = value.split('.');
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Encrypted bank details are malformed');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { encryptBankDetails, decryptBankDetails };
