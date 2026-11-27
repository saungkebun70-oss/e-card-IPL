import {
  SEED_PETUGAS_KEAMANAN,
  SUSUNAN_PENGURUS,
  type SessionUser,
  type UserRole,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import {
  dispatchActivityNotifications,
  getAllAdminUserIds,
  getCanonicalUserId,
} from './notificationService';
import { canonicalBlockKey, compareBlokRumah, formatBlokRumah } from './phoneAndBlockUtils';
import { SEED_WARGA } from './seedData';
import {
  extractUploadErrorDetails,
  type AttachmentPickerKind,
  type UploadQueueItem,
} from './chat/attachmentUtils';
import type {
  ChatMediaUploadProgress,
  ChatMediaUploadResult,
  UploadChatAttachmentParams,
} from './chatMediaUpload';

export type GroupChatRoomId =
  | 'grup_pengurus'
  | 'pengurus_keamanan'
  | 'pengurus_warga'
  | 'forum_umum'
  | 'warga_keamanan';

export type ChatRoomId = GroupChatRoomId | `dm:${string}`;

export interface ChatRoomMeta {
  id: GroupChatRoomId;
  label: string;
  shortLabel: string;
  description: string;
  participantsLabel: string;
  accentClass: string;
  allowedRoles: UserRole[];
}

export interface ChatContact {
  participant_id: string;
  dedup_key?: string;
  role: UserRole;
  display_name: string;
  subtitle: string;
  role_label?: string;
  unit_label?: string;
  blok_or_code: string;
  avatar_url?: string | null;
}

export interface DmThreadPreview {
  room_id: `dm:${string}`;
  peer_id: string;
  peer_name: string;
  peer_role: UserRole;
  peer_subtitle: string;
  peer_avatar_url: string | null;
  last_message: string;
  last_sender_id: string;
  last_created_at: string;
  unread_count: number;
}

export type ChatAttachmentType = 'none' | 'photo' | 'document' | 'video';
export type ChatAttachmentStorageProvider = 'google_drive' | 'supabase_transit';
export type ChatAttachmentStatus = 'pending_transfer' | 'uploading_video' | 'ready' | 'failed';
export type DrivePermissionScope = 'anyone_link' | 'restricted_private';

export interface ChatMessage {
  id: string;
  room_id: ChatRoomId;
  sender_role: UserRole;
  sender_id: string;
  sender_name: string;
  sender_subtitle: string;
  sender_avatar_url: string | null;
  recipient_id?: string | null;
  recipient_name?: string | null;
  recipient_role?: UserRole | null;
  message: string;
  reply_to_id: string | null;
  reply_preview: string | null;
  created_at: string;
  is_local_only?: boolean;
  attachment_type?: ChatAttachmentType;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size_bytes?: number | null;
  attachment_storage_provider?: ChatAttachmentStorageProvider | null;
  attachment_drive_file_id?: string | null;
  attachment_drive_folder_path?: string | null;
  attachment_url?: string | null;
  attachment_thumbnail_url?: string | null;
  attachment_status?: ChatAttachmentStatus | null;
  drive_permission_scope?: DrivePermissionScope | null;
  drive_web_view_link?: string | null;
  drive_thumbnail_link?: string | null;
  hidden_for?: string[];
  is_edited?: boolean;
  original_content?: string | null;
  edited_at?: string | null;
  /** Client-only instant preview URL sebelum upload selesai (tidak disimpan ke DB) */
  local_preview_url?: string | null;
  local_upload_local_id?: string | null;
}

export interface SendChatMessageInput {
  room_id: ChatRoomId;
  message: string;
  reply_to_id?: string | null;
  reply_preview?: string | null;
  recipient?: Pick<ChatContact, 'participant_id' | 'display_name' | 'role'> | null;
  attachment?: {
    attachment_type?: ChatAttachmentType;
    attachment_name?: string | null;
    attachment_mime?: string | null;
    attachment_size_bytes?: number | null;
    attachment_storage_provider?: ChatAttachmentStorageProvider | null;
    attachment_drive_file_id?: string | null;
    attachment_drive_folder_path?: string | null;
    attachment_url?: string | null;
    attachment_thumbnail_url?: string | null;
    attachment_status?: ChatAttachmentStatus | null;
    drive_permission_scope?: DrivePermissionScope | null;
    drive_web_view_link?: string | null;
    drive_thumbnail_link?: string | null;
  } | null;
}

const LOCAL_CHAT_MESSAGES_KEY = 'ecard_community_chat_messages_v1';
const LOCAL_CHAT_READ_PREFIX = 'ecard_community_chat_read_v1:';
const LOCAL_CHAT_CLEARED_PREFIX = 'ecard_community_chat_cleared_v1:';
const LOCAL_CHAT_HIDDEN_PREFIX = 'ecard_community_chat_hidden_v1:';
const CHAT_CHANGED_EVENT = 'ecard-community-chat-changed';
const MAX_LOCAL_MESSAGES = 400;
const MAX_MESSAGE_LENGTH = 1000;

export const CHAT_ROOMS: ChatRoomMeta[] = [
  {
    id: 'grup_pengurus',
    label: 'Grup Pengurus',
    shortLabel: 'Pengurus',
    description: 'Khusus Pengurus Lingkungan (Ketua, Bendahara, Pembina, Humas & Seksi Olahraga)',
    participantsLabel: 'Hanya Pengurus / Admin',
    accentClass: 'from-[#243825] to-[#384E35]',
    allowedRoles: ['admin'],
  },
  {
    id: 'pengurus_keamanan',
    label: 'Grup Pengurus & Keamanan',
    shortLabel: 'Pengurus & Keamanan',
    description: 'Khusus Pengurus dan Petugas Keamanan / Patroli (koordinasi pos & patroli NFC)',
    participantsLabel: 'Hanya Pengurus & Keamanan',
    accentClass: 'from-[#B5653B] to-[#C87058]',
    allowedRoles: ['admin', 'petugas'],
  },
  {
    id: 'pengurus_warga',
    label: 'Grup Pengurus & Warga',
    shortLabel: 'Pengurus & Warga',
    description: 'Khusus Pengurus dan Warga (iuran IPL, pengumuman & aspirasi lingkungan)',
    participantsLabel: 'Hanya Pengurus & Warga',
    accentClass: 'from-[#2B3F29] to-[#466143]',
    allowedRoles: ['admin', 'warga'],
  },
  {
    id: 'warga_keamanan',
    label: 'Grup Warga & Keamanan',
    shortLabel: 'Warga & Keamanan',
    description: 'Khusus Warga dan Petugas Keamanan (laporan tamu, gerbang & bantuan darurat)',
    participantsLabel: 'Hanya Warga & Keamanan',
    accentClass: 'from-[#2F5E4E] to-[#3E7662]',
    allowedRoles: ['warga', 'petugas'],
  },
  {
    id: 'forum_umum',
    label: 'Forum Lingkungan',
    shortLabel: 'Forum',
    description: 'Forum bersama Pengurus, Warga & Keamanan Perumahan Saung Kebun',
    participantsLabel: 'Pengurus · Warga · Keamanan',
    accentClass: 'from-[#243825] to-[#2B3F29]',
    allowedRoles: ['admin', 'warga', 'petugas'],
  },
];

const GROUP_ROOM_ID_SET = new Set<string>(CHAT_ROOMS.map((r) => r.id));

export function isGroupChatRoomId(roomId: string): roomId is GroupChatRoomId {
  return GROUP_ROOM_ID_SET.has(roomId);
}

export function isDmRoomId(roomId: string): roomId is `dm:${string}` {
  return typeof roomId === 'string' && roomId.startsWith('dm:') && roomId.slice(3).includes('__');
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan' || clean === 'iwan') return 'bpiwan';
  return clean;
}

const PENGURUS_BY_USERNAME = new Map(
  SUSUNAN_PENGURUS.map((p) => [canonicalAdminUsername(p.username), p])
);
const PENGURUS_BY_BLOK = new Map(
  SUSUNAN_PENGURUS.map((p) => [canonicalBlockKey(p.blokRumah), p])
);

export function normalizeChatUserRole(rawRole?: string | null): UserRole {
  const clean = normalizeToken(rawRole);
  if (clean === 'admin' || clean === 'bendahara' || clean === 'ketua' || clean === 'pengurus') {
    return 'admin';
  }
  if (clean === 'petugas' || clean === 'keamanan' || clean === 'satpam') {
    return 'petugas';
  }
  return 'warga';
}

/**
 * Menghasilkan ID kanonik peserta chat yang konsisten di Client & RLS SQL.
 * Khusus Warga, B03/07 dan B3/7 dinormalisasi menjadi `warga:b3/7`.
 * Khusus Admin, alias `admin` -> `andriansyah` dan `paiwan` -> `bpiwan`.
 */
export function getChatParticipantId(session?: SessionUser | null): string {
  if (!session) return 'anon';
  const role = normalizeChatUserRole(session.role);
  if (role === 'admin') {
    return `admin:${canonicalAdminUsername(session.blok_rumah)}`;
  }
  if (role === 'petugas') {
    return `petugas:${normalizeToken(session.petugas_id || session.blok_rumah)}`;
  }
  const canonBlok = canonicalBlockKey(session.blok_rumah).toLowerCase();
  return `warga:${canonBlok || normalizeToken(session.blok_rumah)}`;
}

/**
 * Mengembalikan seluruh variasi ID peserta milik sesi aktif untuk pencocokan pesan lama/baru.
 */
export function getChatParticipantMatchIds(session?: SessionUser | null): Set<string> {
  const ids = new Set<string>();
  if (!session) return ids;
  const role = normalizeChatUserRole(session.role);
  ids.add(getChatParticipantId(session));
  ids.add(getCanonicalUserId(session));

  if (role === 'admin') {
    const clean = normalizeToken(session.blok_rumah);
    const canonAdmin = canonicalAdminUsername(session.blok_rumah);
    if (canonAdmin) {
      ids.add(`admin:${canonAdmin}`);
      ids.add(`pengurus:${canonAdmin}`);
    }
    if (clean === 'admin' || clean === 'andriansyah') {
      ids.add('admin:admin');
      ids.add('admin:andriansyah');
      ids.add('pengurus:andriansyah');
    } else if (clean === 'paiwan' || clean === 'bpiwan') {
      ids.add('admin:paiwan');
      ids.add('admin:bpiwan');
      ids.add('pengurus:bpiwan');
    }
  } else if (role === 'warga') {
    const raw = normalizeToken(session.blok_rumah);
    if (raw) ids.add(`warga:${raw}`);
    const canon = canonicalBlockKey(session.blok_rumah).toLowerCase();
    if (canon) ids.add(`warga:${canon}`);
    const padded = normalizeToken(formatBlokRumah(session.blok_rumah));
    if (padded) ids.add(`warga:${padded}`);
  } else if (role === 'petugas') {
    if (session.petugas_id) {
      ids.add(`petugas:${normalizeToken(session.petugas_id)}`);
      ids.add(`keamanan:${normalizeToken(session.petugas_id)}`);
    }
    if (session.blok_rumah) {
      ids.add(`petugas:${normalizeToken(session.blok_rumah)}`);
      ids.add(`keamanan:${normalizeToken(session.blok_rumah)}`);
    }
    if (session.nama_warga) {
      ids.add(`petugas:${normalizeToken(session.nama_warga)}`);
      ids.add(`keamanan:${normalizeToken(session.nama_warga)}`);
    }
  }
  return ids;
}

export function normalizeChatParticipantId(rawId: string): string {
  const clean = normalizeToken(rawId);
  if (clean.startsWith('admin:')) {
    return `admin:${canonicalAdminUsername(clean.slice('admin:'.length))}`;
  }
  if (clean.startsWith('pengurus:')) {
    return `admin:${canonicalAdminUsername(clean.slice('pengurus:'.length))}`;
  }
  if (clean.startsWith('warga:')) {
    const sub = clean.slice('warga:'.length);
    const canon = canonicalBlockKey(sub).toLowerCase();
    return `warga:${canon || sub}`;
  }
  if (clean.startsWith('keamanan:')) {
    return `petugas:${clean.slice('keamanan:'.length)}`;
  }
  return clean;
}

export function buildDmRoomId(participantIdA: string, participantIdB: string): `dm:${string}` {
  const a = normalizeChatParticipantId(participantIdA);
  const b = normalizeChatParticipantId(participantIdB);
  const sorted = [a, b].sort((x, y) => x.localeCompare(y));
  return `dm:${sorted[0]}__${sorted[1]}`;
}

export function parseDmParticipants(roomId: string): [string, string] | null {
  if (!isDmRoomId(roomId)) return null;
  const body = roomId.slice(3);
  const idx = body.indexOf('__');
  if (idx <= 0) return null;
  const p1 = body.slice(0, idx);
  const p2 = body.slice(idx + 2);
  if (!p1 || !p2) return null;
  return [p1, p2];
}

export function getAccessibleChatRooms(session: SessionUser): ChatRoomMeta[] {
  const role = normalizeChatUserRole(session?.role);
  return CHAT_ROOMS.filter((room) => room.allowedRoles.includes(role));
}

export function canAccessChatRoom(session: SessionUser, roomId: ChatRoomId): boolean {
  if (isDmRoomId(roomId)) {
    const pair = parseDmParticipants(roomId);
    if (!pair) return false;
    const myIds = getChatParticipantMatchIds(session);
    return (
      myIds.has(normalizeChatParticipantId(pair[0])) ||
      myIds.has(normalizeChatParticipantId(pair[1])) ||
      myIds.has(pair[0]) ||
      myIds.has(pair[1])
    );
  }
  return getAccessibleChatRooms(session).some((r) => r.id === roomId);
}

function createUuidSafe(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fallback
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitChatChanged(detail?: {
  type?: 'insert' | 'update' | 'delete' | 'hide' | 'read' | 'clear';
  room_id?: ChatRoomId;
  message?: ChatMessage;
  deletedId?: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHAT_CHANGED_EVENT, { detail }));
  } catch {
    // Abaikan
  }
}

