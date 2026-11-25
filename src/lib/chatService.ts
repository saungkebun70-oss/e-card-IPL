import type { SessionUser, UserRole } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import {
  dispatchActivityNotifications,
  getAllAdminUserIds,
  getCanonicalUserId,
} from './notificationService';

export type ChatRoomId =
  | 'forum_umum'
  | 'pengurus_warga'
  | 'pengurus_keamanan'
  | 'warga_keamanan';

export interface ChatRoomMeta {
  id: ChatRoomId;
  label: string;
  shortLabel: string;
  description: string;
  participantsLabel: string;
  accentClass: string;
}

export interface ChatMessage {
  id: string;
  room_id: ChatRoomId;
  sender_role: UserRole;
  sender_id: string;
  sender_name: string;
  sender_subtitle: string;
  sender_avatar_url: string | null;
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
}

const LOCAL_CHAT_MESSAGES_KEY = 'ecard_community_chat_messages_v1';
const LOCAL_CHAT_READ_PREFIX = 'ecard_community_chat_read_v1:';
const CHAT_CHANGED_EVENT = 'ecard-community-chat-changed';
const MAX_LOCAL_MESSAGES = 300;
const MAX_MESSAGE_LENGTH = 1000;

export const CHAT_ROOMS: ChatRoomMeta[] = [
  {
    id: 'forum_umum',
    label: 'Forum Lingkungan',
    shortLabel: 'Forum',
    description: 'Diskusi terbuka Pengurus, Warga & Keamanan Perumahan Saung Kebun',
    participantsLabel: 'Pengurus · Warga · Keamanan',
    accentClass: 'from-[#312E81] to-[#0284C7]',
  },
  {
    id: 'pengurus_warga',
    label: 'Pengurus ↔ Warga',
    shortLabel: 'Pengurus & Warga',
    description: 'Koordinasi iuran IPL, fasilitas lingkungan, dan aspirasi warga',
    participantsLabel: 'Pengurus · Warga',
    accentClass: 'from-[#4C1D95] to-[#6D28D9]',
  },
  {
    id: 'warga_keamanan',
    label: 'Warga ↔ Keamanan',
    shortLabel: 'Warga & Keamanan',
    description: 'Laporan cepat tamu, kendala gerbang, dan bantuan keamanan 24 jam',
    participantsLabel: 'Warga · Keamanan · Pengurus',
    accentClass: 'from-emerald-600 to-teal-600',
  },
  {
    id: 'pengurus_keamanan',
    label: 'Pengurus ↔ Keamanan',
    shortLabel: 'Internal Keamanan',
    description: 'Koordinasi internal shift jaga, patroli NFC, dan instruksi pengurus',
    participantsLabel: 'Pengurus · Keamanan (Internal)',
    accentClass: 'from-amber-600 to-orange-600',
  },
];

export function getAccessibleChatRooms(session: SessionUser): ChatRoomMeta[] {
  if (session.role === 'admin') {
    return CHAT_ROOMS;
  }
  if (session.role === 'petugas') {
    return CHAT_ROOMS.filter(
      (r) => r.id === 'forum_umum' || r.id === 'pengurus_keamanan' || r.id === 'warga_keamanan'
    );
  }
  return CHAT_ROOMS.filter(
    (r) => r.id === 'forum_umum' || r.id === 'pengurus_warga' || r.id === 'warga_keamanan'
  );
}

