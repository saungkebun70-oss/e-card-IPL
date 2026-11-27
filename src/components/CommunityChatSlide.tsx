import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  CornerUpLeft,
  Eraser,
  Home,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
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
  cancelChatUploadQueueItem,
  clearChatRoom,
  createChatUploadQueueItem,
  createRetryChatUploadQueueItem,
  deleteChatMessageForEveryone,
  editChatMessage,
  executeChatUploadQueueItem,
  fetchChatDirectory,
  fetchChatMessages,
  fetchChatUnreadSummary,
  fetchDmConversations,
  getAccessibleChatRooms,
  getChatParticipantId,
  getChatParticipantMatchIds,
  getGroupMembers,
  hideChatMessageForMe,
  isDmRoomId,
  isMessageClearedForRoom,
  isMessageHiddenForSession,
  markChatRoomRead,
  normalizeChatParticipantId,
  parseDmParticipants,
  sendChatMessage,
  sendChatMessagesWithUploadedAttachments,
  subscribeChatMessagesRealtime,
  subscribeChatTypingRoom,
  type ChatContact,
  type ChatMessage,
  type ChatRoomId,
  type DmThreadPreview,
  type GroupChatRoomId,
  type TypingIndicatorUser,
} from '../lib/chatService';
import {
  extractDriveFileIdFromAttachment,
  seedPrivateAttachmentBlobCache,
  type ChatMediaUploadResult,
} from '../lib/chatMediaUpload';
import { buildAvatarKey, useAvatarMap } from '../lib/avatarService';
import {
  CHAT_QUICK_ROOM_STORAGE_KEY,
  CHAT_QUICK_VIEW_STORAGE_KEY,
  validatePickedAttachment,
  type AttachmentPickerKind,
  type UploadQueueItem,
} from '../lib/chat/attachmentUtils';
import { compressChatImage } from '../lib/imageCompressor';
import { matchesBlockSearch } from '../lib/format';
import { UserAvatar } from './UserAvatar';
import { ChatAttachmentMenu } from './chat/ChatAttachmentMenu';
import { UploadProgress } from './chat/UploadProgress';
import { ChatMessageAttachmentBubble } from './chat/ChatMessageAttachmentBubble';
import { PrivateDrivePreviewModal } from './chat/PrivateDrivePreviewModal';