function readLocalMessages(): ChatMessage[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(LOCAL_CHAT_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function writeLocalMessages(messages: ChatMessage[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      LOCAL_CHAT_MESSAGES_KEY,
      JSON.stringify(messages.slice(-MAX_LOCAL_MESSAGES))
    );
  } catch {
    // Abaikan kuota storage
  }
}

function normalizeSenderRole(raw: unknown): UserRole {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'admin') return 'admin';
  if (clean === 'petugas' || clean === 'keamanan') return 'petugas';
  return 'warga';
}

function normalizeRoomId(raw: unknown): ChatRoomId {
  const clean = String(raw || '').trim();
  if (isGroupChatRoomId(clean)) {
    return clean;
  }
  if (isDmRoomId(clean)) {
    const pair = parseDmParticipants(clean);
    if (pair) {
      return buildDmRoomId(pair[0], pair[1]);
    }
    return clean;
  }
  return 'forum_umum';
}

function normalizeAttachmentType(raw: unknown): ChatAttachmentType {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'photo' || clean === 'document' || clean === 'video') return clean;
  return 'none';
}

function normalizeAttachmentProvider(raw: unknown): ChatAttachmentStorageProvider | null {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'google_drive' || clean === 'supabase_transit') return clean;
  return null;
}

function normalizeAttachmentStatus(raw: unknown): ChatAttachmentStatus | null {
  const clean = String(raw || '').trim().toLowerCase();
  if (
    clean === 'pending_transfer' ||
    clean === 'uploading_video' ||
    clean === 'ready' ||
    clean === 'failed'
  ) {
    return clean;
  }
  return null;
}

function normalizeDrivePermissionScope(raw: unknown): DrivePermissionScope | null {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'anyone_link' || clean === 'restricted_private') return clean;
  return null;
}

function extractDriveFileIdFromString(raw?: string | null): string {
  const val = String(raw || '').trim();
  if (!val) return '';
  const param = val.match(/[?&]fileId=([a-zA-Z0-9_-]{10,})/i);
  if (param?.[1]) return param[1];
  const pathMatch = val.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const lhMatch = val.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (lhMatch?.[1]) return lhMatch[1];
  const idMatch = val.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i);
  if (idMatch?.[1]) return idMatch[1];
  return '';
}

function inferImageOrVideoFromNameOrMime(
  mime?: string | null,
  name?: string | null
): 'photo' | 'video' | null {
  const m = String(mime || '').trim().toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(n)) {
    return 'photo';
  }
  if (m.startsWith('video/') || /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i.test(n)) {
    return 'video';
  }
  return null;
}

function normalizeHiddenForList(raw: unknown): string[] {
  let source: unknown[] = [];
  if (Array.isArray(raw)) {
    source = raw;
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) source = parsed;
    } catch {
      source = [];
    }
  }
  if (source.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    if (typeof entry !== 'string') continue;
    const clean = entry.trim();
    if (!clean) continue;
    const key = normalizeChatParticipantId(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function normalizeChatRow(row: Record<string, unknown>): ChatMessage {
  const rawSize = Number(row.attachment_size_bytes ?? row.file_size);
  const messageText = String(row.message || '');
  const attachmentUrl =
    typeof row.attachment_url === 'string' && row.attachment_url.trim()
      ? row.attachment_url.trim()
      : null;
  const attachmentThumbnailUrl =
    typeof row.attachment_thumbnail_url === 'string' && row.attachment_thumbnail_url.trim()
      ? row.attachment_thumbnail_url.trim()
      : null;
  const driveWebViewLink =
    typeof row.drive_web_view_link === 'string' && row.drive_web_view_link.trim()
      ? row.drive_web_view_link.trim()
      : null;
  const driveThumbnailLink =
    typeof row.drive_thumbnail_link === 'string' && row.drive_thumbnail_link.trim()
      ? row.drive_thumbnail_link.trim()
      : null;

  const rawDriveFileId =
    typeof row.attachment_drive_file_id === 'string' && row.attachment_drive_file_id.trim()
      ? row.attachment_drive_file_id.trim()
      : typeof row.drive_file_id === 'string' && row.drive_file_id.trim()
        ? row.drive_file_id.trim()
        : '';
  const resolvedDriveFileId =
    rawDriveFileId ||
    extractDriveFileIdFromString(attachmentUrl) ||
    extractDriveFileIdFromString(driveWebViewLink) ||
    extractDriveFileIdFromString(attachmentThumbnailUrl) ||
    extractDriveFileIdFromString(driveThumbnailLink) ||
    null;

  const rawName =
    typeof row.attachment_name === 'string' && row.attachment_name.trim()
      ? row.attachment_name.trim()
      : typeof row.file_name === 'string' && row.file_name.trim()
        ? row.file_name.trim()
        : '';
  const tagNameMatch = messageText.trim().match(/^\[(foto|video|dokumen|file)\]\s+(.+)$/i);
  const resolvedName = rawName || (tagNameMatch?.[2] ? tagNameMatch[2].trim() : '') || null;

  const resolvedMime =
    typeof row.attachment_mime === 'string' && row.attachment_mime.trim()
      ? row.attachment_mime.trim()
      : typeof row.mime_type === 'string' && row.mime_type.trim()
        ? row.mime_type.trim()
        : null;

  let resolvedType = normalizeAttachmentType(row.attachment_type);
  const mediaKindFromMimeOrName = inferImageOrVideoFromNameOrMime(resolvedMime, resolvedName);
  const hasAttachmentLink = Boolean(resolvedDriveFileId || attachmentUrl || driveWebViewLink);

  if (resolvedType === 'none' && hasAttachmentLink) {
    if (mediaKindFromMimeOrName) {
      resolvedType = mediaKindFromMimeOrName;
    } else if (/^\[foto\]\s+/i.test(messageText.trim())) {
      resolvedType = 'photo';
    } else if (/^\[video\]\s+/i.test(messageText.trim())) {
      resolvedType = 'video';
    } else {
      resolvedType = 'document';
    }
  } else if (resolvedType === 'document' && mediaKindFromMimeOrName === 'photo') {
    resolvedType = 'photo';
  } else if (resolvedType === 'document' && mediaKindFromMimeOrName === 'video') {
    resolvedType = 'video';
  }

  return {
    id: String(row.id || createUuidSafe()),
    room_id: normalizeRoomId(row.room_id),
    sender_role: normalizeSenderRole(row.sender_role),
    sender_id: String(row.sender_id || ''),
    sender_name: String(row.sender_name || 'Pengguna'),
    sender_subtitle: String(row.sender_subtitle || ''),
    sender_avatar_url: typeof row.sender_avatar_url === 'string' ? row.sender_avatar_url : null,
    recipient_id: typeof row.recipient_id === 'string' ? row.recipient_id : null,
    recipient_name: typeof row.recipient_name === 'string' ? row.recipient_name : null,
    recipient_role: row.recipient_role ? normalizeSenderRole(row.recipient_role) : null,
    message: messageText,
    reply_to_id: typeof row.reply_to_id === 'string' ? row.reply_to_id : null,
    reply_preview: typeof row.reply_preview === 'string' ? row.reply_preview : null,
    created_at: String(row.created_at || new Date().toISOString()),
    is_local_only: false,
    attachment_type: resolvedType,
    attachment_name: resolvedName,
    attachment_mime: resolvedMime,
    attachment_size_bytes: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null,
    attachment_storage_provider: normalizeAttachmentProvider(row.attachment_storage_provider),
    attachment_drive_file_id: resolvedDriveFileId,
    attachment_drive_folder_path:
      typeof row.attachment_drive_folder_path === 'string' ? row.attachment_drive_folder_path : null,
    attachment_url: attachmentUrl,
    attachment_thumbnail_url: attachmentThumbnailUrl,
    attachment_status:
      normalizeAttachmentStatus(row.attachment_status) ||
      (hasAttachmentLink && resolvedType !== 'none' ? 'ready' : null),
    drive_permission_scope: normalizeDrivePermissionScope(row.drive_permission_scope),
    drive_web_view_link: driveWebViewLink,
    drive_thumbnail_link: driveThumbnailLink,
    hidden_for: normalizeHiddenForList(row.hidden_for),
    is_edited: Boolean(row.is_edited),
    original_content: typeof row.original_content === 'string' ? row.original_content : null,
    edited_at:
      typeof row.edited_at === 'string' && row.edited_at.trim() ? row.edited_at.trim() : null,
  };
}

export function buildSenderSubtitle(session: SessionUser): string {
  if (session.role === 'admin') {
    return session.jabatan || 'Pengurus';
  }
  if (session.role === 'petugas') {
    return session.shift ? `Keamanan · ${session.shift}` : 'Petugas Keamanan';
  }
  return `Warga Blok ${formatBlokRumah(session.blok_rumah) || session.blok_rumah}`;
}

export function getChatReadStorageKey(session: SessionUser): string {
  return `${LOCAL_CHAT_READ_PREFIX}${getChatParticipantId(session)}`;
}

function readLastReadMap(session: SessionUser): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(getChatReadStorageKey(session));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function markChatRoomRead(session: SessionUser, roomId: ChatRoomId, latestIso?: string): void {
  try {
    if (typeof window === 'undefined') return;
    const current = readLastReadMap(session);
    const stamp = latestIso && Date.parse(latestIso) > Date.now() ? latestIso : new Date().toISOString();
    current[roomId] = stamp;
    window.localStorage.setItem(getChatReadStorageKey(session), JSON.stringify(current));
    emitChatChanged({ type: 'read', room_id: roomId });
  } catch {
    // Abaikan
  }
}

export function getChatClearedStorageKey(session: SessionUser): string {
  return `${LOCAL_CHAT_CLEARED_PREFIX}${getChatParticipantId(session)}`;
}

function readClearedMap(session: SessionUser): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(getChatClearedStorageKey(session));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function isMessageClearedForRoom(
  session: SessionUser,
  roomId: ChatRoomId,
  createdAt: string
): boolean {
  const clearedMap = readClearedMap(session);
  const normalizedRoom = normalizeRoomId(roomId);
  const cutoffIso = clearedMap[normalizedRoom];
  if (!cutoffIso) return false;
  const cutoffMs = Date.parse(cutoffIso);
  const msgMs = Date.parse(createdAt);
  if (Number.isNaN(cutoffMs) || Number.isNaN(msgMs)) return false;
  return msgMs <= cutoffMs;
}

export function getChatHiddenStorageKey(session: SessionUser): string {
  return `${LOCAL_CHAT_HIDDEN_PREFIX}${getChatParticipantId(session)}`;
}

function readLocalHiddenMessageIds(session: SessionUser): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(getChatHiddenStorageKey(session));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0));
  } catch {
    return new Set();
  }
}

