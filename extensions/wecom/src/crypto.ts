import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { CONSTANTS } from "./types.js";

/**
 * AES-256-CBC encryption/decryption for WeCom AI Bot messages and media.
 */
export class WecomCrypto {
  private readonly token: string;
  private readonly aesKey: Buffer;
  private readonly iv: Buffer;

  constructor(token: string, encodingAesKey: string) {
    if (!encodingAesKey || encodingAesKey.length !== CONSTANTS.AES_KEY_LENGTH) {
      throw new Error(`EncodingAESKey invalid: length must be ${CONSTANTS.AES_KEY_LENGTH}`);
    }
    if (!token) throw new Error("Token is required");
    this.token = token;
    this.aesKey = Buffer.from(encodingAesKey + "=", "base64");
    this.iv = this.aesKey.subarray(0, 16);
  }

  getSignature(timestamp: string, nonce: string, encrypt: string): string {
    const sorted = [this.token, timestamp, nonce, encrypt].map(String).toSorted();
    return createHash("sha1").update(sorted.join("")).digest("hex");
  }

  decrypt(text: string): { message: string } {
    const decipher = createDecipheriv("aes-256-cbc", this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    let deciphered: Buffer<ArrayBuffer> = Buffer.concat([
      decipher.update(text, "base64"),
      decipher.final(),
    ]) as Buffer<ArrayBuffer>;
    deciphered = this.decodePkcs7(deciphered) as Buffer<ArrayBuffer>;

    // Format: 16 random bytes | 4 bytes msg_len | msg_content | appid
    const content = deciphered.subarray(16);
    const xmlLen = content.subarray(0, 4).readUInt32BE(0);
    const xmlContent = content.subarray(4, 4 + xmlLen).toString("utf-8");
    return { message: xmlContent };
  }

  encrypt(text: string): string {
    const random16 = randomBytes(16);
    const msgBuffer = Buffer.from(text);
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32BE(msgBuffer.length, 0);

    const rawMsg = Buffer.concat([random16, lenBuffer, msgBuffer]);
    const encoded = this.encodePkcs7(rawMsg);

    const cipher = createCipheriv("aes-256-cbc", this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(encoded), cipher.final()]).toString("base64");
  }

  decryptMedia(encryptedData: Buffer): Buffer {
    const decipher = createDecipheriv("aes-256-cbc", this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    const padLen = decrypted[decrypted.length - 1];
    if (padLen >= 1 && padLen <= 32) {
      let valid = true;
      for (let i = decrypted.length - padLen; i < decrypted.length; i++) {
        if (decrypted[i] !== padLen) {
          valid = false;
          break;
        }
      }
      if (valid) return decrypted.subarray(0, decrypted.length - padLen);
    }
    return decrypted;
  }

  private encodePkcs7(buff: Buffer): Buffer {
    const blockSize = CONSTANTS.AES_BLOCK_SIZE;
    const amountToPad = blockSize - (buff.length % blockSize);
    return Buffer.concat([buff, Buffer.alloc(amountToPad, amountToPad)]);
  }

  private decodePkcs7(buff: Buffer): Buffer {
    const pad = buff[buff.length - 1];
    if (pad < 1 || pad > CONSTANTS.AES_BLOCK_SIZE) {
      throw new Error(`Invalid PKCS7 padding: ${pad}`);
    }
    for (let i = buff.length - pad; i < buff.length; i++) {
      if (buff[i] !== pad) throw new Error("Invalid PKCS7 padding: inconsistent padding bytes");
    }
    return buff.subarray(0, buff.length - pad);
  }
}
