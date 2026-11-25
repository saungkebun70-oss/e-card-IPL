import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  CornerUpLeft,
  Eraser,
  Home,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import type { SessionUser, UserRole } from '../types';
import {
  buildDmRoomId,
  canAccessChatRoom,
  clearChatRoom,
  deleteChatMessage,
  fetchChatDirectory,
  fetchChatMessages,
  fetchChatUnreadSummary,
  fetchDmConversations,
  getAccessibleChatRooms,
  getChatParticipantId,
  getChatParticipantMatchIds,
  getGroupMembers,
  isDmRoomId,
  isMessageClearedForRoom,
  markChatRoomRead,
  normalizeChatParticipantId,
  parseDmParticipants,
  sendChatMessage,
  subscribeChatMessagesRealtime,
  type ChatContact,
  type ChatMessage,
  type ChatRoomId,
  type DmThreadPreview,
  type GroupChatRoomId,
} from '../lib/chatService';
import { buildAvatarKey, useAvatarMap } from '../lib/avatarService';
import { UserAvatar } from './UserAvatar';

interface CommunityChatSlideProps {
  session: SessionUser;
  initialRoomId?: ChatRoomId | null;
  variant?: 'page' | 'floating';
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type ChatPrimaryTab = 'dm' | 'group';

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

function getRoleBadgeStyle(role: UserRole, customLabel?: string): {
  label: string;
  badgeClass: string;
} {
  if (role === 'admin') {
    return {
      label: customLabel || 'Pengurus',
      badgeClass: 'bg-indigo-100 text-[#312E81] border-indigo-200',
    };
  }
  if (role === 'petugas') {
    return {
      label: customLabel || 'Keamanan',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
  }
  return {
    label: customLabel || 'Warga',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
  };
}

function getRoomIcon(roomId: GroupChatRoomId) {
  if (roomId === 'grup_pengurus') return ShieldCheck;
  if (roomId === 'forum_umum') return Users;
  if (roomId === 'pengurus_keamanan' || roomId === 'warga_keamanan') return Shield;
  return Home;
}

export function CommunityChatSlide({
  session,
  initialRoomId,
  variant = 'floating',
  onToast,
}: CommunityChatSlideProps) {
  const isFloating = variant === 'floating';
  const avatarMap = useAvatarMap();
  const accessibleRooms = useMemo(() => getAccessibleChatRooms(session), [session]);
  const myMatchIds = useMemo(() => getChatParticipantMatchIds(session), [session]);
  const myParticipantId = useMemo(() => getChatParticipantId(session), [session]);

  const [activeRoomId, setActiveRoomId] = useState<ChatRoomId>(() => {
    if (initialRoomId && canAccessChatRoom(session, initialRoomId)) {
      return initialRoomId;
    }
    return accessibleRooms[0]?.id || 'forum_umum';
  });
  const [primaryTab, setPrimaryTab] = useState<ChatPrimaryTab>(() =>
    initialRoomId && isDmRoomId(initialRoomId) ? 'dm' : 'group'
  );
  const [contactSearch, setContactSearch] = useState('');
  const [contactRoleFilter, setContactRoleFilter] = useState<'semua' | UserRole>('semua');
  const [floatingView, setFloatingView] = useState<'list' | 'thread'>(() =>
    initialRoomId ? 'thread' : 'list'
  );
  const [showGroupMembers, setShowGroupMembers] = useState(false);

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [dmThreads, setDmThreads] = useState<DmThreadPreview[]>([]);
  const [selectedPeerContact, setSelectedPeerContact] = useState<ChatContact | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClearRoom, setConfirmClearRoom] = useState(false);
  const [clearingRoom, setClearingRoom] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRoomIdRef = useRef<ChatRoomId>(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  useEffect(() => {
    if (initialRoomId && canAccessChatRoom(session, initialRoomId)) {
      setActiveRoomId(initialRoomId);
      setPrimaryTab(isDmRoomId(initialRoomId) ? 'dm' : 'group');
      if (isFloating) setFloatingView('thread');
    }
  }, [initialRoomId, session, isFloating]);

  // Pastikan activeRoomId selalu valid bila sesi/role berubah
  useEffect(() => {
    if (!canAccessChatRoom(session, activeRoomId) && accessibleRooms[0]) {
      setActiveRoomId(accessibleRooms[0].id);
    }
  }, [session, accessibleRooms, activeRoomId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.requestAnimationFrame(() => {
      listEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const syncDirectoriesAndUnread = useCallback(async () => {
    const [dirList, summary] = await Promise.all([
      fetchChatDirectory(session),
      fetchChatUnreadSummary(session),
    ]);
    setContacts(dirList);
    setUnreadByRoom(summary.byRoom);
    const threads = await fetchDmConversations(session, dirList);
    setDmThreads(threads);
  }, [session]);

  useEffect(() => {
    void syncDirectoriesAndUnread();
  }, [syncDirectoriesAndUnread]);

  const activeGroupRoom = useMemo(
    () => accessibleRooms.find((r) => r.id === activeRoomId) || null,
    [accessibleRooms, activeRoomId]
  );

  const activeDmPeer = useMemo<ChatContact | null>(() => {
    if (!isDmRoomId(activeRoomId)) return null;
    if (
      selectedPeerContact &&
      buildDmRoomId(myParticipantId, selectedPeerContact.participant_id) === activeRoomId
    ) {
      return selectedPeerContact;
    }
    const pair = parseDmParticipants(activeRoomId);
    if (!pair) return null;
    const norm0 = normalizeChatParticipantId(pair[0]);
    const peerId = myMatchIds.has(norm0) ? normalizeChatParticipantId(pair[1]) : norm0;
    const found = contacts.find((c) => normalizeChatParticipantId(c.participant_id) === peerId);
    if (found) return found;
    const thread = dmThreads.find((t) => t.room_id === activeRoomId);
    if (thread) {
      return {
        participant_id: thread.peer_id,
        role: thread.peer_role,
        display_name: thread.peer_name,
        subtitle: thread.peer_subtitle,
        blok_or_code: thread.peer_id.split(':').slice(1).join(':').toUpperCase(),
        avatar_url: thread.peer_avatar_url,
      };
    }
    const fallbackRole: UserRole = peerId.startsWith('admin:')
      ? 'admin'
      : peerId.startsWith('petugas:')
        ? 'petugas'
        : 'warga';
    const unitCode = peerId.split(':').slice(1).join(':').toUpperCase();
    return {
      participant_id: peerId,
      role: fallbackRole,
      display_name: unitCode,
      subtitle:
        fallbackRole === 'admin'
          ? 'Pengurus'
          : fallbackRole === 'petugas'
            ? 'Keamanan'
            : `Warga · Blok ${unitCode}`,
      role_label:
        fallbackRole === 'admin'
          ? 'Pengurus'
          : fallbackRole === 'petugas'
            ? 'Keamanan'
            : `Warga · Blok ${unitCode}`,
      unit_label: fallbackRole === 'warga' ? `Blok ${unitCode}` : '',
      blok_or_code: unitCode,
    };
  }, [activeRoomId, selectedPeerContact, myParticipantId, dmThreads, contacts, myMatchIds]);

  const activeGroupMembers = useMemo(() => {
    if (!activeGroupRoom) return [];
    return getGroupMembers(activeGroupRoom.id, session, contacts);
  }, [activeGroupRoom, session, contacts]);

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
        void syncDirectoriesAndUnread();
        if (!silent) {
          scrollToBottom('auto');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, syncDirectoriesAndUnread, scrollToBottom]
  );

  useEffect(() => {
    setReplyTarget(null);
    setConfirmDeleteId(null);
    setConfirmClearRoom(false);
    setShowGroupMembers(false);
    void loadRoomMessages(activeRoomId, false);
  }, [activeRoomId, loadRoomMessages]);

  // Realtime WebSocket + sinkronisasi lintas tab
  useEffect(() => {
    const unsub = subscribeChatMessagesRealtime(session, {
      onInsert: (incoming) => {
        if (isMessageClearedForRoom(session, incoming.room_id, incoming.created_at)) return;
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
        void syncDirectoriesAndUnread();
      },
      onDelete: (deletedId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        void syncDirectoriesAndUnread();
      },
      onClear: (clearedRoomId) => {
        if (clearedRoomId === activeRoomIdRef.current) {
          setMessages([]);
          setReplyTarget(null);
          setConfirmClearRoom(false);
        }
        void syncDirectoriesAndUnread();
      },
      onAnyChange: () => {
        void syncDirectoriesAndUnread();
      },
    });
    return () => {
      unsub();
    };
  }, [session, syncDirectoriesAndUnread, scrollToBottom]);

  const handleSelectRoom = (roomId: ChatRoomId, peerContact?: ChatContact) => {
    if (peerContact) {
      setSelectedPeerContact(peerContact);
    } else if (!isDmRoomId(roomId)) {
      setSelectedPeerContact(null);
    }
    setActiveRoomId(roomId);
    if (isFloating) {
      setFloatingView('thread');
    }
  };

  const handleStartPersonalChat = (contact: ChatContact) => {
    const dmRoomId = buildDmRoomId(myParticipantId, contact.participant_id);
    handleSelectRoom(dmRoomId, contact);
    setPrimaryTab('dm');
  };

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
        recipient: activeDmPeer
          ? {
              participant_id: activeDmPeer.participant_id,
              display_name: activeDmPeer.display_name,
              role: activeDmPeer.role,
            }
          : null,
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      void syncDirectoriesAndUnread();
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

  const handleClearActiveRoom = async (mode: 'local' | 'server') => {
    if (clearingRoom) return;
    setClearingRoom(true);
    try {
      const latestMessageIso = messages[messages.length - 1]?.created_at;
      const res = await clearChatRoom(session, activeRoomId, { mode, latestMessageIso });
      setMessages([]);
      setReplyTarget(null);
      setConfirmDeleteId(null);
      setConfirmClearRoom(false);
      void syncDirectoriesAndUnread();
      onToast?.(
        'info',
        mode === 'server' && res.clearedRemote
          ? 'Seluruh riwayat pesan di ruang ini telah dihapus untuk semua peserta.'
          : 'Riwayat chat di tampilan Anda telah dibersihkan.'
      );
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Gagal membersihkan chat.');
    } finally {
      setClearingRoom(false);
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

  const resolveContactAvatar = useCallback(
    (c: ChatContact): string | null => {
      if (c.avatar_url) return c.avatar_url;
      return avatarMap[buildAvatarKey(c.role, c.blok_or_code)] || null;
    },
    [avatarMap]
  );

  // Deduplikasi ganda & filter pencarian kontak DM berdasarkan Peran, Nama, Blok/Nomor Rumah
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const seen = new Set<string>();
    const result: ChatContact[] = [];

    for (const c of contacts) {
      if (contactRoleFilter !== 'semua' && c.role !== contactRoleFilter) continue;
      if (q) {
        const hay = `${c.display_name} ${c.subtitle} ${c.role_label || ''} ${c.unit_label || ''} ${c.blok_or_code}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const uniqueKey = c.dedup_key || `${c.participant_id}:${c.role}:${c.blok_or_code}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      result.push(c);
    }
    return result;
  }, [contacts, contactSearch, contactRoleFilter]);

  const roleCounts = useMemo(() => {
    let admin = 0;
    let petugas = 0;
    let warga = 0;
    for (const c of contacts) {
      if (c.role === 'admin') admin += 1;
      else if (c.role === 'petugas') petugas += 1;
      else warga += 1;
    }
    return { total: contacts.length, admin, petugas, warga };
  }, [contacts]);

  // Thread DM aktif + contact DM yang sedang dibuka
  const visibleDmThreads = useMemo<DmThreadPreview[]>(() => {
    const contactById = new Map(contacts.map((c) => [normalizeChatParticipantId(c.participant_id), c]));
    const base = dmThreads.map((t) => {
      const matched = contactById.get(normalizeChatParticipantId(t.peer_id));
      if (!matched) return t;
      return {
        ...t,
        peer_name: matched.display_name,
        peer_subtitle: matched.subtitle,
        peer_avatar_url: matched.avatar_url || t.peer_avatar_url,
      };
    });
    if (activeDmPeer && isDmRoomId(activeRoomId)) {
      const exists = base.some((t) => t.room_id === activeRoomId);
      if (!exists) {
        base.unshift({
          room_id: activeRoomId,
          peer_id: activeDmPeer.participant_id,
          peer_name: activeDmPeer.display_name,
          peer_role: activeDmPeer.role,
          peer_subtitle: activeDmPeer.subtitle,
          peer_avatar_url: resolveContactAvatar(activeDmPeer),
          last_message: 'Mulai percakapan langsung...',
          last_sender_id: '',
          last_created_at: new Date().toISOString(),
          unread_count: unreadByRoom[activeRoomId] || 0,
        });
      }
    }
    return base;
  }, [dmThreads, contacts, activeDmPeer, activeRoomId, unreadByRoom, resolveContactAvatar]);

  const totalPersonalUnread = useMemo(
    () => visibleDmThreads.reduce((acc, t) => acc + (unreadByRoom[t.room_id] ?? t.unread_count ?? 0), 0),
    [visibleDmThreads, unreadByRoom]
  );

  const totalGroupUnread = useMemo(
    () => accessibleRooms.reduce((acc, r) => acc + (unreadByRoom[r.id] || 0), 0),
    [accessibleRooms, unreadByRoom]
  );

  const activeTitle = activeDmPeer
    ? activeDmPeer.display_name
    : activeGroupRoom?.label || 'Chat Lingkungan';
  const activeSubtitle = activeDmPeer
    ? activeDmPeer.subtitle
    : activeGroupRoom?.description || '';

  return (
    <div className={isFloating ? 'h-full flex flex-col min-h-0 w-full min-w-0' : 'space-y-4 w-full min-w-0'}>
      <section
        className={
          isFloating
            ? 'flex-1 min-h-0 flex flex-col w-full max-w-full min-w-0 overflow-hidden bg-transparent'
            : 'glass-card bg-white/85 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden shadow-lg shadow-indigo-950/5 w-full max-w-full min-w-0'
        }
      >
        <div
          className={
            isFloating
              ? 'flex-1 min-h-0 flex flex-col w-full min-w-0 overflow-hidden'
              : 'flex flex-col md:grid md:grid-cols-[296px_minmax(0,1fr)] h-[calc(100dvh-13.25rem)] sm:h-[calc(100dvh-11.5rem)] md:h-[75dvh] min-h-[480px] max-h-[780px] w-full min-w-0'
          }
        >
          {/* Panel Navigasi DM & Group (Aside) */}
          <aside
            className={`${
              isFloating && floatingView === 'thread' ? 'hidden' : 'flex'
            } ${
              isFloating
                ? 'flex-1 min-h-0 flex-col bg-white/60 w-full min-w-0 overflow-hidden'
                : 'shrink-0 md:shrink md:min-h-0 border-b md:border-b-0 md:border-r border-indigo-100/80 bg-white/60 flex flex-col w-full min-w-0 overflow-hidden'
            }`}
          >
            {/* div:nth-of-type(1) — Header + Tab Utama: DM | Group */}
            <div className="px-3 py-2.5 sm:px-3.5 sm:py-3 border-b border-indigo-100/70 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white flex items-center justify-center shrink-0 shadow-xs">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] leading-tight truncate">
                      Pesan &amp; Koordinasi
                    </h2>
                    <p className="text-[10.5px] text-slate-500 truncate">
                      DM Langsung &amp; Group Peran Terisolasi
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={refreshing || loading}
                  onClick={() => void loadRoomMessages(activeRoomId, true)}
                  aria-label="Muat ulang percakapan"
                  title="Sinkronkan percakapan & kontak"
                  className="h-8 w-8 rounded-xl border border-indigo-100 bg-white/90 hover:bg-indigo-50 text-[#4C1D95] flex items-center justify-center cursor-pointer transition-colors shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Tab Utama 2 Pilihan: DM | Group */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-indigo-50/85 border border-indigo-100/80">
                <button
                  type="button"
                  onClick={() => setPrimaryTab('dm')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    primaryTab === 'dm'
                      ? 'bg-white text-[#312E81] shadow-2xs ring-1 ring-indigo-100'
                      : 'text-slate-600 hover:text-[#312E81]'
                  }`}
                >
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>DM</span>
                  {totalPersonalUnread > 0 && (
                    <span className="min-w-[18px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9.5px] font-mono font-bold inline-flex items-center justify-center tabular-nums shrink-0">
                      {totalPersonalUnread > 99 ? '99+' : totalPersonalUnread}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setPrimaryTab('group')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    primaryTab === 'group'
                      ? 'bg-white text-[#312E81] shadow-2xs ring-1 ring-indigo-100'
                      : 'text-slate-600 hover:text-[#312E81]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>Group ({accessibleRooms.length})</span>
                  {totalGroupUnread > 0 && (
                    <span className="min-w-[18px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9.5px] font-mono font-bold inline-flex items-center justify-center tabular-nums shrink-0">
                      {totalGroupUnread > 99 ? '99+' : totalGroupUnread}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* div:nth-of-type(2) — Isi Tab DM (Threads + Daftar Kontak Lengkap + Blok) atau Tab Group */}
            <div className="p-2.5 sm:p-3 flex flex-col gap-2.5 overflow-y-auto min-w-0 flex-1 min-h-0 overscroll-contain">
              {primaryTab === 'dm' ? (
                <>
                  {/* Pencarian & Filter Peran Penerima DM */}
                  <div className="space-y-2 shrink-0 min-w-0">
                    <div className="relative min-w-0">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Cari nama, blok B3/7, atau jabatan..."
                        className="w-full min-h-[36px] rounded-xl border border-indigo-200/80 bg-white pl-8 pr-2.5 text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { id: 'semua', label: `Semua (${roleCounts.total})` },
                          { id: 'admin', label: `Pengurus (${roleCounts.admin})` },
                          { id: 'petugas', label: `Keamanan (${roleCounts.petugas})` },
                          { id: 'warga', label: `Warga (${roleCounts.warga})` },
                        ] as const
                      ).map((rf) => (
                        <button
                          key={rf.id}
                          type="button"
                          onClick={() => setContactRoleFilter(rf.id)}
                          className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold cursor-pointer transition-colors ${
                            contactRoleFilter === rf.id
                              ? 'bg-[#3730A3] text-white'
                              : 'bg-white border border-indigo-100 text-slate-600 hover:bg-indigo-50'
                          }`}
                        >
                          {rf.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Riwayat DM Aktif */}
                  {!contactSearch.trim() && contactRoleFilter === 'semua' && visibleDmThreads.length > 0 && (
                    <div className="space-y-1.5 min-w-0">
                      <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Percakapan DM Aktif
                      </p>
                      {visibleDmThreads.map((thread) => {
                        const isActive = thread.room_id === activeRoomId;
                        const unread = unreadByRoom[thread.room_id] ?? thread.unread_count ?? 0;
                        const badge = getRoleBadgeStyle(thread.peer_role);
                        return (
                          <button
                            key={`thread:${thread.room_id}`}
                            type="button"
                            onClick={() =>
                              handleSelectRoom(thread.room_id, {
                                participant_id: thread.peer_id,
                                role: thread.peer_role,
                                display_name: thread.peer_name,
                                subtitle: thread.peer_subtitle,
                                blok_or_code: thread.peer_id.split(':').slice(1).join(':').toUpperCase(),
                                avatar_url: thread.peer_avatar_url,
                              })
                            }
                            className={`w-full text-left px-2.5 py-2 rounded-2xl border transition-all duration-150 flex items-center gap-2.5 cursor-pointer min-w-0 ${
                              isActive
                                ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 border-sky-300/80 text-[#312E81] shadow-2xs'
                                : 'bg-white/90 hover:bg-white border-indigo-100/70 hover:border-indigo-200 text-slate-700'
                            }`}
                          >
                            <UserAvatar
                              name={thread.peer_name}
                              src={thread.peer_avatar_url}
                              size="xs"
                              className="shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1.5 min-w-0">
                                <p className="text-xs font-bold leading-tight truncate text-[#0F172A]">
                                  {thread.peer_name}
                                </p>
                                {unread > 0 && !isActive && (
                                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums shrink-0">
                                    {unread > 99 ? '99+' : unread}
                                  </span>
                                )}
                              </div>
                              <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500 truncate mt-0.5">
                                <span
                                  className={`px-1.5 py-px rounded text-[9px] font-bold border leading-none shrink-0 ${badge.badgeClass}`}
                                >
                                  {badge.label}
                                </span>
                                <span className="truncate">{thread.last_message}</span>
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Semua Daftar Penerima DM (Pengurus, Keamanan, & Warga lengkap dengan Blok Rumah & Peran) */}
                  <div className="space-y-1.5 min-w-0">
                    <p className="px-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Daftar Penerima DM ({filteredContacts.length})
                    </p>
                    {filteredContacts.length === 0 ? (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        Kontak tidak ditemukan.
                      </p>
                    ) : (
                      filteredContacts.map((contact) => {
                        const dmRoomId = buildDmRoomId(myParticipantId, contact.participant_id);
                        const isActive = dmRoomId === activeRoomId;
                        const badge = getRoleBadgeStyle(contact.role, contact.role_label);
                        return (
                          <button
                            key={contact.dedup_key || contact.participant_id}
                            type="button"
                            onClick={() => handleStartPersonalChat(contact)}
                            className={`w-full text-left px-2.5 py-2 rounded-2xl border flex items-center gap-2.5 transition-colors cursor-pointer min-w-0 ${
                              isActive
                                ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 border-sky-300/80'
                                : 'bg-white/90 hover:bg-indigo-50/75 border-indigo-100/75'
                            }`}
                          >
                            <UserAvatar
                              name={contact.display_name}
                              src={resolveContactAvatar(contact)}
                              size="xs"
                              className="shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1.5 min-w-0">
                                <p className="text-xs font-bold text-[#0F172A] truncate">
                                  {contact.display_name}
                                </p>
                                {contact.unit_label && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 font-mono text-[9.5px] font-bold text-slate-700 shrink-0 whitespace-nowrap">
                                    {contact.unit_label}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <span
                                  className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border leading-none shrink-0 ${badge.badgeClass}`}
                                >
                                  {badge.label}
                                </span>
                                <span className="text-[10.5px] text-slate-500 truncate">
                                  {contact.subtitle}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              ) : (
                /* Tab Group — Keanggotaan Ketat Berdasarkan Peran */
                <div className="space-y-2 min-w-0 shrink-0">
                  <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Grup Khusus Sesuai Peran ({accessibleRooms.length})
                  </p>
                  {accessibleRooms.map((room) => {
                    const RoomIcon = getRoomIcon(room.id);
                    const isActive = room.id === activeRoomId;
                    const unread = unreadByRoom[room.id] || 0;
                    const memberCount = getGroupMembers(room.id, session, contacts).length;
                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => handleSelectRoom(room.id)}
                        className={`w-full shrink-0 text-left px-3 py-2.5 rounded-2xl border transition-all duration-150 flex items-center gap-2.5 cursor-pointer min-w-0 ${
                          isActive
                            ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 border-sky-300/80 text-[#312E81] shadow-2xs'
                            : 'bg-white/90 hover:bg-white border-indigo-100/70 hover:border-indigo-200 text-slate-700'
                        }`}
                      >
                        <span
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isActive
                              ? `bg-gradient-to-tr ${room.accentClass} text-white shadow-xs`
                              : 'bg-indigo-50 text-[#4C1D95]'
                          }`}
                        >
                          <RoomIcon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <p className="text-xs font-bold leading-tight truncate text-[#0F172A]">
                              {room.label}
                            </p>
                            {unread > 0 && !isActive && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums shrink-0">
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1.5 mt-0.5 min-w-0">
                            <p className="text-[10.5px] text-slate-500 truncate">
                              {room.participantsLabel}
                            </p>
                            <span className="text-[10px] font-mono font-semibold text-indigo-700/80 shrink-0 tabular-nums">
                              {memberCount} anggota
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Area Percakapan Utama */}
          <div
            className={`${
              isFloating && floatingView === 'list' ? 'hidden' : 'flex'
            } flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-gradient-to-b from-white/40 via-indigo-50/20 to-sky-50/25`}
          >
            {/* Header Ruang Group / DM Aktif */}
            <div className="border-b border-indigo-100/70 bg-white/75 backdrop-blur-md shrink-0 min-w-0">
              <div className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isFloating && (
                    <button
                      type="button"
                      onClick={() => setFloatingView('list')}
                      aria-label="Kembali ke daftar chat"
                      className="h-8 w-8 rounded-xl border border-indigo-100 bg-white hover:bg-indigo-50 text-[#312E81] flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}

                  {activeDmPeer && (
                    <UserAvatar
                      name={activeDmPeer.display_name}
                      src={resolveContactAvatar(activeDmPeer)}
                      size="xs"
                      className="shrink-0"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-xs sm:text-sm font-bold text-[#0F172A] truncate">
                        {activeTitle}
                      </h3>
                      {activeDmPeer ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-[9.5px] font-semibold text-[#4C1D95] shrink-0">
                          <Lock className="w-2.5 h-2.5" />
                          <span>DM</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[9.5px] font-semibold text-emerald-700 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Group</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[10.5px] sm:text-[11px] text-slate-500 truncate mt-0.5">
                      {activeSubtitle}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {activeGroupRoom && (
                    <button
                      type="button"
                      onClick={() => setShowGroupMembers((v) => !v)}
                      title="Lihat daftar anggota sah grup ini"
                      className={`h-8 px-2 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors ${
                        showGroupMembers
                          ? 'bg-[#312E81] text-white border-[#312E81]'
                          : 'bg-white/90 hover:bg-indigo-50 text-[#312E81] border-indigo-100'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono tabular-nums">{activeGroupMembers.length}</span>
                    </button>
                  )}

                  {messages.length > 0 && (
                    <button
                      type="button"
                      disabled={clearingRoom}
                      onClick={() => setConfirmClearRoom((v) => !v)}
                      aria-label={`Bersihkan chat ${activeDmPeer ? 'individu' : 'group'}`}
                      title={`Bersihkan chat ${activeDmPeer ? 'individu' : 'group'}`}
                      className={`h-8 px-2.5 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                        confirmClearRoom
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white/90 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border-indigo-100 hover:border-rose-200'
                      }`}
                    >
                      <Eraser className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">Bersihkan</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Panel Daftar Anggota Grup (Verifikasi Keanggotaan Ketat) */}
              {activeGroupRoom && showGroupMembers && (
                <div className="px-3 sm:px-4 py-2.5 border-t border-indigo-100 bg-indigo-50/70 max-h-44 overflow-y-auto space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10.5px] font-bold text-[#312E81]">
                      Anggota {activeGroupRoom.label} ({activeGroupRoom.participantsLabel})
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowGroupMembers(false)}
                      className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {activeGroupMembers.map((member) => {
                      const mb = getRoleBadgeStyle(member.role, member.role_label);
                      return (
                        <div
                          key={`gm:${member.dedup_key || member.participant_id}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-white/90 border border-indigo-100/80 min-w-0"
                        >
                          <UserAvatar
                            name={member.display_name}
                            src={resolveContactAvatar(member)}
                            size="xs"
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-[#0F172A] truncate">
                              {member.display_name}
                              {member.isSelf ? ' (Anda)' : ''}
                            </p>
                            <p className="text-[9.5px] text-slate-500 truncate">
                              {mb.label}
                              {member.unit_label ? ` · ${member.unit_label}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {confirmClearRoom && messages.length > 0 && (
                <div className="px-3 sm:px-4 py-2 border-t border-rose-100 bg-rose-50/90 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-[11px] sm:text-xs font-semibold text-rose-800">
                    Bersihkan semua pesan di {activeDmPeer ? `DM dengan ${activeDmPeer.display_name}` : activeTitle}?
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={clearingRoom}
                      onClick={() => void handleClearActiveRoom('local')}
                      className="h-7 px-2.5 rounded-lg bg-white hover:bg-rose-100 border border-rose-200 text-[11px] font-semibold text-rose-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      {clearingRoom && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>{session.role === 'admin' ? 'Untuk Saya' : 'Ya, Bersihkan'}</span>
                    </button>

                    {session.role === 'admin' && (
                      <button
                        type="button"
                        disabled={clearingRoom}
                        onClick={() => void handleClearActiveRoom('server')}
                        className="h-7 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        {clearingRoom && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>Hapus Semua</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={clearingRoom}
                      onClick={() => setConfirmClearRoom(false)}
                      className="h-7 px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600 cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Daftar Pesan */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3.5 space-y-3 overscroll-contain">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4C1D95]" />
                  <p className="text-xs font-medium">Memuat percakapan...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-8 text-center px-4">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4C1D95]">
                    {activeDmPeer ? <User className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] mt-3">
                    Belum Ada Pesan {activeDmPeer ? `dengan ${activeDmPeer.display_name}` : `di ${activeTitle}`}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                    {activeDmPeer
                      ? `Pesan langsung 1-on-1 (${activeDmPeer.subtitle}) bersifat privat dan real-time.`
                      : `Anggota grup ini terbatas hanya untuk ${activeGroupRoom?.participantsLabel.toLowerCase() || 'peran terkait'}.`}
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine =
                    myMatchIds.has(normalizeChatParticipantId(msg.sender_id)) ||
                    myMatchIds.has(msg.sender_id);
                  const canDeleteThis = session.role === 'admin' || isMine;
                  const roleBadge = getRoleBadgeStyle(msg.sender_role);
                  const isConfirming = confirmDeleteId === msg.id;
                  const isDeletingThis = deletingId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}
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
                        className={`max-w-[85%] sm:max-w-[78%] flex flex-col min-w-0 ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                      >
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
                            <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                              {msg.sender_subtitle}
                            </span>
                          )}
                        </div>

                        <div
                          className={`group relative rounded-2xl px-3 py-2 text-xs sm:text-[13px] leading-relaxed shadow-xs border max-w-full ${
                            isMine
                              ? 'bg-gradient-to-tr from-[#312E81] via-[#3730A3] to-[#0284C7] text-white border-indigo-700/30 rounded-br-md'
                              : 'bg-white/95 text-[#0F172A] border-indigo-100/90 rounded-bl-md'
                          }`}
                        >
                          {msg.reply_preview && (
                            <div
                              className={`mb-1.5 px-2.5 py-1.5 rounded-xl text-[11px] border-l-2 leading-snug ${
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
                            className={`mt-1 flex items-center justify-between gap-3 text-[10px] ${
                              isMine ? 'text-sky-100/85' : 'text-slate-400'
                            }`}
                          >
                            <span className="font-mono tabular-nums">
                              {formatMessageTime(msg.created_at)}
                              {msg.is_local_only ? ' · Lokal' : ''}
                            </span>

                            <div className="flex items-center gap-1">
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
              className="p-2.5 sm:p-3.5 border-t border-indigo-100/80 bg-white/85 backdrop-blur-md space-y-2 shrink-0"
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
                  placeholder={`Tulis pesan ke ${activeTitle}...`}
                  className="flex-1 min-w-0 min-h-[40px] sm:min-h-[44px] max-h-24 resize-none rounded-2xl border border-indigo-200/80 bg-white/95 px-3 py-2 text-xs sm:text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  aria-label="Kirim pesan"
                  className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-2xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] hover:brightness-105 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
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