function rememberLocalHiddenMessageId(session: SessionUser, messageId: string): void {
  try {
    if (typeof window === 'undefined' || !messageId) return;
    const current = Array.from(readLocalHiddenMessageIds(session));
    if (!current.includes(messageId)) {
      current.push(messageId);
      window.localStorage.setItem(
        getChatHiddenStorageKey(session),
        JSON.stringify(current.slice(-600))
      );
    }
  } catch {
    // Abaikan kuota storage
  }
}

/**
 * Menentukan apakah sebuah pesan telah dihapus khusus oleh pengguna aktif ("Hapus untuk Saya")
 * baik dari kolom `hidden_for` database maupun catatan lokal perangkat.
 */
export function isMessageHiddenForSession(
  session: SessionUser,
  msg: Pick<ChatMessage, 'id' | 'hidden_for'>
): boolean {
  if (!msg?.id) return false;
  if (readLocalHiddenMessageIds(session).has(msg.id)) {
    return true;
  }
  const hiddenList = Array.isArray(msg.hidden_for) ? msg.hidden_for : [];
  if (hiddenList.length === 0) return false;
  const myIds = getChatParticipantMatchIds(session);
  for (const entry of hiddenList) {
    const clean = String(entry || '').trim();
    if (!clean) continue;
    if (myIds.has(clean) || myIds.has(clean.toLowerCase()) || myIds.has(normalizeChatParticipantId(clean))) {
      return true;
    }
  }
  return false;
}

function formatEnrichedContact(item: ChatContact): ChatContact {
  const canonId = normalizeChatParticipantId(item.participant_id);
  const role = item.role;

  if (role === 'admin') {
    const usernameKey = canonicalAdminUsername(canonId.slice('admin:'.length));
    const pengurusMeta = PENGURUS_BY_USERNAME.get(usernameKey);
    const rawName = (pengurusMeta?.nama || item.display_name || 'Pengurus').replace(/\s*\(Bendahara\)\s*$/i, '').trim();
    const jabatan = pengurusMeta?.jabatan || item.subtitle || 'Pengurus';
    const rawBlock = pengurusMeta?.blokRumah || item.blok_or_code || '';
    const canonBlock = canonicalBlockKey(rawBlock) || rawBlock.toUpperCase();
    const displayBlock = formatBlokRumah(rawBlock) || canonBlock;
    const unitLabel = displayBlock && /^B\d+/i.test(displayBlock) ? `Blok ${displayBlock}` : 'Sekretariat Blok B03/07';
    const roleLabel = jabatan && jabatan !== 'Pengurus' ? `Pengurus · ${jabatan}` : 'Pengurus';
    return {
      ...item,
      participant_id: `admin:${usernameKey}`,
      role: 'admin',
      display_name: rawName,
      subtitle: `${roleLabel} · ${unitLabel}`,
      role_label: roleLabel,
      unit_label: unitLabel,
      blok_or_code: displayBlock || usernameKey.toUpperCase(),
      dedup_key: `admin:${usernameKey}:${canonBlock.toLowerCase()}`,
    };
  }

  if (role === 'petugas') {
    const shiftText = (item.subtitle || 'Petugas Keamanan').trim();
    const unitLabel = shiftText && shiftText !== 'Petugas Keamanan' ? shiftText : 'Pos Keamanan Saung Kebun';
    const cleanName = (item.display_name || 'Petugas Keamanan').trim();
    return {
      ...item,
      participant_id: canonId,
      role: 'petugas',
      display_name: cleanName,
      subtitle: `Keamanan · ${unitLabel}`,
      role_label: 'Keamanan',
      unit_label: unitLabel,
      blok_or_code: item.blok_or_code || cleanName,
      dedup_key: `petugas:${cleanName.toLowerCase().replace(/\s+/g, '')}`,
    };
  }

  const rawUnit = canonId.startsWith('warga:') ? canonId.slice('warga:'.length) : item.blok_or_code;
  const canonBlok = canonicalBlockKey(item.blok_or_code || rawUnit) || (item.blok_or_code || rawUnit).toUpperCase();
  const displayBlok = formatBlokRumah(item.blok_or_code || rawUnit) || canonBlok;
  const unitLabel = displayBlok ? `Blok ${displayBlok}` : 'Warga';
  return {
    ...item,
    participant_id: `warga:${canonBlok.toLowerCase()}`,
    role: 'warga',
    display_name: (item.display_name || `Warga ${unitLabel}`).trim(),
    subtitle: `Warga · ${unitLabel}`,
    role_label: `Warga · ${unitLabel}`,
    unit_label: unitLabel,
    blok_or_code: displayBlok,
    dedup_key: `warga:${canonBlok.toLowerCase()}`,
  };
}

/**
 * Mengambil direktori kontak untuk DM & daftar anggota grup (Pengurus, Keamanan, & Warga)
 * dengan menyertakan Blok/Nomor Rumah & Peran tanpa mengekspos PIN/WA, serta deduplikasi ketat.
 */
export async function fetchChatDirectory(session: SessionUser): Promise<ChatContact[]> {
  const myIds = getChatParticipantMatchIds(session);
  const contactMap = new Map<string, ChatContact>();
  const secondaryKeyToPid = new Map<string, string>();

  const upsertContact = (item: ChatContact) => {
    const enriched = formatEnrichedContact(item);
    const canonId = enriched.participant_id;
    if (!canonId || myIds.has(canonId)) return;

    // Deduplikasi sekunder (nama + role + unit/kode) agar tidak pernah muncul nama ganda
    const secKey =
      enriched.dedup_key ||
      `${enriched.role}:${enriched.display_name.toLowerCase().replace(/\s+/g, '')}:${enriched.blok_or_code.toLowerCase()}`;
    const mappedPid = secondaryKeyToPid.get(secKey);
    const targetKey = mappedPid || canonId;
    secondaryKeyToPid.set(secKey, targetKey);

    const existing = contactMap.get(targetKey);
    if (!existing) {
      contactMap.set(targetKey, enriched);
    } else {
      contactMap.set(targetKey, {
        ...existing,
        participant_id: canonId.length > 0 ? canonId : existing.participant_id,
        display_name: enriched.display_name || existing.display_name,
        subtitle: enriched.subtitle || existing.subtitle,
        role_label: enriched.role_label || existing.role_label,
        unit_label: enriched.unit_label || existing.unit_label,
        blok_or_code: enriched.blok_or_code || existing.blok_or_code,
        avatar_url: enriched.avatar_url || existing.avatar_url || null,
      });
    }
  };

  // 1. Seed Pengurus & Petugas default agar selalu tersedia cepat
  for (const p of SUSUNAN_PENGURUS) {
    upsertContact({
      participant_id: `admin:${canonicalAdminUsername(p.username)}`,
      role: 'admin',
      display_name: p.nama,
      subtitle: p.jabatan,
      blok_or_code: p.blokRumah,
    });
  }

  for (const pet of SEED_PETUGAS_KEAMANAN) {
    if (!pet.aktif) continue;
    upsertContact({
      participant_id: `petugas:${normalizeToken(pet.id)}`,
      role: 'petugas',
      display_name: pet.nama,
      subtitle: pet.shift || 'Petugas Keamanan',
      blok_or_code: pet.username,
      avatar_url: pet.avatar_url || null,
    });
  }

  // 2. Seed Warga lokal (fallback jika offline / belum migrasi v14)
  for (const w of SEED_WARGA) {
    if (!w.aktif || w.status_hunian === 'Kosong') continue;
    upsertContact({
      participant_id: `warga:${canonicalBlockKey(w.blok_rumah).toLowerCase()}`,
      role: 'warga',
      display_name: w.nama_warga,
      subtitle: `Warga Blok ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`,
      blok_or_code: formatBlokRumah(w.blok_rumah) || w.blok_rumah,
      avatar_url: w.avatar_url || null,
    });
  }

  // 3. Sinkron dari Supabase (RPC get_chat_directory v14 -> fallback ke get_petugas_kontak_darurat & users_warga jika admin)
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    let loadedRpcDirectory = false;
    try {
      const { data, error } = await supabase.rpc('get_chat_directory');
      if (!error && Array.isArray(data) && data.length > 0) {
        loadedRpcDirectory = true;
        // Hapus seed petugas & warga agar data live DB yang akurat menggantikannya
        for (const [k, v] of Array.from(contactMap.entries())) {
          if (v.role !== 'admin') {
            contactMap.delete(k);
          }
        }
        for (const [sk, pid] of Array.from(secondaryKeyToPid.entries())) {
          if (!contactMap.has(pid)) {
            secondaryKeyToPid.delete(sk);
          }
        }
        for (const raw of data as Array<Record<string, unknown>>) {
          const role = normalizeSenderRole(raw.role);
          const pid = String(raw.participant_id || '').trim();
          if (!pid) continue;
          upsertContact({
            participant_id: pid,
            role,
            display_name: String(raw.display_name || 'Pengguna'),
            subtitle: String(raw.subtitle || ''),
            blok_or_code: String(raw.blok_or_code || ''),
          });
        }
      }
    } catch {
      // Gunakan fallback
    }

    if (!loadedRpcDirectory) {
      try {
        const { data: petugasRows } = await supabase.rpc('get_petugas_kontak_darurat');
        if (Array.isArray(petugasRows) && petugasRows.length > 0) {
          for (const [k, v] of Array.from(contactMap.entries())) {
            if (v.role === 'petugas') contactMap.delete(k);
          }
          for (const [sk, pid] of Array.from(secondaryKeyToPid.entries())) {
            if (!contactMap.has(pid)) secondaryKeyToPid.delete(sk);
          }
          for (const raw of petugasRows as Array<Record<string, unknown>>) {
            const id = String(raw.id || '').trim();
            if (!id) continue;
            upsertContact({
              participant_id: `petugas:${normalizeToken(id)}`,
              role: 'petugas',
              display_name: String(raw.nama || 'Petugas Keamanan'),
              subtitle: String(raw.shift || 'Petugas Keamanan'),
              blok_or_code: String(raw.nama || ''),
            });
          }
        }
      } catch {
        // Abaikan
      }

      if (session.role === 'admin') {
        try {
          const { data: wargaRows } = await supabase
            .from('users_warga')
            .select('blok_rumah, nama_warga, status_hunian, role, jabatan, aktif')
            .eq('aktif', true);
          if (Array.isArray(wargaRows) && wargaRows.length > 0) {
            for (const raw of wargaRows as Array<Record<string, unknown>>) {
              const rowRole = String(raw.role || 'warga').toLowerCase();
              const blok = String(raw.blok_rumah || '').trim();
              const nama = String(raw.nama_warga || '').trim();
              if (!blok || !nama) continue;
              if (rowRole === 'admin' || rowRole === 'bendahara') {
                upsertContact({
                  participant_id: `admin:${canonicalAdminUsername(blok)}`,
                  role: 'admin',
                  display_name: nama,
                  subtitle: String(raw.jabatan || 'Pengurus'),
                  blok_or_code: blok,
                });
              } else if (String(raw.status_hunian || '').toLowerCase() !== 'kosong') {
                const dispBlok = formatBlokRumah(blok) || blok;
                upsertContact({
                  participant_id: `warga:${canonicalBlockKey(blok).toLowerCase()}`,
                  role: 'warga',
                  display_name: nama,
                  subtitle: `Warga Blok ${dispBlok}`,
                  blok_or_code: dispBlok,
                });
              }
            }
          }
        } catch {
          // Abaikan
        }
      }
    }
  }

  const rolePriority: Record<UserRole, number> = { admin: 0, petugas: 1, warga: 2 };
  return Array.from(contactMap.values()).sort((a, b) => {
    const rp = rolePriority[a.role] - rolePriority[b.role];
    if (rp !== 0) return rp;
    const blokCmp = compareBlokRumah(a.blok_or_code, b.blok_or_code);
    if (blokCmp !== 0) return blokCmp;
    return a.display_name.localeCompare(b.display_name, 'id');
  });
}

