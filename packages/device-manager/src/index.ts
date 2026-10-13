/**
 * Device manager: known devices, trust and revocation, and the presence cache
 * used by discovery. Never holds a long-term key: it only stores public keys.
 */
export * from './devices.js';
export * from './discovery.js';
