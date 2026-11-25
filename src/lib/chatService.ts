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
import { canonicalBlockKey } from './phoneAndBlockUtils';
import { SEED_WARGA } from './seedData';

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
}

export interface SendChatMessageInput {
  room_id: ChatRoomId;
  message: string;
  reply_to_id?: string | null;
  reply_preview?: string | null;
  recipient?: Pick<ChatContact, 'participant_id' | 'display_name' | 'role'> | null;
}

const LOCAL_CHAT_MESSAGES_KEY = 'ecard_community_chat_messages_v1';
const LOCAL_CHAT_READ_PREFIX = 'ecard_community_chat_read_v1:';
const LOCAL_CHAT_CLEARED_PREFIX = 'ecard_community_chat_cleared_v1:';
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
    accentClass: 'from-[#4C1D95] to-[#7C3AED]',
    allowedRoles: ['admin'],
  },
  {
    id: 'pengurus_keamanan',
    label: 'Grup Pengurus & Keamanan',
    shortLabel: 'Pengurus & Keamanan',
    description: 'Khusus Pengurus dan Petugas Keamanan / Patroli (koordinasi pos & patroli NFC)',
    participantsLabel: 'Hanya Pengurus & Keamanan',
    accentClass: 'from-amber-600 to-orange-600',
    allowedRoles: ['admin', 'petugas'],
  },
  {
    id: 'pengurus_warga',
    label: 'Grup Pengurus & Warga',
    shortLabel: 'Pengurus & Warga',
    description: 'Khusus Pengurus dan Warga (iuran IPL, pengumuman & aspirasi lingkungan)',
    participantsLabel: 'Hanya Pengurus & Warga',
    accentClass: 'from-[#3730A3] to-[#6D28D9]',
    allowedRoles: ['admin', 'warga'],
  },
  {
    id: 'warga_keamanan',
    label: 'Grup Warga & Keamanan',
    shortLabel: 'Warga & Keamanan',
    description: 'Khusus Warga dan Petugas Keamanan (laporan tamu, gerbang & bantuan darurat)',
    participantsLabel: 'Hanya Warga & Keamanan',
    accentClass: 'from-emerald-600 to-teal-600',
    allowedRoles: ['warga', 'petugas'],
  },
  {
    id: 'forum_umum',
    label: 'Forum Lingkungan',
    shortLabel: 'Forum',
    description: 'Forum bersama Pengurus, Warga & Keamanan Perumahan Saung Kebun',
    participantsLabel: 'Pengurus · Warga · Keamanan',
    accentClass: 'from-[#312E81] to-[#0284C7]',
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
  if (clean === 'admin' || clean === 'andriansyah') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan') return 'bpiwan';
  return clean;
}

const PENGURUS_BY_USERNAME = new Map(
  SUSUNAN_PENGURUS.map((p) => [canonicalAdminUsername(p.username), p])
);

/**
 * Menghasilkan ID kanonik peserta chat yang konsisten di Client & RLS SQL.
 * Khusus Warga, B03/07 dan B3/7 dinormalisasi menjadi `warga:b3/7`.
 * Khusus Admin, alias `admin` -> `andriansyah` dan `paiwan` -> `bpiwan`.
 */