/**
 * Mengembalikan daftar anggota sah pada suatu ruang Group berdasarkan aturan keanggotaan peran yang ketat.
 */
export function getGroupMembers(
  roomId: GroupChatRoomId,
  session: SessionUser,
  contacts: ChatContact[]
): Array<ChatContact & { isSelf?: boolean }> {
  const roomMeta = CHAT_ROOMS.find((r) => r.id === roomId);
  if (!roomMeta) return [];

  const allowedSet = new Set<UserRole>(roomMeta.allowedRoles);
  const list: Array<ChatContact & { isSelf?: boolean }> = [];
  const seenKeys = new Set<string>();

  const sessionRole = normalizeChatUserRole(session?.role);
  if (allowedSet.has(sessionRole)) {
    const selfContact = formatEnrichedContact({
      participant_id: getChatParticipantId(session),
      role: sessionRole,
      display_name: session.nama_warga || 'Anda',
      subtitle:
        sessionRole === 'admin'
          ? session.jabatan || 'Pengurus'
          : sessionRole === 'petugas'
            ? session.shift || 'Petugas Keamanan'
            : `Warga Blok ${formatBlokRumah(session.blok_rumah) || session.blok_rumah}`,
      blok_or_code: session.blok_rumah,
      avatar_url: session.avatar_url || null,
    });
    seenKeys.add(selfContact.dedup_key || selfContact.participant_id);
    list.push({ ...selfContact, isSelf: true });
  }

  for (const c of contacts) {
    if (!allowedSet.has(c.role)) continue;
    const key = c.dedup_key || c.participant_id;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    list.push(c);
  }

  return list;
}

/**
 * Mengambil daftar pesan untuk 1 ruang chat (grup maupun DM personal).
 */
export async function fetchChatMessages(
  session: SessionUser,
  roomId: ChatRoomId,
  limit = 100
): Promise<{ messages: ChatMessage[]; remoteAvailable: boolean }> {
  if (!canAccessChatRoom(session, roomId)) {
    return { messages: [], remoteAvailable: false };
  }

  const normalizedRoom = normalizeRoomId(roomId);
  const clearedMap = readClearedMap(session);
  const cutoffMs = clearedMap[normalizedRoom] ? Date.parse(clearedMap[normalizedRoom]) : NaN;
  const keepAfterClear = (msg: ChatMessage) => {
    if (Number.isNaN(cutoffMs)) return true;
    const msgMs = Date.parse(msg.created_at);
    return Number.isNaN(msgMs) ? true : msgMs > cutoffMs;
  };

  const localRoomMessages = readLocalMessages().filter(
    (m) =>
      normalizeRoomId(m.room_id) === normalizedRoom &&
      keepAfterClear(m) &&
      !isMessageHiddenForSession(session, m)
  );
  const supabase = getSupabaseClient(session);

  if (!supabase || !isSupabaseConfigured()) {
    return {
      messages: localRoomMessages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
      remoteAvailable: false,
    };
  }

  try {
    const { data, error } = await supabase
      .from('community_chat_messages')
      .select('*')
      .eq('room_id', normalizedRoom)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return {
        messages: localRoomMessages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
        remoteAvailable: false,
      };
    }

    const remoteRows = data
      .map((row) => normalizeChatRow(row as Record<string, unknown>))
      .filter((m) => keepAfterClear(m) && !isMessageHiddenForSession(session, m));
    const remoteIdSet = new Set(remoteRows.map((m) => m.id));
    const merged = [
      ...remoteRows,
      ...localRoomMessages.filter((m) => m.is_local_only && !remoteIdSet.has(m.id)),
    ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    return { messages: merged, remoteAvailable: true };
  } catch {
    return {
      messages: localRoomMessages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
      remoteAvailable: false,
    };
  }
}

export async function fetchChatMessageById(
  session: SessionUser,
  messageId: string
): Promise<ChatMessage | null> {
  const cleanId = String(messageId || '').trim();
  if (!cleanId || cleanId.startsWith('chat-')) return null;

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('community_chat_messages')
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();
    if (error || !data) return null;
    const normalized = normalizeChatRow(data as Record<string, unknown>);
    return canAccessChatRoom(session, normalized.room_id) ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * Mengambil ringkasan percakapan DM Personal yang pernah berlangsung + jumlah belum dibaca.
 */
export async function fetchDmConversations(
  session: SessionUser,
  contacts: ChatContact[]
): Promise<DmThreadPreview[]> {
  const myIds = getChatParticipantMatchIds(session);
  const contactById = new Map<string, ChatContact>();
  for (const c of contacts) {
    contactById.set(normalizeChatParticipantId(c.participant_id), c);
  }

  const clearedMap = readClearedMap(session);
  const keepAfterClear = (msg: ChatMessage) => {
    const cutoffIso = clearedMap[normalizeRoomId(msg.room_id)];
    if (!cutoffIso) return true;
    const cutoffMs = Date.parse(cutoffIso);
    const msgMs = Date.parse(msg.created_at);
    return Number.isNaN(cutoffMs) || Number.isNaN(msgMs) ? true : msgMs > cutoffMs;
  };

  const localDms = readLocalMessages().filter(
    (m) =>
      isDmRoomId(m.room_id) &&
      canAccessChatRoom(session, m.room_id) &&
      keepAfterClear(m) &&
      !isMessageHiddenForSession(session, m)
  );
  let allDms: ChatMessage[] = [...localDms];

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('community_chat_messages')
        .select('*')
        .like('room_id', 'dm:%')
        .order('created_at', { ascending: false })
        .limit(150);
      if (!error && Array.isArray(data)) {
        const remote = data
          .map((r) => normalizeChatRow(r as Record<string, unknown>))
          .filter(
            (m) =>
              isDmRoomId(m.room_id) &&
              canAccessChatRoom(session, m.room_id) &&
              keepAfterClear(m) &&
              !isMessageHiddenForSession(session, m)
          );
        const remoteIds = new Set(remote.map((m) => m.id));
        allDms = [
          ...remote,
          ...localDms.filter((m) => m.is_local_only && !remoteIds.has(m.id)),
        ];
      }
    } catch {
      // Gunakan fallback lokal
    }
  }

  const lastReadMap = readLastReadMap(session);
  const fallbackCutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const threadMap = new Map<string, DmThreadPreview>();

  const sortedMsgs = [...allDms].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
  );

  for (const msg of sortedMsgs) {
    const pair = parseDmParticipants(msg.room_id);
    if (!pair) continue;
    const norm0 = normalizeChatParticipantId(pair[0]);
    const norm1 = normalizeChatParticipantId(pair[1]);
    const peerId = myIds.has(norm0) ? norm1 : norm0;
    const isMine = myIds.has(normalizeChatParticipantId(msg.sender_id)) || myIds.has(msg.sender_id);

    const contact = contactById.get(peerId);
    const peerRole: UserRole =
      contact?.role ||
      (!isMine
        ? msg.sender_role
        : msg.recipient_role ||
          (peerId.startsWith('admin:') ? 'admin' : peerId.startsWith('petugas:') ? 'petugas' : 'warga'));
    const peerName =
      contact?.display_name ||
      (!isMine ? msg.sender_name : msg.recipient_name) ||
      peerId.split(':').slice(1).join(':').toUpperCase();
    const peerSubtitle =
      contact?.subtitle ||
      (!isMine
        ? msg.sender_subtitle
        : peerRole === 'admin'
          ? 'Pengurus'
          : peerRole === 'petugas'
            ? 'Petugas Keamanan'
            : 'Warga');

    const prev = threadMap.get(msg.room_id);
    let unreadCount = prev?.unread_count || 0;
    if (!isMine) {
      const msgMs = Date.parse(msg.created_at);
      const lastReadIso = lastReadMap[msg.room_id];
      const cutoffMs = lastReadIso ? Date.parse(lastReadIso) : fallbackCutoffMs;
      if (!Number.isNaN(msgMs) && msgMs > cutoffMs) {
        unreadCount += 1;
      }
    }

    threadMap.set(msg.room_id, {
      room_id: msg.room_id as `dm:${string}`,
      peer_id: peerId,
      peer_name: peerName,
      peer_role: peerRole,
      peer_subtitle: peerSubtitle,
      peer_avatar_url: contact?.avatar_url || (!isMine ? msg.sender_avatar_url : null) || null,
      last_message: msg.message,
      last_sender_id: msg.sender_id,
      last_created_at: msg.created_at,
      unread_count: unreadCount,
    });
  }

  return Array.from(threadMap.values()).sort(
    (a, b) => Date.parse(b.last_created_at) - Date.parse(a.last_created_at)
  );
}

/**
 * Menghitung pesan belum dibaca per ruang chat (grup + DM) & total untuk badge melayang/header.
 */
export async function fetchChatUnreadSummary(session: SessionUser): Promise<{
  totalUnread: number;
  byRoom: Record<string, number>;
}> {
  const byRoom: Record<string, number> = {
    grup_pengurus: 0,
    pengurus_keamanan: 0,
    pengurus_warga: 0,
    forum_umum: 0,
    warga_keamanan: 0,
  };

  const accessible = getAccessibleChatRooms(session);
  const accessibleGroupIds = new Set(accessible.map((r) => r.id));
  const myIds = getChatParticipantMatchIds(session);
  const lastReadMap = readLastReadMap(session);
  const clearedMap = readClearedMap(session);

  let messages: ChatMessage[] = readLocalMessages().filter(
    (m) => canAccessChatRoom(session, m.room_id) && !isMessageHiddenForSession(session, m)
  );

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const primaryRes = await supabase
        .from('community_chat_messages')
        .select('id, room_id, sender_id, created_at, hidden_for')
        .order('created_at', { ascending: false })
        .limit(180);

      let rawRows: Array<Record<string, unknown>> | null =
        !primaryRes.error && Array.isArray(primaryRes.data)
          ? (primaryRes.data as Array<Record<string, unknown>>)
          : null;

      if (
        primaryRes.error &&
        (String(primaryRes.error.message || '').toLowerCase().includes('hidden_for') ||
          primaryRes.error.code === '42703' ||
          primaryRes.error.code === 'PGRST204')
      ) {
        const fallbackRes = await supabase
          .from('community_chat_messages')
          .select('id, room_id, sender_id, created_at')
          .order('created_at', { ascending: false })
          .limit(180);
        if (!fallbackRes.error && Array.isArray(fallbackRes.data)) {
          rawRows = fallbackRes.data as Array<Record<string, unknown>>;
        }
      }

      if (rawRows) {
        const remote = rawRows
          .map((row) => normalizeChatRow(row))
          .filter(
            (m) => canAccessChatRoom(session, m.room_id) && !isMessageHiddenForSession(session, m)
          );
        const remoteIds = new Set(remote.map((m) => m.id));
        messages = [
          ...remote,
          ...messages.filter((m) => m.is_local_only && !remoteIds.has(m.id)),
        ];
      }
    } catch {
      // Gunakan fallback lokal
    }
  }

  const fallbackCutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  let totalUnread = 0;

  for (const msg of messages) {
    if (!isDmRoomId(msg.room_id) && !accessibleGroupIds.has(msg.room_id)) continue;
    if (isMessageHiddenForSession(session, msg)) continue;
    const isMine =
      myIds.has(normalizeChatParticipantId(msg.sender_id)) || myIds.has(msg.sender_id);
    if (isMine) continue;

    const msgMs = Date.parse(msg.created_at);
    if (Number.isNaN(msgMs)) continue;
    const clearedIso = clearedMap[normalizeRoomId(msg.room_id)];
    if (clearedIso) {
      const clearedMs = Date.parse(clearedIso);
      if (!Number.isNaN(clearedMs) && msgMs <= clearedMs) continue;
    }
    const lastReadIso = lastReadMap[msg.room_id];
    const cutoffMs = lastReadIso ? Date.parse(lastReadIso) : fallbackCutoffMs;
    if (msgMs > cutoffMs) {
      byRoom[msg.room_id] = (byRoom[msg.room_id] || 0) + 1;
      totalUnread += 1;
    }
  }

  return { totalUnread, byRoom };
}

