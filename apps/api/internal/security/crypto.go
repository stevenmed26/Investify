package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

type Encryptor struct {
	key []byte
}

func NewEncryptor(secret string) *Encryptor {
	sum := sha256.Sum256([]byte(secret))
	return &Encryptor{key: sum[:]}
}

func (e *Encryptor) Encrypt(plaintext string) (string, error) {
	return e.encrypt(plaintext, nil, "")
}

func (e *Encryptor) EncryptWithAAD(plaintext string, aad []byte) (string, error) {
	return e.encrypt(plaintext, aad, "v2:")
}

func (e *Encryptor) encrypt(plaintext string, aad []byte, prefix string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), aad)
	return prefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (e *Encryptor) Decrypt(encoded string) (string, error) {
	return e.decrypt(encoded, nil)
}

func (e *Encryptor) DecryptWithAAD(encoded string, aad []byte) (string, error) {
	return e.decrypt(encoded, aad)
}

func (e *Encryptor) decrypt(encoded string, aad []byte) (string, error) {
	if len(encoded) > 3 && encoded[:3] == "v2:" {
		encoded = encoded[3:]
	} else {
		aad = nil
	}

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}

	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := raw[:gcm.NonceSize()]
	ciphertext := raw[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}