interface CommunityChatSlideProps {
  session: SessionUser;
  initialRoomId?: ChatRoomId | null;
  variant?: 'page' | 'floating';
  onAttachmentPickingChange?: (picking: boolean) => void;
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
      badgeClass: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
    };
  }
  if (role === 'petugas') {
    return {
      label: customLabel || 'Keamanan',
      badgeClass: 'bg-[#384E35]/15 text-[#243825] border-[#C6D2BF]',
    };
  }
  return {
    label: customLabel || 'Warga',
    badgeClass: 'bg-[#F2D8A7]/45 text-[#4A3410] border-[#E2C285]',
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
  onAttachmentPickingChange,
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
    try {
      if (typeof window !== 'undefined') {
        const storedRoom = window.sessionStorage.getItem(CHAT_QUICK_ROOM_STORAGE_KEY) as ChatRoomId | null;
        if (storedRoom && canAccessChatRoom(session, storedRoom)) {
          return storedRoom;
        }
      }
    } catch {
      // Abaikan jika sessionStorage tidak tersedia
    }
    return accessibleRooms[0]?.id || 'forum_umum';
  });
  const [primaryTab, setPrimaryTab] = useState<ChatPrimaryTab>(() => {
    if (initialRoomId) return isDmRoomId(initialRoomId) ? 'dm' : 'group';
    try {
      if (typeof window !== 'undefined') {
        const storedRoom = window.sessionStorage.getItem(CHAT_QUICK_ROOM_STORAGE_KEY);
        if (storedRoom) return isDmRoomId(storedRoom) ? 'dm' : 'group';
      }
    } catch {
      // Abaikan
    }
    return 'group';
  });
  const [contactSearch, setContactSearch] = useState('');
  const [contactRoleFilter, setContactRoleFilter] = useState<'semua' | UserRole>('semua');
  const [floatingView, setFloatingView] = useState<'list' | 'thread'>(() => {
    if (initialRoomId) return 'thread';
    try {
      if (typeof window !== 'undefined') {
        const savedView = window.sessionStorage.getItem(CHAT_QUICK_VIEW_STORAGE_KEY);
        if (savedView === 'thread' || savedView === 'list') {
          return savedView;
        }
      }
    } catch {
      // Abaikan
    }
    return 'list';
  });
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
  const [editingTarget, setEditingTarget] = useState<ChatMessage | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [expandedOriginalIds, setExpandedOriginalIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClearRoom, setConfirmClearRoom] = useState(false);
  const [clearingRoom, setClearingRoom] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [previewAttachmentMsg, setPreviewAttachmentMsg] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingIndicatorUser[]>([]);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const preEditDraftRef = useRef<string>('');
  const activeRoomIdRef = useRef<ChatRoomId>(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const uploadQueueRef = useRef<UploadQueueItem[]>(uploadQueue);
  uploadQueueRef.current = uploadQueue;
  const uploadPromisesRef = useRef<Map<string, Promise<ChatMediaUploadResult | null>>>(new Map());
  const handedOffPreviewUrlsRef = useRef<Set<string>>(new Set());
  const typingControllerRef = useRef<{
    sendTyping: (isTyping: boolean) => void;
    unsubscribe: () => void;
  } | null>(null);

  useEffect(() => {
    if (initialRoomId && canAccessChatRoom(session, initialRoomId)) {
      setActiveRoomId(initialRoomId);
      setPrimaryTab(isDmRoomId(initialRoomId) ? 'dm' : 'group');
      if (isFloating) setFloatingView('thread');
    }
  }, [initialRoomId, session, isFloating]);

  // Pertahankan ruang obrolan terakhir & view floating di sessionStorage agar tahan saat reload memori kamera Android
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && activeRoomId) {
        window.sessionStorage.setItem(CHAT_QUICK_ROOM_STORAGE_KEY, activeRoomId);
      }
    } catch {
      // Abaikan
    }
  }, [activeRoomId]);

  useEffect(() => {
    if (!isFloating) return;
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(CHAT_QUICK_VIEW_STORAGE_KEY, floatingView);
      }
    } catch {
      // Abaikan
    }
  }, [floatingView, isFloating]);

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

  const clearFailedUploads = useCallback(() => {
    setUploadQueue((prev) => prev.filter((item) => item.status !== 'failed'));
  }, []);

  const loadRoomMessages = useCallback(
    async (roomId: ChatRoomId, silent = false) => {
      clearFailedUploads();
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
    [session, syncDirectoriesAndUnread, scrollToBottom, clearFailedUploads]
  );

  useEffect(() => {
    setReplyTarget(null);
    setEditingTarget((prev) => {
      if (prev) setDraft('');
      return null;
    });
    preEditDraftRef.current = '';
    setExpandedOriginalIds({});
    setConfirmDeleteId(null);
    setConfirmClearRoom(false);
    setShowGroupMembers(false);
    setPreviewAttachmentMsg(null);
    // Batalkan antrean unggahan dari ruang sebelumnya & bersihkan error lama saat berpindah/memuat ruang
    uploadQueueRef.current.forEach((item) => {
      if (item.roomId !== activeRoomId && item.status === 'uploading') {
        item.abortController.abort();
      }
    });
    setUploadQueue((prev) =>
      prev.filter((item) => item.roomId === activeRoomId && item.status !== 'failed')
    );
    void loadRoomMessages(activeRoomId, false);
  }, [activeRoomId, loadRoomMessages]);

  useEffect(() => {
    return () => {
      uploadQueueRef.current.forEach((item) => {
        if (item.status === 'uploading') {
          item.abortController.abort();
        }
        if (item.localPreviewUrl && !handedOffPreviewUrlsRef.current.has(item.localPreviewUrl)) {
          try {
            URL.revokeObjectURL(item.localPreviewUrl);
          } catch {
            // Abaikan
          }
        }
      });
    };
  }, []);

  // Indikator real-time "Sedang Mengetik..." per ruang obrolan via Supabase Realtime Broadcast (tanpa menulis DB)
  useEffect(() => {
    setTypingUsers([]);
    const sub = subscribeChatTypingRoom(session, activeRoomId, (users) => {
      setTypingUsers(users);
    });
    typingControllerRef.current = sub;
    return () => {
      sub.unsubscribe();
      if (typingControllerRef.current === sub) {
        typingControllerRef.current = null;
      }
      setTypingUsers([]);
    };
  }, [session, activeRoomId]);

  // Realtime WebSocket + sinkronisasi lintas tab + sinkronisasi otomatis saat kembali aktif/online
  useEffect(() => {
    const unsub = subscribeChatMessagesRealtime(session, {
      onInsert: (incoming) => {
        if (
          isMessageClearedForRoom(session, incoming.room_id, incoming.created_at) ||
          isMessageHiddenForSession(session, incoming)
        ) {
          return;
        }
        if (incoming.room_id === activeRoomIdRef.current) {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === incoming.id);
            if (exists) {
              return prev.map((m) => (m.id === incoming.id ? incoming : m));
            }
            return [...prev, incoming].sort(
              (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
            );
          });
          markChatRoomRead(session, incoming.room_id, incoming.created_at);
          scrollToBottom('smooth');
        }
        void syncDirectoriesAndUnread();
      },
      onUpdate: (updated) => {
        if (
          isMessageClearedForRoom(session, updated.room_id, updated.created_at) ||
          isMessageHiddenForSession(session, updated)
        ) {
          setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          void syncDirectoriesAndUnread();
          return;
        }
        if (updated.room_id === activeRoomIdRef.current) {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === updated.id);
            if (!exists) {
              return [...prev, updated].sort(
                (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
              );
            }
            return prev.map((m) => (m.id === updated.id ? updated : m));
          });
        }
        void syncDirectoriesAndUnread();
      },
      onDelete: (deletedId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        setEditingTarget((prev) => {
          if (prev?.id === deletedId) {
            setDraft(preEditDraftRef.current);
            preEditDraftRef.current = '';
            return null;
          }
          return prev;
        });
        void syncDirectoriesAndUnread();
      },
      onClear: (clearedRoomId) => {
        if (clearedRoomId === activeRoomIdRef.current) {
          setMessages([]);
          setReplyTarget(null);
          setEditingTarget(null);
          preEditDraftRef.current = '';
          setConfirmClearRoom(false);
        }
        void syncDirectoriesAndUnread();
      },
      onAnyChange: () => {
        void syncDirectoriesAndUnread();
      },
    });

    const handleReconnectSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void loadRoomMessages(activeRoomIdRef.current, true);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleReconnectSync);
      document.addEventListener('visibilitychange', handleReconnectSync);
    }

    return () => {
      unsub();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleReconnectSync);
        document.removeEventListener('visibilitychange', handleReconnectSync);
      }
    };
  }, [session, syncDirectoriesAndUnread, scrollToBottom, loadRoomMessages]);

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

  const hasUploadingAttachments = useMemo(
    () => uploadQueue.some((item) => item.status === 'uploading'),
    [uploadQueue]
  );
  const hasFailedAttachments = useMemo(
    () => uploadQueue.some((item) => item.status === 'failed'),
    [uploadQueue]
  );
  const completedAttachments = useMemo(
    () => uploadQueue.filter((item) => item.status === 'completed' && item.result !== null),
    [uploadQueue]
  );

  const revokeUnusedPreviewUrl = useCallback((url?: string | null) => {
    if (!url || handedOffPreviewUrlsRef.current.has(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Abaikan
    }
  }, []);

  const patchUploadQueueItem = useCallback(
    (localId: string, updater: (prev: UploadQueueItem) => UploadQueueItem) => {
      setUploadQueue((prev) => prev.map((q) => (q.localId === localId ? updater(q) : q)));
    },
    []
  );

  const removeUploadQueueItem = useCallback(
    (localId: string) => {
      const target = uploadQueueRef.current.find((q) => q.localId === localId);
      revokeUnusedPreviewUrl(target?.localPreviewUrl);
      uploadPromisesRef.current.delete(localId);
      setUploadQueue((prev) => prev.filter((q) => q.localId !== localId));
    },
    [revokeUnusedPreviewUrl]
  );

  const runQueueUpload = useCallback(
    (item: UploadQueueItem, shouldCompressPhoto = false): Promise<ChatMediaUploadResult | null> => {
      const task = (async () => {
        let workingItem = item;
        if (shouldCompressPhoto && item.attachmentType === 'photo') {
          patchUploadQueueItem(item.localId, (prev) => ({
            ...prev,
            phaseLabel: 'Mengoptimalkan ukuran foto...',
          }));
          try {
            const compressed = await compressChatImage(item.file, 1600, 0.82);
            if (item.abortController.signal.aborted) {
              return null;
            }
            if (compressed.wasCompressed && compressed.file !== item.file) {
              workingItem = {
                ...item,
                file: compressed.file,
                totalBytes: compressed.file.size,
              };
              patchUploadQueueItem(item.localId, (prev) => ({
                ...prev,
                file: compressed.file,
                totalBytes: compressed.file.size,
              }));
            }
          } catch {
            // Lanjutkan dengan berkas asli bila kompresi dilewati
          }
        }

        const result = await executeChatUploadQueueItem({
          session,
          item: workingItem,
          onPatchItem: patchUploadQueueItem,
          onAborted: removeUploadQueueItem,
        });

        if (result && result.driveFileId && workingItem.localPreviewUrl) {
          handedOffPreviewUrlsRef.current.add(workingItem.localPreviewUrl);
          seedPrivateAttachmentBlobCache(
            session,
            result.driveFileId,
            workingItem.localPreviewUrl,
            result.mimeType || workingItem.file.type
          );
        } else if (result && result.driveFileId && workingItem.attachmentType === 'photo') {
          seedPrivateAttachmentBlobCache(
            session,
            result.driveFileId,
            workingItem.file,
            result.mimeType || workingItem.file.type
          );
        }

        return result;
      })();

      uploadPromisesRef.current.set(item.localId, task);
      return task;
    },
    [session, patchUploadQueueItem, removeUploadQueueItem]
  );

  const handleSelectAttachmentFiles = useCallback(
    (files: File[], kind: AttachmentPickerKind) => {
      // Bersihkan otomatis kotak error & antrean gagal lama ketika pengguna memilih file baru
      clearFailedUploads();
      const targetRoomId = activeRoomIdRef.current;
      const newEntries: Array<{ item: UploadQueueItem; compressPhoto: boolean }> = [];

      for (const file of files) {
        const check = validatePickedAttachment(file, kind);
        if (check.valid === false) {
          onToast?.('error', check.error);
          continue;
        }
        const isPhotoAttachment = check.resolvedType === 'photo';
        let localPreviewUrl: string | null = null;
        if (isPhotoAttachment && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          try {
            localPreviewUrl = URL.createObjectURL(file);
          } catch {
            localPreviewUrl = null;
          }
        }
        const item = createChatUploadQueueItem({
          roomId: targetRoomId,
          file,
          pickerKind: kind,
          attachmentType: check.resolvedType,
          localPreviewUrl,
        });
        newEntries.push({
          item,
          compressPhoto: isPhotoAttachment && (kind === 'camera' || kind === 'photo'),
        });
      }

      if (newEntries.length === 0) return;

      const itemsOnly = newEntries.map((entry) => entry.item);
      setUploadQueue((prev) => [...prev.filter((item) => item.status !== 'failed'), ...itemsOnly]);
      newEntries.forEach(({ item, compressPhoto }) => {
        void runQueueUpload(item, compressPhoto);
      });
    },
    [onToast, runQueueUpload, clearFailedUploads]
  );

  const handleCancelUpload = useCallback(
    (localId: string) => {
      const target = uploadQueueRef.current.find((q) => q.localId === localId);
      cancelChatUploadQueueItem(target);
      removeUploadQueueItem(localId);
    },
    [removeUploadQueueItem]
  );

  const handleRetryUpload = useCallback(
    (localId: string) => {
      const target = uploadQueueRef.current.find((q) => q.localId === localId);
      if (!target) return;
      const restarted = createRetryChatUploadQueueItem(target);
      setUploadQueue((prev) => prev.map((q) => (q.localId === localId ? restarted : q)));
      const shouldCompress =
        restarted.attachmentType === 'photo' &&
        (restarted.pickerKind === 'camera' || restarted.pickerKind === 'photo');
      void runQueueUpload(restarted, shouldCompress);
    },
    [runQueueUpload]
  );

  const handleRemoveUploadItem = useCallback(
    (localId: string) => {
      removeUploadQueueItem(localId);
    },
    [removeUploadQueueItem]
  );

  const startEditingMessage = (msg: ChatMessage) => {
    if (sending || savingEdit || msg.id.startsWith('optimistic-')) return;
    if (!editingTarget) {
      preEditDraftRef.current = draft;
    }
    setReplyTarget(null);
    setConfirmDeleteId(null);
    setEditingTarget(msg);

    const effectiveDriveId = extractDriveFileIdFromAttachment(msg);
    const hasAttachment =
      (Boolean(msg.attachment_type) && msg.attachment_type !== 'none') ||
      Boolean(effectiveDriveId) ||
      Boolean(msg.attachment_url) ||
      Boolean(msg.drive_web_view_link);
    const trimmedMessage = msg.message.trim();
    const isAutoLabel =
      (msg.attachment_name &&
        (trimmedMessage === `[Foto] ${msg.attachment_name}` ||
          trimmedMessage === `[Video] ${msg.attachment_name}` ||
          trimmedMessage === `[Dokumen] ${msg.attachment_name}` ||
          trimmedMessage === `[File] ${msg.attachment_name}`)) ||
      (!trimmedMessage.includes('\n') &&
        /^\[(foto|video|dokumen|file)\]\s+\S.+$/i.test(trimmedMessage));

    setDraft(hasAttachment && isAutoLabel ? '' : msg.message);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const cancelEditingMessage = () => {
    if (savingEdit) return;
    setEditingTarget(null);
    setDraft(preEditDraftRef.current);
    preEditDraftRef.current = '';
    typingControllerRef.current?.sendTyping(false);
  };

  const handleSaveEditedMessage = async () => {
    if (!editingTarget || savingEdit) return;
    const target = editingTarget;
    const cleanText = draft.trim();
    if (!cleanText) {
      onToast?.('error', 'Isi pesan edit tidak boleh kosong.');
      return;
    }
    if (cleanText === target.message) {
      cancelEditingMessage();
      return;
    }

    setSavingEdit(true);
    typingControllerRef.current?.sendTyping(false);

    try {
      const { message: updatedMsg } = await editChatMessage(session, target, cleanText);
      setMessages((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, ...updatedMsg } : m))
      );
      setEditingTarget(null);
      setDraft(preEditDraftRef.current);
      preEditDraftRef.current = '';
      void syncDirectoriesAndUnread();
      onToast?.('success', 'Pesan berhasil diperbarui.');
      inputRef.current?.focus();
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal memperbarui pesan.'
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (editingTarget) {
      await handleSaveEditedMessage();
      return;
    }
    const cleanText = draft.trim();
    if (sending) return;

    if (hasFailedAttachments) {
      onToast?.('error', 'Ada lampiran gagal diunggah. Pilih Coba Lagi atau Hapus terlebih dahulu.');
      return;
    }

    const readyItems = completedAttachments;
    const uploadingItems = uploadQueue.filter((item) => item.status === 'uploading');
    if (!cleanText && readyItems.length === 0 && uploadingItems.length === 0) return;

    typingControllerRef.current?.sendTyping(false);

    const targetRoomId = activeRoomId;
    const replyToId = replyTarget?.id || null;
    const replyPreview = replyTarget
      ? `${replyTarget.sender_name}: ${replyTarget.message.slice(0, 90)}`
      : null;

    const recipientPayload = activeDmPeer
      ? {
          participant_id: activeDmPeer.participant_id,
          display_name: activeDmPeer.display_name,
          role: activeDmPeer.role,
        }
      : null;

    setSending(true);
    setDraft('');
    setReplyTarget(null);

    try {
      if (readyItems.length === 0 && uploadingItems.length === 0) {
        const { message } = await sendChatMessage(session, {
          room_id: targetRoomId,
          message: cleanText,
          reply_to_id: replyToId,
          reply_preview: replyPreview,
          recipient: recipientPayload,
        });

        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      } else {
        if (readyItems.length > 0) {
          const sentIds = new Set<string>();
          readyItems.forEach((item) => {
            if (item.localPreviewUrl) {
              handedOffPreviewUrlsRef.current.add(item.localPreviewUrl);
            }
          });
          await sendChatMessagesWithUploadedAttachments({
            session,
            roomId: targetRoomId,
            items: readyItems,
            caption: cleanText,
            replyToId,
            replyPreview,
            recipient: recipientPayload,
            onMessageSent: (message, localId) => {
              sentIds.add(localId);
              const matchedItem = readyItems.find((i) => i.localId === localId);
              const enrichedMsg: ChatMessage = matchedItem?.localPreviewUrl
                ? { ...message, local_preview_url: matchedItem.localPreviewUrl }
                : message;
              setMessages((prev) => {
                if (prev.some((m) => m.id === enrichedMsg.id)) return prev;
                return [...prev, enrichedMsg];
              });
            },
          });
          setUploadQueue((prev) => prev.filter((q) => !sentIds.has(q.localId)));
        }

        if (uploadingItems.length > 0) {
          const uploadingIds = new Set(uploadingItems.map((u) => u.localId));
          setUploadQueue((prev) => prev.filter((q) => !uploadingIds.has(q.localId)));

          uploadingItems.forEach((uItem, idx) => {
            const optimisticId = `optimistic-${uItem.localId}`;
            const fallbackLabel =
              uItem.attachmentType === 'video'
                ? `[Video] ${uItem.file.name}`
                : uItem.attachmentType === 'photo'
                  ? `[Foto] ${uItem.file.name}`
                  : `[Dokumen] ${uItem.file.name}`;
            const useCaption = readyItems.length === 0 && idx === 0 && Boolean(cleanText);
            const msgBody = useCaption ? cleanText : fallbackLabel;
            const useReply = readyItems.length === 0 && idx === 0;

            if (uItem.localPreviewUrl) {
              handedOffPreviewUrlsRef.current.add(uItem.localPreviewUrl);
            }

            const optimisticMsg: ChatMessage = {
              id: optimisticId,
              room_id: targetRoomId,
              sender_role: session.role,
              sender_id: myParticipantId,
              sender_name: session.nama_warga,
              sender_subtitle: '',
              sender_avatar_url: session.avatar_url || null,
              recipient_id: recipientPayload?.participant_id || null,
              recipient_name: recipientPayload?.display_name || null,
              recipient_role: recipientPayload?.role || null,
              message: msgBody,
              reply_to_id: useReply ? replyToId : null,
              reply_preview: useReply ? replyPreview : null,
              created_at: new Date().toISOString(),
              is_local_only: true,
              attachment_type: uItem.attachmentType,
              attachment_name: uItem.file.name,
              attachment_mime: uItem.file.type || null,
              attachment_size_bytes: uItem.file.size,
              attachment_storage_provider: 'google_drive',
              attachment_status:
                uItem.attachmentType === 'photo' && uItem.localPreviewUrl
                  ? 'ready'
                  : uItem.attachmentType === 'video'
                    ? 'uploading_video'
                    : 'pending_transfer',
              local_preview_url: uItem.localPreviewUrl ?? null,
              local_upload_local_id: uItem.localId,
            };

            setMessages((prev) => [...prev, optimisticMsg]);

            const pendingPromise = uploadPromisesRef.current.get(uItem.localId);
            void (async () => {
              try {
                const upload = pendingPromise ? await pendingPromise : null;
                uploadPromisesRef.current.delete(uItem.localId);
                if (!upload) {
                  setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                  if (!uItem.abortController.signal.aborted) {
                    onToast?.('error', `Gagal mengunggah ${uItem.file.name}.`);
                  }
                  return;
                }

                if (upload.driveFileId && uItem.localPreviewUrl) {
                  seedPrivateAttachmentBlobCache(
                    session,
                    upload.driveFileId,
                    uItem.localPreviewUrl,
                    upload.mimeType || uItem.file.type
                  );
                }

                const { message: sentMessage } = await sendChatMessage(session, {
                  room_id: targetRoomId,
                  message: useCaption
                    ? cleanText
                    : upload.attachmentType === 'video'
                      ? `[Video] ${upload.fileName}`
                      : upload.attachmentType === 'photo'
                        ? `[Foto] ${upload.fileName}`
                        : `[Dokumen] ${upload.fileName}`,
                  reply_to_id: useReply ? replyToId : null,
                  reply_preview: useReply ? replyPreview : null,
                  recipient: recipientPayload,
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

                const hydratedSent: ChatMessage = uItem.localPreviewUrl
                  ? { ...sentMessage, local_preview_url: uItem.localPreviewUrl }
                  : sentMessage;

                setMessages((prev) => {
                  const alreadyInserted = prev.some((m) => m.id === hydratedSent.id);
                  if (alreadyInserted) {
                    return prev
                      .filter((m) => m.id !== optimisticId)
                      .map((m) =>
                        m.id === hydratedSent.id && uItem.localPreviewUrl
                          ? { ...m, local_preview_url: uItem.localPreviewUrl }
                          : m
                      );
                  }
                  const hasOptimistic = prev.some((m) => m.id === optimisticId);
                  return hasOptimistic
                    ? prev.map((m) => (m.id === optimisticId ? hydratedSent : m))
                    : [...prev, hydratedSent];
                });
                void syncDirectoriesAndUnread();
              } catch (err) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                onToast?.(
                  'error',
                  err instanceof Error ? err.message : `Gagal mengirim ${uItem.file.name}.`
                );
              }
            })();
          });
        }
      }

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

  const handleHideMessageForMe = async (msg: ChatMessage) => {
    if (deletingId) return;
    setDeletingId(msg.id);
    try {
      await hideChatMessageForMe(session, msg);
      setMessages((prev) => prev.filter((item) => item.id !== msg.id));
      if (previewAttachmentMsg?.id === msg.id) {
        setPreviewAttachmentMsg(null);
      }
      setConfirmDeleteId(null);
      void syncDirectoriesAndUnread();
      onToast?.('info', 'Pesan dihapus untuk Anda. Peserta lain tetap dapat melihatnya.');
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Gagal menghapus pesan untuk Anda.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteMessageForEveryone = async (msg: ChatMessage) => {
    if (deletingId) return;
    setDeletingId(msg.id);
    try {
      await deleteChatMessageForEveryone(session, msg);
      setMessages((prev) => prev.filter((item) => item.id !== msg.id));
      if (previewAttachmentMsg?.id === msg.id) {
        setPreviewAttachmentMsg(null);
      }
      setConfirmDeleteId(null);
      void syncDirectoriesAndUnread();
      onToast?.('info', 'Pesan dihapus untuk semua peserta.');
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Gagal menghapus pesan untuk semua.');
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
    if (e.key === 'Escape' && editingTarget) {
      e.preventDefault();
      cancelEditingMessage();
      return;
    }
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

  // Deduplikasi ganda & filter pencarian kontak DM berdasarkan Peran, Nama, Blok/Nomor Rumah (toleran nol di depan)
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const seen = new Set<string>();
    const result: ChatContact[] = [];

    for (const c of contacts) {
      if (contactRoleFilter !== 'semua' && c.role !== contactRoleFilter) continue;
      if (q) {
        const hay = `${c.display_name} ${c.subtitle} ${c.role_label || ''} ${c.unit_label || ''} ${c.blok_or_code}`.toLowerCase();
        const blockMatched =
          matchesBlockSearch(c.blok_or_code, contactSearch) ||
          matchesBlockSearch(c.unit_label || '', contactSearch);
        if (!hay.includes(q) && !blockMatched) continue;
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
            : 'bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-[0_12px_32px_-10px_rgba(27,39,27,0.08)] w-full max-w-full min-w-0'
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
                ? 'flex-1 min-h-0 flex-col bg-[#FFFDF8]/70 w-full min-w-0 overflow-hidden'
                : 'shrink-0 md:shrink md:min-h-0 border-b md:border-b-0 md:border-r border-[#E6E2D6] bg-[#F6F3EA]/50 flex flex-col w-full min-w-0 overflow-hidden'
            }`}
          >
            {/* div:nth-of-type(1) — Header + Tab Utama: DM | Group */}
            <div className="px-3 py-2.5 sm:px-3.5 sm:py-3 border-b border-[#E6E2D6] space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-[#2B3F29] text-[#FFFDF8] flex items-center justify-center shrink-0 shadow-xs">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xs sm:text-sm font-bold text-[#1B271B] leading-tight truncate">
                      Pesan &amp; Koordinasi
                    </h2>
                    <p className="text-[10.5px] text-[#6E786D] truncate">
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
                  className="h-8 w-8 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] flex items-center justify-center cursor-pointer transition-colors shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Tab Utama 2 Pilihan: DM | Group */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F6F3EA] border border-[#E6E2D6]">
                <button
                  type="button"
                  onClick={() => setPrimaryTab('dm')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    primaryTab === 'dm'
                      ? 'bg-[#FFFDF8] text-[#243825] shadow-2xs ring-1 ring-[#C6D2BF]'
                      : 'text-[#4A554A] hover:text-[#243825]'
                  }`}
                >
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>DM</span>
                  {totalPersonalUnread > 0 && (
                    <span className="min-w-[18px] h-4 px-1 rounded-full bg-[#C87058] text-white text-[9.5px] font-mono font-bold inline-flex items-center justify-center tabular-nums shrink-0">
                      {totalPersonalUnread > 99 ? '99+' : totalPersonalUnread}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setPrimaryTab('group')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    primaryTab === 'group'
                      ? 'bg-[#FFFDF8] text-[#243825] shadow-2xs ring-1 ring-[#C6D2BF]'
                      : 'text-[#4A554A] hover:text-[#243825]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>Group ({accessibleRooms.length})</span>
                  {totalGroupUnread > 0 && (
                    <span className="min-w-[18px] h-4 px-1 rounded-full bg-[#C87058] text-white text-[9.5px] font-mono font-bold inline-flex items-center justify-center tabular-nums shrink-0">
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
                      <Search className="w-3.5 h-3.5 text-[#6E786D] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Cari nama, blok B3/7, atau jabatan..."
                        className="w-full min-h-[36px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] pl-8 pr-2.5 text-xs text-[#1B271B] placeholder:text-[#6E786D] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
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
                              ? 'bg-[#2B3F29] text-[#FFFDF8]'
                              : 'bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/60'
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
                      <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-[#6E786D]">
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
                                ? 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825] shadow-2xs'
                                : 'bg-[#FFFDF8] hover:bg-[#F6F3EA] border-[#E6E2D6] hover:border-[#C6D2BF] text-[#1B271B]'
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
                                <p className="text-xs font-bold leading-tight truncate text-[#1B271B]">
                                  {thread.peer_name}
                                </p>
                                {unread > 0 && !isActive && (
                                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#C87058] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums shrink-0">
                                    {unread > 99 ? '99+' : unread}
                                  </span>
                                )}
                              </div>
                              <p className="flex items-center gap-1.5 text-[10.5px] text-[#6E786D] truncate mt-0.5">
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
                    <p className="px-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6E786D]">
                      Daftar Penerima DM ({filteredContacts.length})
                    </p>
                    {filteredContacts.length === 0 ? (
                      <p className="text-xs text-[#6E786D] py-6 text-center">
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
                                ? 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
                                : 'bg-[#FFFDF8] hover:bg-[#F6F3EA] border-[#E6E2D6]'
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
                                <p className="text-xs font-bold text-[#1B271B] truncate">
                                  {contact.display_name}
                                </p>
                                {contact.unit_label && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-[#F6F3EA] border border-[#E6E2D6] font-mono text-[9.5px] font-bold text-[#243825] shrink-0 whitespace-nowrap">
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
                                <span className="text-[10.5px] text-[#6E786D] truncate">
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
                  <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-[#6E786D]">
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
                            ? 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825] shadow-2xs'
                            : 'bg-[#FFFDF8] hover:bg-[#F6F3EA] border-[#E6E2D6] hover:border-[#C6D2BF] text-[#1B271B]'
                        }`}
                      >
                        <span
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isActive
                              ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                              : 'bg-[#E5EEE3] text-[#243825]'
                          }`}
                        >
                          <RoomIcon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <p className="text-xs font-bold leading-tight truncate text-[#1B271B]">
                              {room.label}
                            </p>
                            {unread > 0 && !isActive && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#C87058] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums shrink-0">
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1.5 mt-0.5 min-w-0">
                            <p className="text-[10.5px] text-[#6E786D] truncate">
                              {room.participantsLabel}
                            </p>
                            <span className="text-[10px] font-mono font-semibold text-[#384E35] shrink-0 tabular-nums">
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
            } flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-[#F6F3EA]/45`}
          >
            {/* Header Ruang Group / DM Aktif */}
            <div className="border-b border-[#E6E2D6] bg-[#FFFDF8]/90 backdrop-blur-md shrink-0 min-w-0">
              <div className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isFloating && (
                    <button
                      type="button"
                      onClick={() => setFloatingView('list')}
                      aria-label="Kembali ke daftar chat"
                      className="h-8 w-8 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0 cursor-pointer"
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
                      <h3 className="text-xs sm:text-sm font-bold text-[#1B271B] truncate">
                        {activeTitle}
                      </h3>
                      {activeDmPeer ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[9.5px] font-semibold text-[#243825] shrink-0">
                          <Lock className="w-2.5 h-2.5" />
                          <span>DM</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[9.5px] font-semibold text-[#243825] shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2B3F29]" />
                          <span>Group</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[10.5px] sm:text-[11px] text-[#6E786D] truncate mt-0.5">
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
                          ? 'bg-[#2B3F29] text-[#FFFDF8] border-[#2B3F29]'
                          : 'bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] border-[#E6E2D6]'
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
                          ? 'bg-[#C87058] text-white border-[#C87058]'
                          : 'bg-[#FFFDF8] hover:bg-[#C87058]/10 text-[#4A554A] hover:text-[#9A422B] border-[#E6E2D6] hover:border-[#E2A898]'
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
                <div className="px-3 sm:px-4 py-2.5 border-t border-[#E6E2D6] bg-[#F6F3EA] max-h-44 overflow-y-auto space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10.5px] font-bold text-[#243825]">
                      Anggota {activeGroupRoom.label} ({activeGroupRoom.participantsLabel})
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowGroupMembers(false)}
                      className="text-[10.5px] font-semibold text-[#6E786D] hover:text-[#1B271B] cursor-pointer"
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
                          className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-[#FFFDF8] border border-[#E6E2D6] min-w-0"
                        >
                          <UserAvatar
                            name={member.display_name}
                            src={resolveContactAvatar(member)}
                            size="xs"
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-[#1B271B] truncate">
                              {member.display_name}
                              {member.isSelf ? ' (Anda)' : ''}
                            </p>
                            <p className="text-[9.5px] text-[#6E786D] truncate">
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
                <div className="px-3 sm:px-4 py-2 border-t border-[#E2A898] bg-[#C87058]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-[11px] sm:text-xs font-semibold text-[#7A311E]">
                    Bersihkan semua pesan di {activeDmPeer ? `DM dengan ${activeDmPeer.display_name}` : activeTitle}?
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={clearingRoom}
                      onClick={() => void handleClearActiveRoom('local')}
                      className="h-7 px-2.5 rounded-lg bg-[#FFFDF8] hover:bg-[#C87058]/15 border border-[#E2A898] text-[11px] font-semibold text-[#9A422B] inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      {clearingRoom && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>{session.role === 'admin' ? 'Untuk Saya' : 'Ya, Bersihkan'}</span>
                    </button>

                    {session.role === 'admin' && (
                      <button
                        type="button"
                        disabled={clearingRoom}
                        onClick={() => void handleClearActiveRoom('server')}
                        className="h-7 px-2.5 rounded-lg bg-[#C87058] hover:bg-[#B25C45] text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        {clearingRoom && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>Hapus Semua</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={clearingRoom}
                      onClick={() => setConfirmClearRoom(false)}
                      className="h-7 px-2.5 rounded-lg bg-[#FFFDF8] hover:bg-[#F6F3EA] border border-[#E6E2D6] text-[11px] font-semibold text-[#4A554A] cursor-pointer"
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
                <div className="h-full flex flex-col items-center justify-center py-10 text-[#6E786D] gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#2B3F29]" />
                  <p className="text-xs font-medium">Memuat percakapan...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-8 text-center px-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] flex items-center justify-center text-[#243825]">
                    {activeDmPeer ? <User className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold text-[#1B271B] mt-3">
                    Belum Ada Pesan {activeDmPeer ? `dengan ${activeDmPeer.display_name}` : `di ${activeTitle}`}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-[#6E786D] mt-1 max-w-sm leading-relaxed">
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
                  const canDeleteForEveryone = session.role === 'admin' || isMine;
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
                          <span className="text-[11px] font-bold text-[#1B271B]">
                            {isMine ? 'Anda' : msg.sender_name}
                          </span>
                          <span
                            className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-md border leading-none ${roleBadge.badgeClass}`}
                          >
                            {roleBadge.label}
                          </span>
                          {!isMine && msg.sender_subtitle && (
                            <span className="text-[10px] text-[#6E786D] truncate max-w-[140px]">
                              {msg.sender_subtitle}
                            </span>
                          )}
                        </div>

                        <div
                          className={`group relative rounded-2xl px-3 py-2 text-xs sm:text-[13px] leading-relaxed shadow-xs border max-w-full min-w-0 overflow-hidden transition-shadow ${
                            isMine
                              ? 'bg-gradient-to-tr from-[#243825] via-[#2B3F29] to-[#384E35] text-[#FFFDF8] border-[#243825]/30 rounded-br-md'
                              : 'bg-[#FFFDF8] text-[#1B271B] border-[#E6E2D6] rounded-bl-md'
                          } ${
                            editingTarget?.id === msg.id ? 'ring-2 ring-[#F2D8A7]' : ''
                          }`}
                        >
                          {msg.reply_preview && (
                            <div
                              className={`mb-1.5 px-2.5 py-1.5 rounded-xl text-[11px] border leading-snug ${
                                isMine
                                  ? 'bg-white/15 border-[#E5EEE3]/35 text-[#FFFDF8]'
                                  : 'bg-[#F6F3EA] border-[#E6E2D6] text-[#4A554A]'
                              }`}
                            >
                              {msg.reply_preview}
                            </div>
                          )}

                          <ChatMessageAttachmentBubble
                            session={session}
                            message={msg}
                            isMine={isMine}
                            onOpenAttachment={setPreviewAttachmentMsg}
                          />

                          {(() => {
                            const effectiveDriveId = extractDriveFileIdFromAttachment(msg);
                            const hasAttachment =
                              (Boolean(msg.attachment_type) && msg.attachment_type !== 'none') ||
                              Boolean(effectiveDriveId) ||
                              Boolean(msg.attachment_url) ||
                              Boolean(msg.drive_web_view_link);
                            const trimmedMessage = msg.message.trim();
                            const autoLabel =
                              (msg.attachment_name &&
                                (trimmedMessage === `[Foto] ${msg.attachment_name}` ||
                                  trimmedMessage === `[Video] ${msg.attachment_name}` ||
                                  trimmedMessage === `[Dokumen] ${msg.attachment_name}` ||
                                  trimmedMessage === `[File] ${msg.attachment_name}`)) ||
                              (!trimmedMessage.includes('\n') &&
                                /^\[(foto|video|dokumen|file)\]\s+\S.+$/i.test(trimmedMessage));
                            if (hasAttachment && autoLabel) return null;
                            return <p className="whitespace-pre-wrap break-words">{msg.message}</p>;
                          })()}

                          {msg.is_edited &&
                            msg.original_content &&
                            expandedOriginalIds[msg.id] && (
                              <div
                                className={`mt-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] leading-snug space-y-0.5 ${
                                  isMine
                                    ? 'bg-white/12 border-white/25 text-[#FFFDF8]'
                                    : 'bg-[#F6F3EA] border-[#E6E2D6] text-[#4A554A]'
                                }`}
                              >
                                <p
                                  className={`text-[10px] font-semibold ${
                                    isMine ? 'text-[#E5EEE3]/90' : 'text-[#6E786D]'
                                  }`}
                                >
                                  Pesan asli sebelum diedit
                                  {msg.edited_at
                                    ? ` · ${formatMessageTime(msg.edited_at)}`
                                    : ''}
                                </p>
                                <p className="whitespace-pre-wrap break-words opacity-95">
                                  {msg.original_content}
                                </p>
                              </div>
                            )}

                          <div
                            className={`mt-1 flex items-center justify-between gap-3 text-[10px] ${
                              isMine ? 'text-[#E5EEE3]/85' : 'text-[#6E786D]'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span className="font-mono tabular-nums">
                                {formatMessageTime(msg.created_at)}
                                {msg.is_local_only ? ' · Lokal' : ''}
                              </span>
                              {msg.is_edited && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  {msg.original_content ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedOriginalIds((prev) => ({
                                          ...prev,
                                          [msg.id]: !prev[msg.id],
                                        }))
                                      }
                                      aria-expanded={Boolean(expandedOriginalIds[msg.id])}
                                      title="Lihat isi pesan asli sebelum diedit"
                                      className={`font-medium underline decoration-dotted underline-offset-2 cursor-pointer transition-opacity hover:opacity-100 ${
                                        isMine
                                          ? 'text-[#E5EEE3]'
                                          : 'text-[#6E786D] hover:text-[#243825]'
                                      }`}
                                    >
                                      {expandedOriginalIds[msg.id] ? 'Tutup riwayat' : 'Diedit'}
                                    </button>
                                  ) : (
                                    <span className="italic">Diedit</span>
                                  )}
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingTarget) {
                                    setEditingTarget(null);
                                    setDraft(preEditDraftRef.current);
                                    preEditDraftRef.current = '';
                                  }
                                  setReplyTarget(msg);
                                  inputRef.current?.focus();
                                }}
                                aria-label="Balas pesan"
                                title="Balas pesan ini"
                                className={`p-1 rounded-md transition-colors cursor-pointer ${
                                  isMine
                                    ? 'hover:bg-white/15 text-[#E5EEE3]'
                                    : 'hover:bg-[#E5EEE3] text-[#6E786D] hover:text-[#243825]'
                                }`}
                              >
                                <CornerUpLeft className="w-3 h-3" />
                              </button>

                              {isMine && !msg.id.startsWith('optimistic-') && !isConfirming && (
                                <button
                                  type="button"
                                  disabled={savingEdit || isDeletingThis}
                                  onClick={() => startEditingMessage(msg)}
                                  aria-label="Edit pesan"
                                  title="Edit pesan ini"
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    editingTarget?.id === msg.id
                                      ? 'bg-white/25 text-[#FFFDF8]'
                                      : 'hover:bg-white/15 text-[#E5EEE3]'
                                  }`}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}

                              {!isConfirming && (
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => setConfirmDeleteId(msg.id)}
                                  aria-label="Hapus pesan"
                                  title={
                                    canDeleteForEveryone
                                      ? 'Hapus untuk Saya atau Semua'
                                      : 'Hapus untuk Saya'
                                  }
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    isMine
                                      ? 'hover:bg-white/15 text-[#E5EEE3] hover:text-[#F2D8A7]'
                                      : 'hover:bg-[#C87058]/10 text-[#6E786D] hover:text-[#9A422B]'
                                  }`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {isConfirming && (
                            <div
                              className={`mt-2 pt-2 border-t flex flex-wrap items-center justify-end gap-1.5 text-[10.5px] ${
                                isMine ? 'border-white/20' : 'border-[#E6E2D6]'
                              }`}
                            >
                              <span
                                className={`w-full text-right text-[10px] font-semibold ${
                                  isMine ? 'text-[#E5EEE3]' : 'text-[#4A554A]'
                                }`}
                              >
                                {canDeleteForEveryone
                                  ? 'Pilih cara menghapus pesan:'
                                  : 'Hapus dari layar Anda saja?'}
                              </span>

                              <button
                                type="button"
                                disabled={isDeletingThis}
                                onClick={() => void handleHideMessageForMe(msg)}
                                className={`px-2.5 py-1 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 transition-colors ${
                                  isMine
                                    ? 'bg-[#FFFDF8] hover:bg-white text-[#243825]'
                                    : 'bg-[#C87058] hover:bg-[#B25C45] text-white'
                                }`}
                              >
                                {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                <span>Hapus untuk Saya</span>
                              </button>

                              {canDeleteForEveryone && (
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => void handleDeleteMessageForEveryone(msg)}
                                  className="px-2.5 py-1 rounded-lg bg-[#C87058] hover:bg-[#B25C45] text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 transition-colors"
                                >
                                  {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                  <span>Hapus untuk Semua</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={isDeletingThis}
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded-lg bg-[#FFFDF8] text-[#4A554A] font-semibold border border-[#E6E2D6] hover:bg-[#F6F3EA] cursor-pointer"
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
              className="p-2.5 sm:p-3.5 border-t border-[#E6E2D6] bg-[#FFFDF8]/95 backdrop-blur-md space-y-2 shrink-0 min-w-0"
            >
              {editingTarget && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#F2D8A7]/40 border border-[#E2C285] text-xs min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-bold text-[#4A3410] truncate flex items-center gap-1.5">
                      <Pencil className="w-3 h-3 shrink-0" />
                      <span>Mengedit pesan</span>
                    </p>
                    <p className="text-[11px] text-[#6E4D12] truncate">{editingTarget.message}</p>
                  </div>
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={cancelEditingMessage}
                    aria-label="Batalkan edit pesan"
                    className="p-1.5 rounded-lg text-[#6E4D12] hover:text-[#4A3410] hover:bg-[#F2D8A7]/60 cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {replyTarget && !editingTarget && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#E5EEE3]/70 border border-[#C6D2BF] text-xs min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-bold text-[#243825] truncate">
                      Membalas {replyTarget.sender_name}
                    </p>
                    <p className="text-[11px] text-[#4A554A] truncate">{replyTarget.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Batalkan balasan"
                    className="p-1 rounded-lg text-[#6E786D] hover:text-[#1B271B] hover:bg-[#FFFDF8] cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Indikator Real-Time "Sedang Mengetik..." */}
              {typingUsers.length > 0 && (
                <div
                  aria-live="polite"
                  className="flex items-center gap-2 px-2 py-0.5 text-[11px] font-medium text-[#2B3F29] min-w-0"
                >
                  <span className="inline-flex items-center gap-1 shrink-0" aria-hidden="true">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#243825] animate-bounce"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#384E35] animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#243825] animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                  </span>
                  <span className="truncate">
                    {isDmRoomId(activeRoomId)
                      ? 'Sedang mengetik...'
                      : typingUsers.length === 1
                        ? `${typingUsers[0].senderName}${
                            typingUsers[0].senderBadge ? ` (${typingUsers[0].senderBadge})` : ''
                          } sedang mengetik...`
                        : `${typingUsers[0].senderName}${
                            typingUsers[0].senderBadge ? ` (${typingUsers[0].senderBadge})` : ''
                          } dan ${typingUsers.length - 1} lainnya sedang mengetik...`}
                  </span>
                </div>
              )}

              <UploadProgress
                items={uploadQueue}
                onCancel={handleCancelUpload}
                onRetry={handleRetryUpload}
                onRemove={handleRemoveUploadItem}
              />

              {(hasUploadingAttachments || hasFailedAttachments) && (
                <p
                  className={`text-[10.5px] font-medium px-1 ${
                    hasFailedAttachments ? 'text-[#9A422B]' : 'text-[#2B3F29]'
                  }`}
                >
                  {hasFailedAttachments
                    ? 'Perbaiki atau hapus unggahan yang gagal sebelum mengirim pesan.'
                    : 'Mengunggah lampiran... Anda dapat langsung menekan Kirim.'}
                </p>
              )}

              <div className="flex items-end gap-1.5 sm:gap-2 min-w-0">
                <ChatAttachmentMenu
                  disabled={sending || savingEdit || Boolean(editingTarget)}
                  onSelectFiles={handleSelectAttachmentFiles}
                  onPickingStateChange={onAttachmentPickingChange}
                />

                <textarea
                  ref={inputRef}
                  rows={1}
                  maxLength={1000}
                  value={draft}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setDraft(nextVal);
                    if (!editingTarget) {
                      typingControllerRef.current?.sendTyping(Boolean(nextVal.trim()));
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    editingTarget
                      ? 'Ubah isi pesan...'
                      : completedAttachments.length > 0 || hasUploadingAttachments
                        ? 'Tambah keterangan lampiran (opsional)...'
                        : `Tulis pesan ke ${activeTitle}...`
                  }
                  className="flex-1 min-w-0 min-h-[44px] max-h-24 resize-none rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 py-2.5 text-xs sm:text-sm text-[#1B271B] placeholder:text-[#6E786D] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29]"
                />
                <button
                  type="submit"
                  disabled={
                    editingTarget
                      ? savingEdit || !draft.trim()
                      : sending ||
                        hasFailedAttachments ||
                        (!draft.trim() && completedAttachments.length === 0 && !hasUploadingAttachments)
                  }
                  aria-label={editingTarget ? 'Simpan perubahan pesan' : 'Kirim pesan'}
                  className="h-11 min-h-[44px] px-3.5 sm:px-4 rounded-2xl bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-[#FFFDF8] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
                >
                  {sending || savingEdit ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editingTarget ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">{editingTarget ? 'Simpan' : 'Kirim'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <PrivateDrivePreviewModal
        session={session}
        message={previewAttachmentMsg}
        onClose={() => setPreviewAttachmentMsg(null)}
      />
    </div>
  );
}