/**
 * Mengirim pesan chat baru (grup ataupun DM personal) & menyiarkan notifikasi terukur.
 */
export async function sendChatMessage(
  session: SessionUser,
  input: SendChatMessageInput
): Promise<{ message: ChatMessage; savedRemote: boolean }> {
  const normalizedRoom = normalizeRoomId(input.room_id);
  if (!canAccessChatRoom(session, normalizedRoom)) {
    throw new Error('Anda tidak memiliki akses ke ruang percakapan ini.');
  }

  const cleanText = input.message.trim();
  if (!cleanText) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  if (cleanText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter.`);
  }

  const nowIso = new Date().toISOString();
  const messageId = createUuidSafe();
  const senderId = getChatParticipantId(session);
  const senderSubtitle = buildSenderSubtitle(session);

  let recipientId: string | null = input.recipient?.participant_id || null;
  if (!recipientId && isDmRoomId(normalizedRoom)) {
    const pair = parseDmParticipants(normalizedRoom);
    if (pair) {
      const myIds = getChatParticipantMatchIds(session);
      recipientId = myIds.has(normalizeChatParticipantId(pair[0])) ? pair[1] : pair[0];
    }
  }

  const nextMessage: ChatMessage = {
    id: messageId,
    room_id: normalizedRoom,
    sender_role: session.role,
    sender_id: senderId,
    sender_name: session.nama_warga || 'Pengguna',
    sender_subtitle: senderSubtitle,
    sender_avatar_url: session.avatar_url || null,
    recipient_id: recipientId,
    recipient_name: input.recipient?.display_name || null,
    recipient_role: input.recipient?.role || null,
    message: cleanText,
    reply_to_id: input.reply_to_id || null,
    reply_preview: input.reply_preview ? input.reply_preview.slice(0, 140) : null,
    created_at: nowIso,
    is_local_only: false,
    ...(input.attachment
      ? {
          attachment_type: input.attachment.attachment_type || 'none',
          attachment_name: input.attachment.attachment_name ?? null,
          attachment_mime: input.attachment.attachment_mime ?? null,
          attachment_size_bytes: input.attachment.attachment_size_bytes ?? null,
          attachment_storage_provider: input.attachment.attachment_storage_provider ?? null,
          attachment_drive_file_id: input.attachment.attachment_drive_file_id ?? null,
          attachment_drive_folder_path: input.attachment.attachment_drive_folder_path ?? null,
          attachment_url: input.attachment.attachment_url ?? null,
          attachment_thumbnail_url: input.attachment.attachment_thumbnail_url ?? null,
          attachment_status: input.attachment.attachment_status ?? null,
          drive_permission_scope: input.attachment.drive_permission_scope ?? null,
          drive_web_view_link: input.attachment.drive_web_view_link ?? null,
          drive_thumbnail_link: input.attachment.drive_thumbnail_link ?? null,
        }
      : {}),
  };

  let savedRemote = false;
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const basePayload = {
        id: nextMessage.id,
        room_id: nextMessage.room_id,
        sender_role: nextMessage.sender_role,
        sender_id: nextMessage.sender_id,
        sender_name: nextMessage.sender_name,
        sender_subtitle: nextMessage.sender_subtitle,
        sender_avatar_url: nextMessage.sender_avatar_url,
        recipient_id: nextMessage.recipient_id,
        recipient_name: nextMessage.recipient_name,
        recipient_role: nextMessage.recipient_role,
        message: nextMessage.message,
        reply_to_id:
          nextMessage.reply_to_id && !nextMessage.reply_to_id.startsWith('chat-')
            ? nextMessage.reply_to_id
            : null,
        reply_preview: nextMessage.reply_preview,
        created_at: nextMessage.created_at,
      };

      const coreAttachmentPayload = input.attachment
        ? {
            ...basePayload,
            attachment_type: nextMessage.attachment_type || 'none',
            attachment_name: nextMessage.attachment_name ?? null,
            attachment_mime: nextMessage.attachment_mime ?? null,
            attachment_size_bytes: nextMessage.attachment_size_bytes ?? null,
            attachment_drive_file_id: nextMessage.attachment_drive_file_id ?? null,
            attachment_url: nextMessage.attachment_url ?? null,
          }
        : basePayload;

      const attachmentOnlyPayload = input.attachment
        ? {
            ...coreAttachmentPayload,
            attachment_storage_provider: nextMessage.attachment_storage_provider ?? null,
            attachment_drive_folder_path: nextMessage.attachment_drive_folder_path ?? null,
            attachment_thumbnail_url: nextMessage.attachment_thumbnail_url ?? null,
            attachment_status: nextMessage.attachment_status ?? null,
          }
        : basePayload;

      const payloadWithAttachment = input.attachment
        ? {
            ...attachmentOnlyPayload,
            ...(nextMessage.drive_permission_scope
              ? { drive_permission_scope: nextMessage.drive_permission_scope }
              : {}),
            ...(nextMessage.drive_web_view_link !== undefined
              ? { drive_web_view_link: nextMessage.drive_web_view_link }
              : {}),
            ...(nextMessage.drive_thumbnail_link !== undefined
              ? { drive_thumbnail_link: nextMessage.drive_thumbnail_link }
              : {}),
          }
        : basePayload;

      let { error } = await supabase.from('community_chat_messages').insert(payloadWithAttachment);

      // Kompatibilitas bila kolom drive_* (v18), sebagian kolom attachment_* (v17), atau recipient_* (v14) belum dibuat
      if (
        error &&
        (String(error.message || '').toLowerCase().includes('drive_') ||
          error.code === '42703' ||
          error.code === 'PGRST204')
      ) {
        const retryAttach = await supabase.from('community_chat_messages').insert(attachmentOnlyPayload);
        error = retryAttach.error;
      }

      if (
        error &&
        input.attachment &&
        (String(error.message || '').toLowerCase().includes('attachment_') ||
          error.code === '42703' ||
          error.code === 'PGRST204')
      ) {
        const retryCoreAttach = await supabase.from('community_chat_messages').insert(coreAttachmentPayload);
        error = retryCoreAttach.error;
      }

      if (
        error &&
        (String(error.message || '').toLowerCase().includes('attachment_') ||
          error.code === '42703' ||
          error.code === 'PGRST204')
      ) {
        const retryRecipient = await supabase.from('community_chat_messages').insert(basePayload);
        error = retryRecipient.error;
      }

      if (
        error &&
        (String(error.message || '').toLowerCase().includes('recipient_') ||
          error.code === '42703' ||
          error.code === 'PGRST204')
      ) {
        const fallbackPayload = {
          id: nextMessage.id,
          room_id: nextMessage.room_id,
          sender_role: nextMessage.sender_role,
          sender_id: nextMessage.sender_id,
          sender_name: nextMessage.sender_name,
          sender_subtitle: nextMessage.sender_subtitle,
          sender_avatar_url: nextMessage.sender_avatar_url,
          message: nextMessage.message,
          reply_to_id: basePayload.reply_to_id,
          reply_preview: nextMessage.reply_preview,
          created_at: nextMessage.created_at,
        };
        const retry = await supabase.from('community_chat_messages').insert(fallbackPayload);
        error = retry.error;
      }

      if (!error) {
        savedRemote = true;
      }
    } catch {
      // Fallback lokal bila tabel belum dimigrasi
    }
  }

  if (input.attachment) {
    rememberLocalSentAttachment(nextMessage);
  }

  if (!savedRemote) {
    nextMessage.is_local_only = true;
    const local = readLocalMessages();
    if (!local.some((m) => m.id === nextMessage.id)) {
      writeLocalMessages([...local, nextMessage]);
    }
  }

  markChatRoomRead(session, normalizedRoom, nowIso);
  emitChatChanged({ type: 'insert', room_id: normalizedRoom, message: nextMessage });

  // Kirim notifikasi lonceng secara terukur
  const snippet = cleanText.length > 90 ? `${cleanText.slice(0, 87)}...` : cleanText;
  const dedupKey = `chat:${nextMessage.id}`;
  const recipientItems: Array<{
    user_id: string;
    category: 'system';
    title: string;
    message: string;
    target_url: string;
    dedup_key: string;
  }> = [];

  if (isDmRoomId(normalizedRoom) && recipientId) {
    const dmTitle = `Pesan Pribadi · ${nextMessage.sender_name}`;
    const dmMsg = `${senderSubtitle}: ${snippet}`;
    const targetUrl = `chat:${normalizedRoom}`;
    recipientItems.push({
      user_id: recipientId,
      category: 'system',
      title: dmTitle,
      message: dmMsg,
      target_url: targetUrl,
      dedup_key: `${dedupKey}:dm`,
    });
  } else {
    const roomMeta = CHAT_ROOMS.find((r) => r.id === normalizedRoom);
    const allowedRoles = new Set<UserRole>(roomMeta?.allowedRoles || []);
    const roomTitle = roomMeta?.label || 'Chat Lingkungan';
    const notifTitle = `Pesan Baru · ${roomTitle}`;
    const notifMsg = `${nextMessage.sender_name} (${senderSubtitle}): ${snippet}`;
    const targetUrl = `chat:${normalizedRoom}`;

    // Notifikasi ke Pengurus hanya jika role 'admin' termasuk anggota sah grup ini
    if (allowedRoles.has('admin')) {
      const myAdminId = session.role === 'admin' ? getChatParticipantId(session) : '';
      for (const adminUid of getAllAdminUserIds()) {
        if (myAdminId && normalizeChatParticipantId(adminUid) === myAdminId) continue;
        recipientItems.push({
          user_id: adminUid,
          category: 'system',
          title: notifTitle,
          message: notifMsg,
          target_url: targetUrl,
          dedup_key: dedupKey,
        });
      }
    }

    if (allowedRoles.has('warga') && session.role !== 'warga') {
      recipientItems.push({
        user_id: 'broadcast:warga',
        category: 'system',
        title: notifTitle,
        message: notifMsg,
        target_url: targetUrl,
        dedup_key: `${dedupKey}:warga`,
      });
    }

    if (allowedRoles.has('petugas') && session.role !== 'petugas') {
      recipientItems.push({
        user_id: 'broadcast:petugas',
        category: 'system',
        title: notifTitle,
        message: notifMsg,
        target_url: targetUrl,
        dedup_key: `${dedupKey}:petugas`,
      });
    }
  }

  if (recipientItems.length > 0) {
    void dispatchActivityNotifications(session, recipientItems);
  }

  return { message: nextMessage, savedRemote };
}

/**
 * Mengedit isi pesan milik pengguna aktif sambil menjaga transparansi di grup:
 * - Hanya pengirim asli yang boleh mengubah isi pesannya sendiri.
 * - `original_content` menyimpan isi pesan asli pertama kali sebelum diedit dan tidak ditimpa ulang.
 */
export async function editChatMessage(
  session: SessionUser,
  msg: ChatMessage,
  newMessageText: string
): Promise<{ message: ChatMessage; savedRemote: boolean }> {
  const normalizedRoom = normalizeRoomId(msg.room_id);
  if (!canAccessChatRoom(session, normalizedRoom)) {
    throw new Error('Anda tidak memiliki akses ke ruang percakapan ini.');
  }

  const myIds = getChatParticipantMatchIds(session);
  const isOwner =
    myIds.has(normalizeChatParticipantId(msg.sender_id)) || myIds.has(msg.sender_id);
  if (!isOwner) {
    throw new Error('Anda hanya dapat mengedit pesan yang Anda kirim sendiri.');
  }

  const cleanText = newMessageText.trim();
  if (!cleanText) {
    throw new Error('Pesan tidak boleh kosong.');
  }
  if (cleanText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter.`);
  }

  if (cleanText === msg.message) {
    return { message: msg, savedRemote: !msg.is_local_only };
  }

  const preservedOriginalContent =
    msg.is_edited && typeof msg.original_content === 'string' && msg.original_content.length > 0
      ? msg.original_content
      : msg.message;
  const editedAtIso = new Date().toISOString();

  let savedRemote = false;
  let resolvedMessageText = cleanText;
  let resolvedIsEdited = true;
  let resolvedOriginalContent = preservedOriginalContent;
  let resolvedEditedAt = editedAtIso;

  const supabase = getSupabaseClient(session);
  if (
    supabase &&
    isSupabaseConfigured() &&
    !msg.is_local_only &&
    !msg.id.startsWith('chat-') &&
    !msg.id.startsWith('optimistic-')
  ) {
    const rpcRes = await supabase.rpc('edit_chat_message', {
      p_message_id: msg.id,
      p_new_message: cleanText,
    });

    if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
      const dataObj = rpcRes.data as Record<string, unknown>;
      if (typeof dataObj.message === 'string' && dataObj.message.trim()) {
        resolvedMessageText = dataObj.message;
      }
      resolvedIsEdited = Boolean(dataObj.is_edited ?? true);
      if (typeof dataObj.original_content === 'string') {
        resolvedOriginalContent = dataObj.original_content;
      }
      if (typeof dataObj.edited_at === 'string' && dataObj.edited_at.trim()) {
        resolvedEditedAt = dataObj.edited_at.trim();
      }
      savedRemote = true;
    } else if (rpcRes.error) {
      const errMsg = String(rpcRes.error.message || '').toLowerCase();
      const isMissingRpc =
        rpcRes.error.code === '42883' ||
        rpcRes.error.code === 'PGRST202' ||
        errMsg.includes('edit_chat_message');

      if (isMissingRpc) {
        const directRes = await supabase
          .from('community_chat_messages')
          .update({
            message: cleanText,
            is_edited: true,
            original_content: preservedOriginalContent,
            edited_at: editedAtIso,
          })
          .eq('id', msg.id)
          .select('*')
          .maybeSingle();

        if (directRes.error) {
          throw new Error(
            'Fitur edit pesan memerlukan pembaruan database (migrasi v20).'
          );
        }
        if (directRes.data) {
          const normalized = normalizeChatRow(directRes.data as Record<string, unknown>);
          resolvedMessageText = normalized.message;
          resolvedIsEdited = Boolean(normalized.is_edited);
          resolvedOriginalContent = normalized.original_content ?? preservedOriginalContent;
          resolvedEditedAt = normalized.edited_at ?? editedAtIso;
        }
        savedRemote = true;
      } else {
        throw new Error(rpcRes.error.message || 'Gagal menyimpan perubahan pesan di server.');
      }
    }
  }

  const updatedMessage: ChatMessage = {
    ...msg,
    room_id: normalizedRoom,
    message: resolvedMessageText,
    is_edited: resolvedIsEdited,
    original_content: resolvedOriginalContent,
    edited_at: resolvedEditedAt,
  };

  if (recentSentAttachmentsById.has(updatedMessage.id)) {
    rememberLocalSentAttachment(updatedMessage);
  }

  const localMsgs = readLocalMessages();
  if (localMsgs.some((item) => item.id === updatedMessage.id)) {
    writeLocalMessages(
      localMsgs.map((item) => (item.id === updatedMessage.id ? updatedMessage : item))
    );
  }

  emitChatChanged({ type: 'update', room_id: normalizedRoom, message: updatedMessage });
  return { message: updatedMessage, savedRemote };
}

