import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CornerUpLeft,
  Home,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { SessionUser, UserRole } from '../types';
import {
  deleteChatMessage,
  fetchChatMessages,
  fetchChatUnreadSummary,
  getAccessibleChatRooms,
  markChatRoomRead,
  sendChatMessage,
  subscribeChatMessagesRealtime,
  type ChatMessage,
  type ChatRoomId,
} from '../lib/chatService';
import { getCanonicalUserId } from '../lib/notificationService';
import { buildAvatarKey, useAvatarMap } from '../lib/avatarService';
import { UserAvatar } from './UserAvatar';

interface CommunityChatSlideProps {
  session: SessionUser;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

function formatMessageTime(isoDate: string): string {
  try {
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return '';
    const now = new Date();
    const isToday =
      parsed.getFullYear() === now.getFullYear() &&
      parsed.getMonth() === now.getMonth() &&
      parsed.getDate() === now.getDate();
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    if (isToday) return `${hh}.${mm}`;
    const tanggal = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
    })
      .format(parsed)
      .replace(/\./g, '');
    return `${tanggal}, ${hh}.${mm}`;
  } catch {
    return '';
  }
}

function getRoleBadgeStyle(role: UserRole): {
  label: string;
  badgeClass: string;
} {
  if (role === 'admin') {
    return {
      label: 'Pengurus',
      badgeClass: 'bg-indigo-100 text-[#312E81] border-indigo-200',
    };
  }
  if (role === 'petugas') {
    return {
      label: 'Keamanan',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
  }
  return {
    label: 'Warga',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
  };
}

function getRoomIcon(roomId: ChatRoomId) {
  if (roomId === 'forum_umum') return Users;
  if (roomId === 'pengurus_keamanan' || roomId === 'warga_keamanan') return Shield;
  return Home;
}

export function CommunityChatSlide({ session, onToast }: CommunityChatSlideProps) {
  const avatarMap = useAvatarMap();
  const accessibleRooms = useMemo(() => getAccessibleChatRooms(session), [session]);
  const mySenderId = useMemo(() => getCanonicalUserId(session), [session]);

  const [activeRoomId, setActiveRoomId] = useState<ChatRoomId>(
    () => accessibleRooms[0]?.id || 'forum_umum'
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadByRoom, setUnreadByRoom] = useState<Record<ChatRoomId, number>>({
    forum_umum: 0,
    pengurus_warga: 0,
    pengurus_keamanan: 0,
    warga_keamanan: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRoomIdRef = useRef<ChatRoomId>(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  const activeRoom = useMemo(
    () => accessibleRooms.find((r) => r.id === activeRoomId) || accessibleRooms[0],
    [accessibleRooms, activeRoomId]
  );

  // Pastikan activeRoomId selalu valid bila sesi/role berubah
  useEffect(() => {
    if (!accessibleRooms.some((r) => r.id === activeRoomId) && accessibleRooms[0]) {
      setActiveRoomId(accessibleRooms[0].id);
    }
  }, [accessibleRooms, activeRoomId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.requestAnimationFrame(() => {
      listEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const syncUnread = useCallback(async () => {
    const summary = await fetchChatUnreadSummary(session);
    setUnreadByRoom(summary.byRoom);
  }, [session]);

  const loadRoomMessages = useCallback(
    async (roomId: ChatRoomId, silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetchChatMessages(session, roomId);
        if (activeRoomIdRef.current !== roomId) return;
        setMessages(res.messages);
        const latestIso = res.messages[res.messages.length - 1]?.created_at;
        markChatRoomRead(session, roomId, latestIso);
        void syncUnread();
        if (!silent) {
          scrollToBottom('auto');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, syncUnread, scrollToBottom]
  );

  useEffect(() => {
    setReplyTarget(null);
    setConfirmDeleteId(null);
    void loadRoomMessages(activeRoomId, false);
  }, [activeRoomId, loadRoomMessages]);

  // Realtime WebSocket + sinkronisasi lintas tab
  useEffect(() => {
    const unsub = subscribeChatMessagesRealtime(session, {
      onInsert: (incoming) => {
        if (incoming.room_id === activeRoomIdRef.current) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming].sort(
              (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
            );
          });
          markChatRoomRead(session, incoming.room_id, incoming.created_at);
          scrollToBottom('smooth');
        }
        void syncUnread();
      },
      onDelete: (deletedId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        void syncUnread();
      },
      onAnyChange: () => {
        void syncUnread();
      },
    });
    return () => {
      unsub();
    };
  }, [session, syncUnread, scrollToBottom]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanText = draft.trim();
    if (!cleanText || sending) return;

    const replyToId = replyTarget?.id || null;
    const replyPreview = replyTarget
      ? `${replyTarget.sender_name}: ${replyTarget.message.slice(0, 90)}`
      : null;

    setSending(true);
    setDraft('');
    setReplyTarget(null);

    try {
      const { message } = await sendChatMessage(session, {
        room_id: activeRoomId,
        message: cleanText,
        reply_to_id: replyToId,
        reply_preview: replyPreview,
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      scrollToBottom('smooth');
      inputRef.current?.focus();
    } catch (err) {
      setDraft(cleanText);
      onToast?.('error', err instanceof Error ? err.message : 'Gagal mengirim pesan.');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (msg: ChatMessage) => {
    if (deletingId) return;
    setDeletingId(msg.id);
    try {
      await deleteChatMessage(session, msg);
      setMessages((prev) => prev.filter((item) => item.id !== msg.id));
      setConfirmDeleteId(null);
      onToast?.('info', 'Pesan berhasil dihapus.');
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Gagal menghapus pesan.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const resolveAvatarSrc = (msg: ChatMessage): string | null => {
    if (msg.sender_avatar_url) return msg.sender_avatar_url;
    const rawId = msg.sender_id.includes(':') ? msg.sender_id.split(':').slice(1).join(':') : msg.sender_id;
    return (
      avatarMap[buildAvatarKey(msg.sender_role, rawId)] ||
      avatarMap[buildAvatarKey('admin', rawId)] ||
      avatarMap[buildAvatarKey('warga', rawId)] ||
      avatarMap[buildAvatarKey('petugas', rawId)] ||
      null
    );
  };

  return (
    <div className="space-y-4">
      {/* Header & Pemilih Ruang Chat (Mobile Horizontal + Desktop Split) */}
      <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden shadow-lg shadow-indigo-950/5">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] min-h-[68dvh] md:min-h-[72dvh] max-h-[80dvh]">
          {/* Panel Daftar Ruang Chat */}
          <aside className="border-b md:border-b-0 md:border-r border-indigo-100/80 bg-white/55 flex flex-col">
            <div className="px-4 py-3.5 border-b border-indigo-100/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white flex items-center justify-center shrink-0 shadow-xs">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-[#0F172A] leading-tight truncate">
                    Chat Lingkungan
                  </h2>
                  <p className="text-[11px] text-slate-500 truncate">
                    Pengurus · Warga · Keamanan
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={refreshing || loading}
                onClick={() => void loadRoomMessages(activeRoomId, true)}
                aria-label="Muat ulang percakapan"
                className="h-8 w-8 rounded-xl border border-indigo-100 bg-white/90 hover:bg-indigo-50 text-[#4C1D95] flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Mobile: Horizontal Room Chips | Desktop: Vertical Room List */}
            <div className="p-2.5 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto no-scrollbar">
              {accessibleRooms.map((room) => {
                const RoomIcon = getRoomIcon(room.id);
                const isActive = room.id === activeRoomId;
                const unread = unreadByRoom[room.id] || 0;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setActiveRoomId(room.id)}
                    className={`shrink-0 md:shrink md:w-full text-left px-3 py-2.5 rounded-2xl border transition-all duration-150 flex items-center gap-2.5 cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 border-sky-300/80 text-[#312E81] shadow-2xs'
                        : 'bg-white/75 hover:bg-white border-transparent hover:border-indigo-100 text-slate-600'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isActive
                          ? `bg-gradient-to-tr ${room.accentClass} text-white shadow-xs`
                          : 'bg-indigo-50 text-[#4C1D95]'
                      }`}
                    >
                      <RoomIcon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold truncate leading-tight">
                          <span className="md:hidden">{room.shortLabel}</span>
                          <span className="hidden md:inline">{room.label}</span>
                        </p>
                        {unread > 0 && !isActive && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums shrink-0">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
                      <p className="hidden md:block text-[10.5px] text-slate-500 truncate mt-0.5">
                        {room.participantsLabel}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Area Percakapan Utama */}
          <div className="flex flex-col min-h-0 bg-gradient-to-b from-white/40 via-indigo-50/20 to-sky-50/25">
            {/* Header Ruang Aktif */}
            {activeRoom && (
              <div className="px-4 sm:px-5 py-3 border-b border-indigo-100/70 bg-white/70 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#0F172A] truncate">
                      {activeRoom.label}
                    </h3>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] font-semibold text-emerald-700 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>Real-time</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {activeRoom.description}
                  </p>
                </div>
                <span className="hidden sm:inline-flex text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                  {messages.length} pesan
                </span>
              </div>
            )}

            {/* Daftar Pesan */}
            <div className="flex-1 overflow-y-auto px-3.5 sm:px-5 py-4 space-y-3 min-h-[300px]">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4C1D95]" />
                  <p className="text-xs font-medium">Memuat percakapan...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4C1D95]">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-[#0F172A] mt-3">
                    Belum Ada Pesan di {activeRoom?.label}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                    Mulai koordinasi langsung bersama {activeRoom?.participantsLabel.toLowerCase()}.
                    Semua pesan tersinkronisasi otomatis secara real-time.
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.sender_id === mySenderId;
                  const canDeleteThis = session.role === 'admin' || isMine;
                  const roleBadge = getRoleBadgeStyle(msg.sender_role);
                  const isConfirming = confirmDeleteId === msg.id;
                  const isDeletingThis = deletingId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-2.5 ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isMine && (
                        <UserAvatar
                          name={msg.sender_name}
                          src={resolveAvatarSrc(msg)}
                          size="xs"
                          className="shrink-0 mb-1"
                        />
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-[74%] flex flex-col ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                      >
                        {/* Identitas Pengirim */}
                        <div
                          className={`flex flex-wrap items-center gap-1.5 mb-1 px-1 ${
                            isMine ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          <span className="text-[11px] font-bold text-slate-700">
                            {isMine ? 'Anda' : msg.sender_name}
                          </span>
                          <span
                            className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-md border leading-none ${roleBadge.badgeClass}`}
                          >
                            {roleBadge.label}
                          </span>
                          {!isMine && msg.sender_subtitle && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[160px]">
                              {msg.sender_subtitle}
                            </span>
                          )}
                        </div>

                        {/* Gelembung Pesan */}
                        <div
                          className={`group relative rounded-2xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-xs border ${
                            isMine
                              ? 'bg-gradient-to-tr from-[#312E81] via-[#3730A3] to-[#0284C7] text-white border-indigo-700/30 rounded-br-md'
                              : 'bg-white/95 text-[#0F172A] border-indigo-100/90 rounded-bl-md'
                          }`}
                        >
                          {msg.reply_preview && (
                            <div
                              className={`mb-2 px-2.5 py-1.5 rounded-xl text-[11px] border-l-2 leading-snug ${
                                isMine
                                  ? 'bg-white/15 border-sky-200 text-sky-50'
                                  : 'bg-indigo-50/80 border-[#4C1D95] text-slate-600'
                              }`}
                            >
                              {msg.reply_preview}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap break-words">{msg.message}</p>

                          <div
                            className={`mt-1.5 flex items-center justify-between gap-3 text-[10px] ${
                              isMine ? 'text-sky-100/85' : 'text-slate-400'
                            }`}
                          >
                            <span className="font-mono tabular-nums">
                              {formatMessageTime(msg.created_at)}
                              {msg.is_local_only ? ' · Lokal' : ''}
                            </span>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyTarget(msg);
                                  inputRef.current?.focus();
                                }}
                                aria-label="Balas pesan"
                                title="Balas pesan ini"
                                className={`p-1 rounded-md transition-colors cursor-pointer ${
                                  isMine
                                    ? 'hover:bg-white/15 text-sky-100'
                                    : 'hover:bg-indigo-50 text-slate-400 hover:text-[#4C1D95]'
                                }`}
                              >
                                <CornerUpLeft className="w-3 h-3" />
                              </button>

                              {canDeleteThis && !isConfirming && (
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => setConfirmDeleteId(msg.id)}
                                  aria-label="Hapus pesan"
                                  title="Hapus pesan"
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    isMine
                                      ? 'hover:bg-white/15 text-sky-100 hover:text-rose-200'
                                      : 'hover:bg-rose-50 text-slate-400 hover:text-rose-600'
                                  }`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {canDeleteThis && isConfirming && (
                            <div className="mt-2 pt-2 border-t border-white/20 flex items-center justify-end gap-1.5 text-[10.5px]">
                              <span className={isMine ? 'text-sky-100' : 'text-rose-700 font-semibold'}>
                                Hapus pesan?
                              </span>
                              <button
                                type="button"
                                disabled={isDeletingThis}
                                onClick={() => void handleDeleteMessage(msg)}
                                className="px-2.5 py-0.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                              >
                                {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                <span>Ya</span>
                              </button>
                              <button
                                type="button"
                                disabled={isDeletingThis}
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-0.5 rounded-full bg-white text-slate-700 font-semibold border border-slate-200 hover:bg-slate-50 cursor-pointer"
                              >
                                Batal
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={listEndRef} />
            </div>

            {/* Composer Input Pesan */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 sm:p-4 border-t border-indigo-100/80 bg-white/80 backdrop-blur-md space-y-2 shrink-0"
            >
              {replyTarget && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-indigo-50/90 border border-indigo-200/70 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-bold text-[#4C1D95] truncate">
                      Membalas {replyTarget.sender_name}
                    </p>
                    <p className="text-[11px] text-slate-600 truncate">{replyTarget.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Batalkan balasan"
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  maxLength={1000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Tulis pesan ke ${activeRoom?.label || 'ruang ini'}...`}
                  className="flex-1 min-h-[44px] max-h-28 resize-none rounded-2xl border border-indigo-200/80 bg-white/95 px-3.5 py-2.5 text-xs sm:text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  aria-label="Kirim pesan"
                  className="h-11 px-4 rounded-2xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] hover:brightness-105 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Kirim</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