export function canAccessChatRoom(session: SessionUser, roomId: ChatRoomId): boolean {
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

function emitChatChanged(detail?: { type?: 'insert' | 'delete' | 'read'; room_id?: ChatRoomId; message?: ChatMessage; deletedId?: string }): void {
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
  if (
    clean === 'forum_umum' ||
    clean === 'pengurus_warga' ||
    clean === 'pengurus_keamanan' ||
    clean === 'warga_keamanan'
  ) {
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
  return `${LOCAL_CHAT_READ_PREFIX}${getCanonicalUserId(session)}`;
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

/**
 * Mengambil pesan untuk 1 ruang chat tertentu (urutan kronologis lama -> terbaru).
 */
export async function fetchChatMessages(
  session: SessionUser,
  roomId: ChatRoomId,
  limit = 100
): Promise<{ messages: ChatMessage[]; remoteAvailable: boolean }> {
  if (!canAccessChatRoom(session, roomId)) {
    return { messages: [], remoteAvailable: false };
  }

  const localRoomMessages = readLocalMessages().filter((m) => m.room_id === roomId);
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
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return {
        messages: localRoomMessages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
        remoteAvailable: false,
      };
    }

    const remoteRows = data.map((row) => normalizeChatRow(row as Record<string, unknown>));
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
 * Menghitung pesan belum dibaca per ruang chat & total untuk badge Sidebar/Header.
 */
export async function fetchChatUnreadSummary(session: SessionUser): Promise<{
  totalUnread: number;
  byRoom: Record<ChatRoomId, number>;
}> {
  const byRoom: Record<ChatRoomId, number> = {
    forum_umum: 0,
    pengurus_warga: 0,
    pengurus_keamanan: 0,
    warga_keamanan: 0,
  };

  const accessible = getAccessibleChatRooms(session);
  const accessibleIds = new Set(accessible.map((r) => r.id));
  const mySenderId = getCanonicalUserId(session);
  const lastReadMap = readLastReadMap(session);

  let messages: ChatMessage[] = readLocalMessages().filter((m) => accessibleIds.has(m.room_id));

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('community_chat_messages')
        .select('id, room_id, sender_id, created_at')
        .in('room_id', Array.from(accessibleIds))
        .order('created_at', { ascending: false })
        .limit(120);

      if (!error && Array.isArray(data)) {
        const remote = data.map((row) => normalizeChatRow(row as Record<string, unknown>));
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

  // Jika user belum pernah membuka ruang chat sama sekali, jangan tandai riwayat lama > 24 jam sebagai unread
  const fallbackCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  for (const msg of messages) {
    if (!accessibleIds.has(msg.room_id)) continue;
    if (msg.sender_id === mySenderId) continue;
    const msgMs = Date.parse(msg.created_at);
    if (Number.isNaN(msgMs)) continue;
    const lastReadIso = lastReadMap[msg.room_id];
    const cutoffMs = lastReadIso ? Date.parse(lastReadIso) : fallbackCutoffMs;
    if (msgMs > cutoffMs) {
      byRoom[msg.room_id] = (byRoom[msg.room_id] || 0) + 1;
    }
  }

  const totalUnread =
    byRoom.forum_umum +
    byRoom.pengurus_warga +
    byRoom.pengurus_keamanan +
    byRoom.warga_keamanan;

  return { totalUnread, byRoom };
}

/**
 * Mengirim pesan chat baru ke ruang yang dipilih & menyiarkan notifikasi aktivitas.
 */
export async function sendChatMessage(
  session: SessionUser,
  input: SendChatMessageInput
): Promise<{ message: ChatMessage; savedRemote: boolean }> {
  if (!canAccessChatRoom(session, input.room_id)) {
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
  const senderId = getCanonicalUserId(session);
  const senderSubtitle = buildSenderSubtitle(session);

  const nextMessage: ChatMessage = {
    id: messageId,
    room_id: input.room_id,
    sender_role: session.role,
    sender_id: senderId,
    sender_name: session.nama_warga || 'Pengguna',
    sender_subtitle: senderSubtitle,
    sender_avatar_url: session.avatar_url || null,
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
      const { error } = await supabase.from('community_chat_messages').insert({
        id: nextMessage.id,
        room_id: nextMessage.room_id,
        sender_role: nextMessage.sender_role,
        sender_id: nextMessage.sender_id,
        sender_name: nextMessage.sender_name,
        sender_subtitle: nextMessage.sender_subtitle,
        sender_avatar_url: nextMessage.sender_avatar_url,
        message: nextMessage.message,
        reply_to_id:
          nextMessage.reply_to_id && !nextMessage.reply_to_id.startsWith('chat-')
            ? nextMessage.reply_to_id
            : null,
        reply_preview: nextMessage.reply_preview,
        created_at: nextMessage.created_at,
      });

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

  markChatRoomRead(session, input.room_id, nowIso);
  emitChatChanged({ type: 'insert', room_id: input.room_id, message: nextMessage });

  // Kirim notifikasi lonceng secara terukur ke target peran terkait
  const roomMeta = CHAT_ROOMS.find((r) => r.id === input.room_id);
  const roomTitle = roomMeta?.label || 'Chat Lingkungan';
  const snippet = cleanText.length > 90 ? `${cleanText.slice(0, 87)}...` : cleanText;
  const notifTitle = `Pesan Baru · ${roomTitle}`;
  const notifMsg = `${nextMessage.sender_name} (${senderSubtitle}): ${snippet}`;
  const dedupKey = `chat:${nextMessage.id}`;

  const recipientItems: Array<{
    user_id: string;
    category: 'system';
    title: string;
    message: string;
    target_url: string;
    dedup_key: string;
  }> = [];

  // Notifikasi ke Pengurus jika pengirim bukan admin, atau ke pengurus lainnya
  if (session.role !== 'admin') {
    for (const adminUid of getAllAdminUserIds()) {
      recipientItems.push({
        user_id: adminUid,
        category: 'system',
        title: notifTitle,
        message: notifMsg,
        target_url: 'tab:chat',
        dedup_key: dedupKey,
      });
    }
  }

  if (
    (input.room_id === 'forum_umum' ||
      input.room_id === 'pengurus_warga' ||
      input.room_id === 'warga_keamanan') &&
    session.role !== 'warga'
  ) {
    recipientItems.push({
      user_id: 'broadcast:warga',
      category: 'system',
      title: notifTitle,
      message: notifMsg,
      target_url: 'tab:chat',
      dedup_key: `${dedupKey}:warga`,
    });
  }

  if (
    (input.room_id === 'forum_umum' ||
      input.room_id === 'pengurus_keamanan' ||
      input.room_id === 'warga_keamanan') &&
    session.role !== 'petugas'
  ) {
    recipientItems.push({
      user_id: 'broadcast:petugas',
      category: 'system',
      title: notifTitle,
      message: notifMsg,
      target_url: 'tab:chat',
      dedup_key: `${dedupKey}:petugas`,
    });
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
  const mySenderId = getCanonicalUserId(session);
  const canDelete = session.role === 'admin' || msg.sender_id === mySenderId;
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
 * Subscription real-time Supabase Postgres Changes + sinkronisasi lintas tab lokal.
 */
export function subscribeChatMessagesRealtime(
  session: SessionUser,
  callbacks: {
    onInsert?: (msg: ChatMessage) => void;
    onDelete?: (deletedId: string) => void;
    onAnyChange?: () => void;
  }
): () => void {
  const cleanups: Array<() => void> = [];
  const accessibleIds = new Set(getAccessibleChatRooms(session).map((r) => r.id));

  if (typeof window !== 'undefined') {
    const onLocal = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          type?: 'insert' | 'delete' | 'read';
          message?: ChatMessage;
          deletedId?: string;
        }>
      ).detail;
      if (detail?.type === 'insert' && detail.message && accessibleIds.has(detail.message.room_id)) {
        callbacks.onInsert?.(detail.message);
      } else if (detail?.type === 'delete' && detail.deletedId) {
        callbacks.onDelete?.(detail.deletedId);
      }
      callbacks.onAnyChange?.();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_CHAT_MESSAGES_KEY || e.key === getChatReadStorageKey(session)) {
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
            if (!accessibleIds.has(normalized.room_id)) return;
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