/**
 * Menghapus pesan/gambar KHUSUS UNTUK PENGGUNA AKTIF ("Hapus untuk Saya", perilaku WhatsApp Group):
 * - TIDAK menghapus baris pesan di database dan TIDAK menghapus berkas asli di Google Drive.
 * - Hanya menambahkan identitas kanonik pengguna aktif ke array `hidden_for`.
 * - Anggota lain (dan lawan bicara di DM) tetap melihat pesan & gambar secara utuh.
 */
export async function hideChatMessageForMe(
  session: SessionUser,
  msg: Pick<ChatMessage, 'id' | 'room_id' | 'is_local_only'>
): Promise<{ hiddenRemote: boolean }> {
  const normalizedRoom = normalizeRoomId(msg.room_id);
  if (!canAccessChatRoom(session, normalizedRoom)) {
    throw new Error('Anda tidak memiliki akses ke ruang percakapan ini.');
  }

  rememberLocalHiddenMessageId(session, msg.id);

  let hiddenRemote = false;
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !msg.is_local_only && !msg.id.startsWith('chat-')) {
    try {
      const { error } = await supabase.rpc('hide_chat_message_for_me', {
        p_message_id: msg.id,
      });
      if (!error) {
        hiddenRemote = true;
      } else {
        const errMsg = String(error.message || '').toLowerCase();
        const isMissingMigration =
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          errMsg.includes('hide_chat_message_for_me') ||
          errMsg.includes('hidden_for');
        if (!isMissingMigration) {
          throw new Error(error.message || 'Gagal menyembunyikan pesan di server.');
        }
      }
    } catch (err) {
      if (err instanceof Error && !/hide_chat_message_for_me|hidden_for/i.test(err.message)) {
        throw err;
      }
    }
  }

  emitChatChanged({ type: 'hide', room_id: normalizedRoom, deletedId: msg.id });
  return { hiddenRemote };
}

/**
 * Menghapus pesan chat UNTUK SEMUA PESERTA ("Hapus untuk Semua"):
 * hanya untuk pengirim asli pesan atau Pengurus/Admin aktif.
 */
export async function deleteChatMessageForEveryone(
  session: SessionUser,
  msg: Pick<ChatMessage, 'id' | 'room_id' | 'sender_id' | 'is_local_only'>
): Promise<void> {
  const myIds = getChatParticipantMatchIds(session);
  const canDelete =
    session.role === 'admin' ||
    myIds.has(normalizeChatParticipantId(msg.sender_id)) ||
    myIds.has(msg.sender_id);
  if (!canDelete) {
    throw new Error('Anda hanya dapat menghapus pesan Anda sendiri untuk semua peserta.');
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !msg.is_local_only && !msg.id.startsWith('chat-')) {
    const rpcRes = await supabase.rpc('delete_chat_message_for_everyone', {
      p_message_id: msg.id,
    });
    if (rpcRes.error) {
      const errMsg = String(rpcRes.error.message || '').toLowerCase();
      const isMissingRpc =
        rpcRes.error.code === '42883' ||
        rpcRes.error.code === 'PGRST202' ||
        errMsg.includes('delete_chat_message_for_everyone');
      if (isMissingRpc) {
        const { error } = await supabase.from('community_chat_messages').delete().eq('id', msg.id);
        if (error) {
          throw new Error(error.message || 'Gagal menghapus pesan di server.');
        }
      } else {
        throw new Error(rpcRes.error.message || 'Gagal menghapus pesan di server.');
      }
    }
  }

  const remaining = readLocalMessages().filter((item) => item.id !== msg.id);
  writeLocalMessages(remaining);
  emitChatChanged({ type: 'delete', room_id: msg.room_id, deletedId: msg.id });
}

/**
 * Alias kompatibilitas mundur untuk penghapusan pesan untuk semua peserta.
 */
export async function deleteChatMessage(
  session: SessionUser,
  msg: Pick<ChatMessage, 'id' | 'room_id' | 'sender_id' | 'is_local_only'>
): Promise<void> {
  await deleteChatMessageForEveryone(session, msg);
}

/**
 * Membersihkan riwayat chat pada ruang Individu (DM) maupun Group:
 * - mode 'local': menyembunyikan seluruh pesan hingga saat ini untuk pengguna aktif.
 * - mode 'server': khusus Admin/Pengurus, menghapus permanen seluruh pesan ruang di database & lokal.
 */
export async function clearChatRoom(
  session: SessionUser,
  roomId: ChatRoomId,
  options?: { mode?: 'local' | 'server'; latestMessageIso?: string }
): Promise<{ clearedRemote: boolean }> {
  const normalizedRoom = normalizeRoomId(roomId);
  if (!canAccessChatRoom(session, normalizedRoom)) {
    throw new Error('Anda tidak memiliki akses ke ruang percakapan ini.');
  }

  const mode = options?.mode === 'server' ? 'server' : 'local';
  if (mode === 'server' && session.role !== 'admin') {
    throw new Error('Hanya Pengurus yang dapat menghapus permanen isi percakapan di server.');
  }

  const latestMs = options?.latestMessageIso ? Date.parse(options.latestMessageIso) : 0;
  const cutoffMs = Math.max(Date.now(), Number.isNaN(latestMs) ? 0 : latestMs) + 1;
  const cutoffIso = new Date(cutoffMs).toISOString();

  let clearedRemote = false;
  if (mode === 'server') {
    const supabase = getSupabaseClient(session);
    if (supabase && isSupabaseConfigured()) {
      const { error } = await supabase
        .from('community_chat_messages')
        .delete()
        .eq('room_id', normalizedRoom);
      if (error) {
        throw new Error(error.message || 'Gagal membersihkan pesan di server.');
      }
      clearedRemote = true;
    }
    const remaining = readLocalMessages().filter(
      (item) => normalizeRoomId(item.room_id) !== normalizedRoom
    );
    writeLocalMessages(remaining);
  }

  try {
    if (typeof window !== 'undefined') {
      const current = readClearedMap(session);
      current[normalizedRoom] = cutoffIso;
      window.localStorage.setItem(getChatClearedStorageKey(session), JSON.stringify(current));
    }
  } catch {
    // Abaikan kuota storage
  }

  markChatRoomRead(session, normalizedRoom, cutoffIso);
  emitChatChanged({ type: 'clear', room_id: normalizedRoom });
  return { clearedRemote };
}

const recentSentAttachmentsById = new Map<string, ChatMessage>();

function rememberLocalSentAttachment(msg: ChatMessage): void {
  if (!msg.id) return;
  if (recentSentAttachmentsById.has(msg.id)) {
    recentSentAttachmentsById.delete(msg.id);
  }
  recentSentAttachmentsById.set(msg.id, msg);
  while (recentSentAttachmentsById.size > 100) {
    const oldest = recentSentAttachmentsById.keys().next().value;
    if (!oldest) break;
    recentSentAttachmentsById.delete(oldest);
  }
}

function mergeAttachmentFallback(base: ChatMessage, fallback: ChatMessage): ChatMessage {
  const combinedHidden = normalizeHiddenForList([
    ...(Array.isArray(base.hidden_for) ? base.hidden_for : []),
    ...(Array.isArray(fallback.hidden_for) ? fallback.hidden_for : []),
  ]);
  return {
    ...base,
    attachment_type:
      base.attachment_type && base.attachment_type !== 'none'
        ? base.attachment_type
        : fallback.attachment_type,
    attachment_name: base.attachment_name || fallback.attachment_name || null,
    attachment_mime: base.attachment_mime || fallback.attachment_mime || null,
    attachment_size_bytes: base.attachment_size_bytes || fallback.attachment_size_bytes || null,
    attachment_storage_provider:
      base.attachment_storage_provider || fallback.attachment_storage_provider || null,
    attachment_drive_file_id:
      base.attachment_drive_file_id || fallback.attachment_drive_file_id || null,
    attachment_drive_folder_path:
      base.attachment_drive_folder_path || fallback.attachment_drive_folder_path || null,
    attachment_url: base.attachment_url || fallback.attachment_url || null,
    attachment_thumbnail_url:
      base.attachment_thumbnail_url || fallback.attachment_thumbnail_url || null,
    attachment_status: base.attachment_status || fallback.attachment_status || null,
    drive_permission_scope:
      base.drive_permission_scope || fallback.drive_permission_scope || null,
    drive_web_view_link: base.drive_web_view_link || fallback.drive_web_view_link || null,
    drive_thumbnail_link: base.drive_thumbnail_link || fallback.drive_thumbnail_link || null,
    hidden_for: combinedHidden,
  };
}