export function getChatParticipantId(session?: SessionUser | null): string {
  if (!session) return 'anon';
  if (session.role === 'admin') {
    return `admin:${canonicalAdminUsername(session.blok_rumah)}`;
  }
  if (session.role === 'petugas') {
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
  ids.add(getChatParticipantId(session));
  ids.add(getCanonicalUserId(session));

  if (session.role === 'admin') {
    const clean = normalizeToken(session.blok_rumah);
    if (clean === 'admin' || clean === 'andriansyah') {
      ids.add('admin:admin');
      ids.add('admin:andriansyah');
    } else if (clean === 'paiwan' || clean === 'bpiwan') {
      ids.add('admin:paiwan');
      ids.add('admin:bpiwan');
    }
  } else if (session.role === 'warga') {
    const raw = normalizeToken(session.blok_rumah);
    if (raw) ids.add(`warga:${raw}`);
    const canon = canonicalBlockKey(session.blok_rumah).toLowerCase();
    if (canon) ids.add(`warga:${canon}`);
  } else if (session.role === 'petugas') {
    if (session.petugas_id) {
      ids.add(`petugas:${normalizeToken(session.petugas_id)}`);
      ids.add(`keamanan:${normalizeToken(session.petugas_id)}`);
    }
    if (session.blok_rumah) {
      ids.add(`petugas:${normalizeToken(session.blok_rumah)}`);
    }
  }
  return ids;
}

export function normalizeChatParticipantId(rawId: string): string {
  const clean = normalizeToken(rawId);
  if (clean.startsWith('admin:')) {
    return `admin:${canonicalAdminUsername(clean.slice('admin:'.length))}`;
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
  return CHAT_ROOMS.filter((room) => room.allowedRoles.includes(session.role));
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
  type?: 'insert' | 'delete' | 'read' | 'clear';
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

export function normalizeChatRow(row: Record<string, unknown>): ChatMessage {
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
    message: String(row.message || ''),
    reply_to_id: typeof row.reply_to_id === 'string' ? row.reply_to_id : null,
    reply_preview: typeof row.reply_preview === 'string' ? row.reply_preview : null,
    created_at: String(row.created_at || new Date().toISOString()),
    is_local_only: false,
  };
}

export function buildSenderSubtitle(session: SessionUser): string {
  if (session.role === 'admin') {
    return session.jabatan || 'Pengurus';
  }
  if (session.role === 'petugas') {
    return session.shift ? `Keamanan · ${session.shift}` : 'Petugas Keamanan';
  }
  return `Warga Blok ${session.blok_rumah}`;
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
    const unitLabel = canonBlock && /^B\d+/i.test(canonBlock) ? `Blok ${canonBlock}` : 'Sekretariat Blok B3/7';
    const roleLabel = jabatan && jabatan !== 'Pengurus' ? `Pengurus · ${jabatan}` : 'Pengurus';
    return {
      ...item,
      participant_id: `admin:${usernameKey}`,
      role: 'admin',
      display_name: rawName,
      subtitle: `${roleLabel} · ${unitLabel}`,
      role_label: roleLabel,
      unit_label: unitLabel,
      blok_or_code: canonBlock || usernameKey.toUpperCase(),
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
  const unitLabel = canonBlok ? `Blok ${canonBlok}` : 'Warga';
  return {
    ...item,
    participant_id: `warga:${canonBlok.toLowerCase()}`,
    role: 'warga',
    display_name: (item.display_name || `Warga ${unitLabel}`).trim(),
    subtitle: `Warga · ${unitLabel}`,
    role_label: `Warga · ${unitLabel}`,
    unit_label: unitLabel,
    blok_or_code: canonBlok,
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
      subtitle: `Warga Blok ${w.blok_rumah}`,
      blok_or_code: w.blok_rumah,
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
                upsertContact({
                  participant_id: `warga:${canonicalBlockKey(blok).toLowerCase()}`,
                  role: 'warga',
                  display_name: nama,
                  subtitle: `Warga Blok ${blok}`,
                  blok_or_code: blok,
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
    return a.blok_or_code.localeCompare(b.blok_or_code, 'id', { numeric: true });
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

  if (allowedSet.has(session.role)) {
    const selfContact = formatEnrichedContact({
      participant_id: getChatParticipantId(session),
      role: session.role,
      display_name: session.nama_warga || 'Anda',
      subtitle:
        session.role === 'admin'
          ? session.jabatan || 'Pengurus'
          : session.role === 'petugas'
            ? session.shift || 'Petugas Keamanan'
            : `Warga Blok ${session.blok_rumah}`,
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
    (m) => normalizeRoomId(m.room_id) === normalizedRoom && keepAfterClear(m)
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
      .filter(keepAfterClear);
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
    (m) => isDmRoomId(m.room_id) && canAccessChatRoom(session, m.room_id) && keepAfterClear(m)
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
          .filter((m) => isDmRoomId(m.room_id) && canAccessChatRoom(session, m.room_id) && keepAfterClear(m));
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

  let messages: ChatMessage[] = readLocalMessages().filter((m) =>
    canAccessChatRoom(session, m.room_id)
  );

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('community_chat_messages')
        .select('id, room_id, sender_id, created_at')
        .order('created_at', { ascending: false })
        .limit(180);

      if (!error && Array.isArray(data)) {
        const remote = data
          .map((row) => normalizeChatRow(row as Record<string, unknown>))
          .filter((m) => canAccessChatRoom(session, m.room_id));
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
  };

  let savedRemote = false;
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const payloadWithRecipient = {
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

      let { error } = await supabase.from('community_chat_messages').insert(payloadWithRecipient);

      // Kompatibilitas bila kolom recipient_* pada DB belum dibuat oleh migrasi v14
      if (error && (String(error.message || '').toLowerCase().includes('recipient_') || error.code === '42703' || error.code === 'PGRST204')) {
        const fallbackPayload = {
          id: nextMessage.id,
          room_id: nextMessage.room_id,
          sender_role: nextMessage.sender_role,
          sender_id: nextMessage.sender_id,
          sender_name: nextMessage.sender_name,
          sender_subtitle: nextMessage.sender_subtitle,
          sender_avatar_url: nextMessage.sender_avatar_url,
          message: nextMessage.message,
          reply_to_id: payloadWithRecipient.reply_to_id,
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
 * Menghapus pesan chat (pengirim dapat menghapus pesannya sendiri; Admin dapat menghapus pesan mana saja).
 */
export async function deleteChatMessage(
  session: SessionUser,
  msg: Pick<ChatMessage, 'id' | 'room_id' | 'sender_id' | 'is_local_only'>
): Promise<void> {
  const myIds = getChatParticipantMatchIds(session);
  const canDelete =
    session.role === 'admin' ||
    myIds.has(normalizeChatParticipantId(msg.sender_id)) ||
    myIds.has(msg.sender_id);
  if (!canDelete) {
    throw new Error('Anda hanya dapat menghapus pesan Anda sendiri.');
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !msg.is_local_only && !msg.id.startsWith('chat-')) {
    const { error } = await supabase.from('community_chat_messages').delete().eq('id', msg.id);
    if (error) {
      throw new Error(error.message || 'Gagal menghapus pesan di server.');
    }
  }

  const remaining = readLocalMessages().filter((item) => item.id !== msg.id);
  writeLocalMessages(remaining);
  emitChatChanged({ type: 'delete', room_id: msg.room_id, deletedId: msg.id });
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

/**
 * Subscription real-time Supabase Postgres Changes + sinkronisasi lintas tab lokal.
 */
export function subscribeChatMessagesRealtime(
  session: SessionUser,
  callbacks: {
    onInsert?: (msg: ChatMessage) => void;
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
          type?: 'insert' | 'delete' | 'read' | 'clear';
          room_id?: ChatRoomId;
          message?: ChatMessage;
          deletedId?: string;
        }>
      ).detail;
      if (
        detail?.type === 'insert' &&
        detail.message &&
        canAccessChatRoom(session, detail.message.room_id)
      ) {
        callbacks.onInsert?.(detail.message);
      } else if (detail?.type === 'delete' && detail.deletedId) {
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
        e.key === getChatClearedStorageKey(session)
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
    try {
      const channel = supabase
        .channel(`community-chat-${session.role}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'community_chat_messages' },
          (payload) => {
            const row = payload.new as Record<string, unknown> | undefined;
            if (!row) return;
            const normalized = normalizeChatRow(row);
            if (!canAccessChatRoom(session, normalized.room_id)) return;
            callbacks.onInsert?.(normalized);
            callbacks.onAnyChange?.();
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
