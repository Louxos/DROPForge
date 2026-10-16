/**
 * Public surface of the shared interface package.
 *
 * The application (installable PWA) renders these screens, and they are the only ones:
 * and the *same* application controller; only the platform adapters differ (storage,
 * filesystem, notifications, updates). That is why this module exists: the alternative
 * would be two copies of the interface, which is exactly what the project forbids.
 */
export { AppController } from './app/controller.js';
export type {
  AppNotice,
  AppState,
  ControllerOptions,
  HostedRoom,
  IdentityStore,
  IncomingRequestState,
  LinkFactory,
  LinkPeerInfo,
  LinkProvider,
  NewDeviceRequest,
  ReceiveFolderPort,
} from './app/controller.js';
export { pairingLinkFor, newRoomCode } from './app/controller.js';
export { Shell } from './app/shell.js';
export type { Route, ShellProps } from './app/shell.js';
export { createInstallWatch } from './platform/install.js';
export type { InstallWatch } from './platform/install.js';
export { useAppState } from './app/use-app-state.js';
export { TransferScreen } from './screens/transfer.js';
export { DevicesScreen } from './screens/devices.js';
export { ActivityScreen } from './screens/activity.js';
export { SettingsScreen } from './screens/settings.js';
export { BrandMark, EmptyState, NoticeStack, PageHeader, ProgressView, StateBadge } from './components/atoms.js';
export { NotificationService, unsupportedChannel } from '@dropforge/notifications';
export type { NotificationChannel, NotificationRequest } from '@dropforge/notifications';
export { setupI18n, changeLanguage, i18n, RESOURCES, flatten } from './i18n/index.js';
export type { Dictionary, Locale } from './i18n/index.js';
export { detectCapabilities, canTransfer, capabilityNotes, freeSpaceBytes, readStorageEstimate } from './platform/capabilities.js';
export type { PlatformCapabilities } from './platform/capabilities.js';
export { DirectoryFileSystem, DownloadFileSystem, triggerDownload, pickFiles, pickFolder, pickReceiveFolder, sourcesFromFileList } from './platform/browser-fs.js';
export { IndexedDbMetaStore } from './platform/indexed-db-store.js';
export { IndexedDbIdentityStore } from './platform/identity-store.js';
export { ReceiveFolderService } from './platform/receive-folder.js';
export { WebRtcLinkFactory } from './platform/webrtc-link.js';
export { RelayTransport, SignalingClient, WebRtcTransport } from './platform/webrtc-transport.js';
export { noUpdateSource, ServiceWorkerUpdateSource, UPDATE_IDLE } from './platform/updater.js';
export type { UpdateKind, UpdateSource, UpdateStatus } from './platform/updater.js';