function needsRealtimeAttachmentHydration(
  rawRow: Record<string, unknown>,
  normalized: ChatMessage,
  isUpdateEvent = false
): boolean {
  if (!rawRow.room_id || !rawRow.message) return true;
  if (isUpdateEvent && (!('hidden_for' in rawRow) || !('is_edited' in rawRow))) return true;
  if (
    normalized.attachment_status === 'pending_transfer' ||
    normalized.attachment_status === 'uploading_video'
  ) {
    return true;
  }
  if (
    normalized.attachment_type &&
    normalized.attachment_type !== 'none' &&
    !normalized.attachment_drive_file_id &&
    !normalized.attachment_url
  ) {
    return true;
  }
  const trimmedMsg = normalized.message.trim();
  const looksLikeAttachmentPlaceholder =
    /^\[(foto|video|dokumen|file)\]\s+/i.test(trimmedMsg) ||
    /\.(png|jpe?g|webp|gif|heic|heif|bmp|pdf|mp4|mov)$/i.test(trimmedMsg);
  if (
    looksLikeAttachmentPlaceholder &&
    (!normalized.attachment_drive_file_id ||
      !normalized.attachment_mime ||
      !normalized.attachment_url)
  ) {
    return true;
  }
  return false;
}

/**
 * Subscription real-time Supabase Postgres Changes + sinkronisasi lintas tab lokal.
 */
export function subscribeChatMessagesRealtime(
  session: SessionUser,
  callbacks: {
    onInsert?: (msg: ChatMessage) => void;
    onUpdate?: (msg: ChatMessage) => void;
    onDelete?: (deletedId: string) => void;
    onClear?: (roomId: ChatRoomId) => void;
    onAnyChange?: () => void;
  }
): () => void {
  const cleanups: Array<() => void> = [];

  if (typeof window !== 'undefined') {
    const onLocal = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          type?: 'insert' | 'update' | 'delete' | 'hide' | 'read' | 'clear';
          room_id?: ChatRoomId;
          message?: ChatMessage;
          deletedId?: string;
        }>
      ).detail;
      if (
        detail?.type === 'insert' &&
        detail.message &&
        canAccessChatRoom(session, detail.message.room_id) &&
        !isMessageHiddenForSession(session, detail.message)
      ) {
        callbacks.onInsert?.(detail.message);
      } else if (
        detail?.type === 'update' &&
        detail.message &&
        canAccessChatRoom(session, detail.message.room_id)
      ) {
        if (isMessageHiddenForSession(session, detail.message)) {
          callbacks.onDelete?.(detail.message.id);
        } else if (callbacks.onUpdate) {
          callbacks.onUpdate(detail.message);
        } else {
          callbacks.onInsert?.(detail.message);
        }
      } else if ((detail?.type === 'delete' || detail?.type === 'hide') && detail.deletedId) {
        callbacks.onDelete?.(detail.deletedId);
      } else if (detail?.type === 'clear' && detail.room_id) {
        callbacks.onClear?.(detail.room_id);
      }
      callbacks.onAnyChange?.();
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === LOCAL_CHAT_MESSAGES_KEY ||
        e.key === getChatReadStorageKey(session) ||
        e.key === getChatClearedStorageKey(session) ||
        e.key === getChatHiddenStorageKey(session)
      ) {
        callbacks.onAnyChange?.();
      }
    };
    window.addEventListener(CHAT_CHANGED_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    cleanups.push(() => {
      window.removeEventListener(CHAT_CHANGED_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    });
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    let disposed = false;
    const hydrateRealtimeRow = async (
      rawRow: Record<string, unknown>,
      isUpdateEvent = false
    ): Promise<ChatMessage | null> => {
      let resolved = normalizeChatRow(rawRow);
      const cachedSent = resolved.id ? recentSentAttachmentsById.get(resolved.id) : undefined;
      if (cachedSent) {
        resolved = mergeAttachmentFallback(resolved, cachedSent);
      }
      if (needsRealtimeAttachmentHydration(rawRow, resolved, isUpdateEvent) && resolved.id) {
        const fetched = await fetchChatMessageById(session, resolved.id);
        if (fetched) {
          resolved = cachedSent ? mergeAttachmentFallback(fetched, cachedSent) : fetched;
        }
      }
      if (disposed || !canAccessChatRoom(session, resolved.room_id)) return null;
      return resolved;
    };

    try {
      const channel = supabase
        .channel(`community-chat-${session.role}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'community_chat_messages' },
          (payload) => {
            const row = payload.new as Record<string, unknown> | undefined;
            if (!row) return;
            void hydrateRealtimeRow(row, false).then((hydrated) => {
              if (!hydrated) return;
              if (isMessageHiddenForSession(session, hydrated)) {
                callbacks.onDelete?.(hydrated.id);
                callbacks.onAnyChange?.();
                return;
              }
              callbacks.onInsert?.(hydrated);
              callbacks.onAnyChange?.();
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'community_chat_messages' },
          (payload) => {
            const row = payload.new as Record<string, unknown> | undefined;
            if (!row) return;
            void hydrateRealtimeRow(row, true).then((hydrated) => {
              if (!hydrated) return;
              if (isMessageHiddenForSession(session, hydrated)) {
                callbacks.onDelete?.(hydrated.id);
                callbacks.onAnyChange?.();
                return;
              }
              if (callbacks.onUpdate) {
                callbacks.onUpdate(hydrated);
              } else {
                callbacks.onInsert?.(hydrated);
              }
              callbacks.onAnyChange?.();
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'community_chat_messages' },
          (payload) => {
            const oldRow = payload.old as Record<string, unknown> | undefined;
            const deletedId = oldRow?.id ? String(oldRow.id) : '';
            if (deletedId) {
              callbacks.onDelete?.(deletedId);
            }
            callbacks.onAnyChange?.();
          }
        )
        .subscribe();

      cleanups.push(() => {
        disposed = true;
        try {
          void supabase.removeChannel(channel);
        } catch {
          // Abaikan
        }
      });
    } catch {
      // Abaikan bila WebSocket dibatasi
    }
  }

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // Abaikan
      }
    });
  };
}

export interface ChatSessionSenderContext {
  role: UserRole;
  senderId: string;
  blokRumah: string;
  pengurusUsername: string;
  namaWarga: string;
  jabatan: string;
  adminPermission: string;
  petugasId: string;
  noWa?: string;
}

/**
 * Menormalkan sesi login aktif tanpa pernah melempar penolakan prematur di frontend
 * untuk akun Pengurus aktif (termasuk Bendahara maupun Pengurus yang memiliki blok terkait).
 */
export function normalizeChatSessionForUpload(session: SessionUser): SessionUser {
  const normalizedRole = normalizeChatUserRole(session.role);
  if (normalizedRole !== 'admin') {
    return {
      ...session,
      role: normalizedRole,
      blok_rumah: (session.blok_rumah || '').trim(),
    };
  }

  const rawBlok = (session.blok_rumah || '').trim();
  const byUsername = PENGURUS_BY_USERNAME.get(canonicalAdminUsername(rawBlok));
  const byBlok = rawBlok ? PENGURUS_BY_BLOK.get(canonicalBlockKey(rawBlok)) : undefined;
  const byJabatan =
    !byUsername && !byBlok && session.jabatan
      ? SUSUNAN_PENGURUS.find(
          (p) => normalizeToken(p.jabatan) === normalizeToken(session.jabatan)
        )
      : undefined;
  const matchedMeta = byUsername || byBlok || byJabatan;

  const resolvedUsername =
    matchedMeta?.username ||
    canonicalAdminUsername(rawBlok) ||
    (normalizeToken(session.jabatan) === 'bendahara' ? 'andriansyah' : '');
  const resolvedJabatan =
    session.jabatan ||
    matchedMeta?.jabatan ||
    (resolvedUsername === 'andriansyah' ? 'Bendahara' : undefined);
  const resolvedPermission =
    session.admin_permission ||
    matchedMeta?.permission ||
    (resolvedJabatan === 'Bendahara' || resolvedUsername === 'andriansyah'
      ? 'full'
      : 'add_only');

  return {
    ...session,
    role: 'admin',
    blok_rumah: rawBlok || resolvedUsername,
    nama_warga: (session.nama_warga || matchedMeta?.nama || 'Pengurus').trim(),
    jabatan: resolvedJabatan,
    admin_permission: resolvedPermission,
  };
}

/**
 * Membangun konteks pengirim yang konsisten untuk header & payload Edge Function `chat-media-transfer`
 * serta endpoint media Google Drive lainnya.
 */
export function buildChatSessionSenderContext(session: SessionUser): ChatSessionSenderContext {
  const safeSession = normalizeChatSessionForUpload(session);
  const role = normalizeChatUserRole(safeSession.role);
  const rawBlok = (safeSession.blok_rumah || '').trim();
  const pengurusUsername =
    role === 'admin'
      ? PENGURUS_BY_BLOK.get(canonicalBlockKey(rawBlok))?.username ||
        canonicalAdminUsername(rawBlok) ||
        (normalizeToken(safeSession.jabatan) === 'bendahara' ? 'andriansyah' : '')
      : '';

  return {
    role,
    senderId:
      role === 'admin' && pengurusUsername
        ? `admin:${pengurusUsername}`
        : getChatParticipantId(safeSession),
    blokRumah: role === 'admin' ? rawBlok || pengurusUsername : rawBlok,
    pengurusUsername,
    namaWarga: (safeSession.nama_warga || '').trim(),
    jabatan: (safeSession.jabatan || '').trim(),
    adminPermission: (safeSession.admin_permission || '').trim(),
    petugasId: (safeSession.petugas_id || '').trim(),
    noWa: (safeSession.no_wa || '').trim(),
  };
}

/**
 * Menghasilkan header identitas sesi yang konsisten dan aman CORS untuk Edge Function & API server.
 */
export function buildChatSessionHeaders(session: SessionUser): Record<string, string> {
  const ctx = buildChatSessionSenderContext(session);
  return {
    'x-user-role': ctx.role || 'anon',
    'x-blok-rumah': ctx.role === 'admin' ? ctx.pengurusUsername || ctx.blokRumah : ctx.blokRumah,
    'x-petugas-id': ctx.petugasId,
    'x-admin-permission': ctx.adminPermission,
    'x-admin-jabatan': ctx.jabatan,
  };
}

/**
 * Mengambil token Bearer aktif dari sesi autentikasi Supabase bila tersedia
 * (fallback aman ke `null` bila aplikasi memakai sesi PIN kustom tanpa JWT Supabase Auth).
 */
export async function resolveChatSupabaseAccessToken(
  session: SessionUser
): Promise<string | null> {
  const sessionToken = (session as SessionUser & { access_token?: unknown }).access_token;
  if (typeof sessionToken === 'string' && sessionToken.trim().split('.').length === 3) {
    return sessionToken.trim();
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return null;

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (typeof token === 'string' && token.trim().split('.').length === 3) {
      return token.trim();
    }
  } catch {
    // Abaikan jika sesi auth client tidak memakai Supabase Auth JWT
  }
  return null;
}

/**
 * Mengunggah satu lampiran chat melalui pipeline Modul 2 & Modul 3:
 * - Foto / Dokumen -> bucket transit `chat-transit` -> Google Drive -> hapus transit
 * - Semua Video -> Direct Google Drive Resumable Upload (tanpa transit Supabase)
 * Tidak melakukan penolakan status Pengurus secara prematur di frontend bila sesi login aktif tersedia.
 */
export async function uploadChatAttachmentViaService(
  params: UploadChatAttachmentParams
): Promise<ChatMediaUploadResult> {
  const safeSession = normalizeChatSessionForUpload(params.session);
  const { uploadChatAttachment } = await import('./chatMediaUpload');
  return uploadChatAttachment({
    ...params,
    session: safeSession,
  });
}

/**
 * Membuat item antrean unggah awal untuk komponen UploadProgress.
 */
export function createChatUploadQueueItem(params: {
  roomId: ChatRoomId;
  file: File;
  pickerKind: AttachmentPickerKind;
  attachmentType: Exclude<ChatAttachmentType, 'none'>;
  localPreviewUrl?: string | null;
}): UploadQueueItem {
  const localId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    localId,
    roomId: params.roomId,
    file: params.file,
    pickerKind: params.pickerKind,
    attachmentType: params.attachmentType,
    localPreviewUrl: params.localPreviewUrl ?? null,
    status: 'uploading',
    percent: 1,
    phase: params.attachmentType === 'video' ? 'initializing_video_session' : 'preparing',
    phaseLabel:
      params.attachmentType === 'video'
        ? 'Menyiapkan unggahan video...'
        : 'Menyiapkan berkas...',
    bytesUploaded: 0,
    totalBytes: params.file.size,
    error: null,
    errorDetails: null,
    abortController: new AbortController(),
    result: null,
  };
}

/**
 * Menjalankan proses unggah untuk satu UploadQueueItem dan menyalurkan pembaruan progres 0%-100%.
 */
export async function executeChatUploadQueueItem(params: {
  session: SessionUser;
  item: UploadQueueItem;
  onPatchItem: (localId: string, updater: (prev: UploadQueueItem) => UploadQueueItem) => void;
  onAborted?: (localId: string) => void;
}): Promise<ChatMediaUploadResult | null> {
  const { session, item, onPatchItem, onAborted } = params;

  try {
    const result = await uploadChatAttachmentViaService({
      session,
      roomId: item.roomId,
      file: item.file,
      signal: item.abortController.signal,
      onProgress: (progress: ChatMediaUploadProgress) => {
        onPatchItem(item.localId, (prev) => ({
          ...prev,
          percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
          phase: progress.phase,
          phaseLabel: progress.label,
          bytesUploaded: progress.bytesUploaded,
          totalBytes: progress.totalBytes,
        }));
      },
    });

    onPatchItem(item.localId, (prev) => ({
      ...prev,
      status: 'completed',
      percent: 100,
      phase: 'completed',
      phaseLabel: 'Lampiran siap dikirim.',
      bytesUploaded: prev.totalBytes,
      error: null,
      errorDetails: null,
      result,
    }));

    return result;
  } catch (err) {
    if (
      item.abortController.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      onAborted?.(item.localId);
      return null;
    }

    const message =
      err instanceof Error ? err.message : 'Gagal mengunggah lampiran.';
    const errorDetails = extractUploadErrorDetails(err);
    onPatchItem(item.localId, (prev) => ({
      ...prev,
      status: 'failed',
      phase: 'failed',
      phaseLabel: 'Unggahan gagal',
      error: message,
      errorDetails,
    }));
    return null;
  }
}

/**
 * Membatalkan unggahan aktif pada item antrean.
 */
export function cancelChatUploadQueueItem(item?: UploadQueueItem | null): void {
  if (!item) return;
  if (!item.abortController.signal.aborted) {
    item.abortController.abort();
  }
}

/**
 * Menyiapkan ulang item unggah yang gagal dengan AbortController baru.
 */
export function createRetryChatUploadQueueItem(item: UploadQueueItem): UploadQueueItem {
  return {
    ...item,
    status: 'uploading',
    percent: 1,
    phase: item.attachmentType === 'video' ? 'initializing_video_session' : 'preparing',
    phaseLabel: 'Mengulang unggahan...',
    bytesUploaded: 0,
    error: null,
    errorDetails: null,
    abortController: new AbortController(),
    result: null,
  };
}

/**
 * Mengirim pesan chat beserta lampiran yang telah selesai diunggah ke Google Drive.
 */
export async function sendChatMessagesWithUploadedAttachments(params: {
  session: SessionUser;
  roomId: ChatRoomId;
  items: UploadQueueItem[];
  caption?: string;
  replyToId?: string | null;
  replyPreview?: string | null;
  recipient?: Pick<ChatContact, 'participant_id' | 'display_name' | 'role'> | null;
  onMessageSent?: (message: ChatMessage, localId: string) => void;
}): Promise<{ messages: ChatMessage[]; sentLocalIds: string[] }> {
  const cleanCaption = (params.caption || '').trim();
  const readyItems = params.items.filter(
    (item) => item.status === 'completed' && item.result !== null
  );
  const messages: ChatMessage[] = [];
  const sentLocalIds: string[] = [];

  for (let idx = 0; idx < readyItems.length; idx += 1) {
    const item = readyItems[idx];
    const upload = item.result;
    if (!upload) continue;

    const fallbackLabel =
      upload.attachmentType === 'video'
        ? `[Video] ${upload.fileName}`
        : upload.attachmentType === 'photo'
          ? `[Foto] ${upload.fileName}`
          : `[Dokumen] ${upload.fileName}`;

    const messageBody = idx === 0 && cleanCaption ? cleanCaption : fallbackLabel;
    const { message } = await sendChatMessage(params.session, {
      room_id: params.roomId,
      message: messageBody,
      reply_to_id: idx === 0 ? params.replyToId : null,
      reply_preview: idx === 0 ? params.replyPreview : null,
      recipient: params.recipient,
      attachment: {
        attachment_type: upload.attachmentType,
        attachment_name: upload.fileName,
        attachment_mime: upload.mimeType,
        attachment_size_bytes: upload.sizeBytes,
        attachment_storage_provider: 'google_drive',
        attachment_drive_file_id: upload.driveFileId,
        attachment_drive_folder_path: upload.folderPath,
        attachment_url: upload.attachmentUrl,
        attachment_thumbnail_url: upload.thumbnailUrl,
        attachment_status: 'ready',
        drive_permission_scope: upload.drivePermissionScope || null,
        drive_web_view_link: upload.driveWebViewLink ?? upload.webViewLink ?? null,
        drive_thumbnail_link: upload.driveThumbnailLink ?? null,
      },
    });

    messages.push(message);
    sentLocalIds.push(item.localId);
    params.onMessageSent?.(message, item.localId);
  }

  return { messages, sentLocalIds };
}

export interface TypingIndicatorUser {
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderBadge: string;
  updatedAt: number;
}

const TYPING_BROADCAST_THROTTLE_MS = 1500;
const TYPING_EXPIRE_MS = 4000;

function formatTypingSenderBadge(session: SessionUser): string {
  const role = normalizeChatUserRole(session.role);
  if (role === 'admin') {
    return (session.jabatan || 'Pengurus').trim();
  }
  if (role === 'petugas') {
    return 'Keamanan';
  }
  const cleanBlok = formatBlokRumah(session.blok_rumah) || (session.blok_rumah || '').trim();
  return cleanBlok ? `Blok ${cleanBlok}` : 'Warga';
}

/**
 * Mengelola indikator real-time "Sedang Mengetik..." per ruang obrolan via Supabase Realtime Broadcast
 * (ephemeral murni lewat WebSocket tanpa menulis apa pun ke database).
 */
export function subscribeChatTypingRoom(
  session: SessionUser,
  roomId: ChatRoomId,
  onTypingUsersChange: (users: TypingIndicatorUser[]) => void
): {
  sendTyping: (isTyping: boolean) => void;
  unsubscribe: () => void;
} {
  const normalizedRoom = normalizeRoomId(roomId);
  const myCtx = buildChatSessionSenderContext(session);
  const myIds = getChatParticipantMatchIds(session);
  const myBadge = formatTypingSenderBadge(session);
  const myName = (session.nama_warga || myCtx.namaWarga || 'Pengguna').trim();

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured() || !canAccessChatRoom(session, normalizedRoom)) {
    onTypingUsersChange([]);
    return {
      sendTyping: () => undefined,
      unsubscribe: () => undefined,
    };
  }

  let disposed = false;
  let lastTypingSentAt = 0;
  let lastBroadcastWasTyping = false;
  const activeTypers = new Map<string, TypingIndicatorUser>();

  const emitActiveTypers = () => {
    if (disposed) return;
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of Array.from(activeTypers.entries())) {
      if (now - entry.updatedAt > TYPING_EXPIRE_MS) {
        activeTypers.delete(key);
        changed = true;
      }
    }
    const sorted = Array.from(activeTypers.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    if (changed || sorted.length >= 0) {
      onTypingUsersChange(sorted);
    }
  };

  const expireTimer = setInterval(() => {
    if (disposed || activeTypers.size === 0) return;
    const now = Date.now();
    let expired = false;
    for (const [key, entry] of Array.from(activeTypers.entries())) {
      if (now - entry.updatedAt > TYPING_EXPIRE_MS) {
        activeTypers.delete(key);
        expired = true;
      }
    }
    if (expired) {
      const sorted = Array.from(activeTypers.values()).sort((a, b) => a.updatedAt - b.updatedAt);
      onTypingUsersChange(sorted);
    }
  }, 1000);

  let channelSubscribed = false;
  const channel = supabase
    .channel(`typing:${normalizedRoom}`, {
      config: {
        broadcast: { self: false },
      },
    })
    .on('broadcast', { event: 'typing' }, (msg) => {
      if (disposed) return;
      const payload = (msg?.payload || {}) as Record<string, unknown>;
      const senderId = String(payload.senderId || '').trim();
      if (!senderId) return;
      const normSenderId = normalizeChatParticipantId(senderId);
      if (senderId === myCtx.senderId || myIds.has(senderId) || myIds.has(normSenderId)) {
        return;
      }

      const isTyping = Boolean(payload.isTyping);
      const mapKey = normSenderId || senderId;
      if (!isTyping) {
        if (activeTypers.delete(mapKey)) {
          emitActiveTypers();
        }
        return;
      }

      const senderName = String(payload.senderName || 'Pengguna').trim() || 'Pengguna';
      const senderRole = normalizeSenderRole(payload.senderRole);
      const senderBadge = String(payload.senderBadge || '').trim();

      activeTypers.set(mapKey, {
        senderId: mapKey,
        senderName,
        senderRole,
        senderBadge,
        updatedAt: Date.now(),
      });
      emitActiveTypers();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channelSubscribed = true;
      }
    });

  const sendTyping = (isTyping: boolean) => {
    if (disposed || !channelSubscribed) return;
    const now = Date.now();
    if (isTyping) {
      if (lastBroadcastWasTyping && now - lastTypingSentAt < TYPING_BROADCAST_THROTTLE_MS) {
        return;
      }
      lastTypingSentAt = now;
      lastBroadcastWasTyping = true;
    } else {
      if (!lastBroadcastWasTyping) return;
      lastBroadcastWasTyping = false;
      lastTypingSentAt = 0;
    }

    void channel
      .send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          roomId: normalizedRoom,
          senderId: myCtx.senderId,
          senderName: myName,
          senderRole: myCtx.role,
          senderBadge: myBadge,
          isTyping,
          sentAt: now,
        },
      })
      .catch(() => undefined);
  };

  return {
    sendTyping,
    unsubscribe: () => {
      if (disposed) return;
      if (lastBroadcastWasTyping && channelSubscribed) {
        lastBroadcastWasTyping = false;
        void channel
          .send({
            type: 'broadcast',
            event: 'typing',
            payload: {
              roomId: normalizedRoom,
              senderId: myCtx.senderId,
              senderName: myName,
              senderRole: myCtx.role,
              senderBadge: myBadge,
              isTyping: false,
              sentAt: Date.now(),
            },
          })
          .catch(() => undefined);
      }
      disposed = true;
      clearInterval(expireTimer);
      activeTypers.clear();
      try {
        void supabase.removeChannel(channel);
      } catch {
        // Abaikan
      }
    },
  };
}


